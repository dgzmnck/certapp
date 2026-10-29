'use strict';

/**
 * Business logic for certificates: number generation + persistence.
 */

const config = require('../config');
const sheet = require('./googleSheetService');
const { todayISO } = require('../utils/dates');
const { AppError } = require('../utils/errors');

const MAX_COLLISION_RETRIES = 5;
const STATUS = { VALID: 'Valid', REJECTED: 'Rejected' };

/**
 * Simple in-process mutex. It serialises requests handled by the SAME
 * server instance. Requests on different serverless instances are covered
 * by the verify-and-renumber step in createCertificate().
 */
let queue = Promise.resolve();
function runExclusive(task) {
  const result = queue.then(() => task());
  queue = result.catch(() => {}); // keep the chain alive after failures
  return result;
}

/** Prefix shared by every number issued on one day, e.g. "2026-1029-" */
function dayPrefix(issueDate) {
  const [y, m, d] = issueDate.split('-'); // issueDate is YYYY-MM-DD
  return `${y}-${m}${d}-`;
}

/** Formats YYYY-mmdd-xxx, e.g. 2026-1029-001 (the counter restarts every day). */
function formatCertificateNo(issueDate, sequence) {
  return `${dayPrefix(issueDate)}${String(sequence).padStart(3, '0')}`;
}

/**
 * Looks at all existing numbers and returns the next sequence for the given
 * day. Numbers from other days (and old COA-... numbers) are ignored, so a
 * new day automatically restarts at 001.
 */
function nextSequence(existingNumbers, issueDate) {
  const prefix = dayPrefix(issueDate);
  let max = 0;
  for (const no of existingNumbers) {
    if (!no.startsWith(prefix)) continue;
    const tail = no.slice(prefix.length);
    if (/^\d+$/.test(tail)) max = Math.max(max, Number(tail));
  }
  return max + 1;
}

/**
 * Creates a certificate record and stores it in Google Sheets.
 *
 * Duplicate protection: after appending, we re-read column A. If another
 * request grabbed the same number first (it appears on an earlier row),
 * our row is renumbered and verified again.
 *
 * @param {object} data validated form values
 * @returns {Promise<object>} the saved record (including certificateNo)
 */
function createCertificate(data) {
  return runExclusive(async () => {
    const issueDate = todayISO(config.timezone);

    const existing = await sheet.getCertificateNumbers();
    let certificateNo = formatCertificateNo(issueDate, nextSequence(existing, issueDate));

    const record = { ...data, certificateNo, issueDate, status: STATUS.VALID };
    const rowNumber = await sheet.appendRecord(record);

    for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt += 1) {
      const numbers = await sheet.getCertificateNumbers();
      const firstRow = numbers.indexOf(certificateNo) + 2; // +2: header row + 0-index
      if (firstRow === rowNumber) {
        return { ...record, certificateNo };
      }
      certificateNo = formatCertificateNo(issueDate, nextSequence(numbers, issueDate));
      await sheet.updateCertificateNo(rowNumber, certificateNo);
    }

    throw new AppError(503, 'Could not reserve a unique certificate number. Please try again.');
  });
}

/**
 * Certificates issued for one event, oldest first.
 * Rows from before the Event ID column existed are matched by event details.
 */
async function listByEvent(event) {
  const all = await sheet.getAllRecords();
  return all.filter((r) =>
    r.eventId
      ? r.eventId === event.eventId
      : r.eventName === event.eventName &&
        r.eventDate === event.eventDate &&
        r.venue === event.venue
  );
}

/** Certificates issued without an event (they have no event name). */
async function listNoEvent() {
  const all = await sheet.getAllRecords();
  return all.filter((r) => !r.eventName);
}

/** Rejects or restores a certificate. Rejected ones no longer verify. */
async function setStatus(certificateNo, status) {
  const record = await sheet.findByCertificateNo(certificateNo);
  if (!record) throw new AppError(404, `Certificate ${certificateNo} was not found.`);
  await sheet.updateCertificateStatus(record.rowNumber, status);
  return { ...record, status };
}

module.exports = {
  STATUS,
  listByEvent,
  listNoEvent,
  setStatus,
  createCertificate,
  getCertificate: (no) => sheet.findByCertificateNo(no),
  listCertificates: () => sheet.getAllRecords(),
  formatCertificateNo,
  nextSequence,
};
