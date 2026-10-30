'use strict';

/**
 * Reusable Google Sheets service (Service Account authentication).
 *
 * Setup requirements:
 *  1. Enable the "Google Sheets API" in your Google Cloud project.
 *  2. Create a Service Account and download its JSON key.
 *  3. Share the target spreadsheet with the service account's e-mail
 *     address (Editor access).
 *
 * All values are written with valueInputOption "RAW", so Sheets never
 * converts dates/numbers and never evaluates formulas typed by a user
 * (this prevents spreadsheet formula injection).
 */

const { google } = require('googleapis');
const config = require('../config');
const { AppError } = require('../utils/errors');

/** Column order in the sheet. */
const HEADERS = [
  'CERTIFICATE_NO',
  'TYPE',
  'FULL_NAME',
  'ORGANIZATION',
  'EVENT_ID',
  'PURPOSE_ID',
  'SIGNATORY_ID',
  'ISSUE_DATE',
  'STATUS',
  'EVENT_NAME',
  'EVENT_PLACE',
  'EVENT_DATE',
  'PURPOSE',
  'SIGNATORY_NAME',
  'SIGNATORY_TITLE',
  'SIGNATORY_OFFICE',
  'SIGNATORY_ESIGNATURE',
  'CERTIFICATE_TITLE',
  'TEMPLATE_ID',
  'MESSAGE_TEMPLATE',
  'FIELD_VALUES',
  'FIELD_LABELS',
];

const HEADER_ALIASES = {
  careferenceno: 'CERTIFICATE_NO',
  certificateno: 'CERTIFICATE_NO',
  fullname: 'FULL_NAME',
  eventid: 'EVENT_ID',
  eventname: 'EVENT_NAME',
  eventdate: 'EVENT_DATE',
  eventplace: 'EVENT_PLACE',
  venue: 'EVENT_PLACE',
  purpose: 'PURPOSE',
  issuedate: 'ISSUE_DATE',
  organization: 'ORGANIZATION',
  status: 'STATUS',
  certificatetype: 'TYPE',
  purposeid: 'PURPOSE_ID',
  signatoryid: 'SIGNATORY_ID',
  createdat: 'CREATED_AT',
  name: 'NAME',
  title: 'TITLE',
  office: 'OFFICE',
  esignature: 'ESIGNATURE',
  signatoryname: 'SIGNATORY_NAME',
  signatorytitle: 'SIGNATORY_TITLE',
  signatoryoffice: 'SIGNATORY_OFFICE',
  signatoryesignature: 'SIGNATORY_ESIGNATURE',
  certificatetitle: 'CERTIFICATE_TITLE',
  messagetemplate: 'MESSAGE_TEMPLATE',
  fieldvalues: 'FIELD_VALUES',
  templateid: 'TEMPLATE_ID',
};

function canonicalHeader(header) {
  const normalized = String(header || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  return HEADER_ALIASES[normalized] || String(header || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function columnName(index) {
  let name = '';
  let value = index + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

let sheetsClient = null; // cached API client (reused across warm invocations)
const readyTabs = new Map(); // tab name -> cached "tab + header exist" check

/** Quotes a tab name for A1 notation, e.g. My Tab -> 'My Tab' */
function quoted(name) {
  return `'${name.replace(/'/g, "''")}'`;
}

/** Builds an A1 range for the configured tab. */
function range(a1) {
  return `${quoted(config.google.sheetName)}!${a1}`;
}

/** Throws a clear error when credentials are missing. */
function assertConfigured() {
  const { clientEmail, privateKey, sheetId } = config.google;
  const missing = [];
  if (!clientEmail) missing.push('GOOGLE_SERVICE_ACCOUNT_EMAIL');
  if (!privateKey) missing.push('GOOGLE_PRIVATE_KEY');
  if (!sheetId) missing.push('GOOGLE_SHEET_ID');
  if (missing.length) {
    console.error(`Google Sheets is not configured. Missing: ${missing.join(', ')}`);
    throw new AppError(500, 'The server is not configured for Google Sheets yet.');
  }
}

/** Creates (once) and returns the authenticated Sheets client. */
function getClient() {
  if (sheetsClient) return sheetsClient;
  assertConfigured();

  const auth = new google.auth.JWT({
    email: config.google.clientEmail,
    key: config.google.privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

/**
 * Runs a Sheets API call and converts Google errors into AppErrors.
 * The original error is logged on the server only.
 */
async function callApi(label, fn) {
  try {
    return await fn(getClient());
  } catch (err) {
    if (err instanceof AppError) throw err;
    const code = err.code || err.status;
    console.error(`Google Sheets error during "${label}":`, code, err.message);

    if (code === 403 || code === 404) {
      throw new AppError(
        502,
        'Cannot access the Google Sheet. Check the Sheet ID and share it with the service account.'
      );
    }
    if (code === 429) {
      throw new AppError(503, 'Google Sheets is busy. Please try again in a moment.');
    }
    throw new AppError(502, 'Could not reach Google Sheets. Please try again.');
  }
}

/** Builds an A1 range inside any tab. */
function rangeIn(tab, a1) {
  return `${quoted(tab)}!${a1}`;
}

/**
 * Makes sure a tab and its header row exist (created on first use).
 * The check is cached, so it only costs API calls once per instance.
 *
 * When a schema changes, existing rows are remapped by header name before the
 * new header is written. This keeps legacy certificate and event records usable.
 */
function ensureTab(tab, headers) {
  if (!readyTabs.has(tab)) {
    const lastCol = columnName(headers.length - 1);
    const promise = callApi(`ensureTab:${tab}`, async (sheets) => {
      const spreadsheetId = config.google.sheetId;

      const meta = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties(title)',
      });
      const found = (meta.data.sheets || []).find((s) => s.properties.title === tab);

      if (!found) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] },
        });
      }

      // Read a wide header row so old layouts (more columns) are seen too.
      const header = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: rangeIn(tab, 'A1:Z1'),
      });
      const existing = [...((header.data.values && header.data.values[0]) || [])];
      const currentMatches = existing.slice(0, headers.length).join('|') === headers.join('|');

      let migratedRows = [];
      if (existing.length && !currentMatches) {
        const data = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: rangeIn(tab, `A2:${columnName(existing.length - 1)}`),
        });
        const oldRows = data.data.values || [];
        const sourceHeaders = existing.map(canonicalHeader);
        migratedRows = oldRows.map((row) => {
          const record = {};
          sourceHeaders.forEach((key, index) => {
            record[key] = row[index] || '';
          });
          return headers.map((header) => {
            const key = canonicalHeader(header);
            if (record[key] !== undefined) return record[key];
            if (key === 'TYPE') return record.EVENT_ID || record.EVENT_NAME ? 'EVENT' : 'PURPOSE';
            return '';
          });
        });
      }

      if (!currentMatches) {
        const updates = [{
          range: rangeIn(tab, `A1:${lastCol}1`),
          values: [headers],
        }];
        if (migratedRows.length) {
          updates.push({
            range: rangeIn(tab, `A2:${lastCol}${migratedRows.length + 1}`),
            values: migratedRows,
          });
        }
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: { valueInputOption: 'RAW', data: updates },
        });
      }
    }).catch((err) => {
      readyTabs.delete(tab); // allow retry on the next request
      throw err;
    });
    readyTabs.set(tab, promise);
  }
  return readyTabs.get(tab);
}

/** Ensures the certificates tab exists. */
function ensureReady() {
  return ensureTab(config.google.sheetName, HEADERS);
}

/** Converts a record object to a sheet row (array). */
function toRow(r) {
  return [
    r.certificateNo,
    r.type || (r.eventId ? 'EVENT' : 'PURPOSE'),
    r.fullName,
    r.organization || '',
    r.eventId || '',
    r.purposeId || '',
    r.signatoryId || '',
    r.issueDate,
    r.status || 'Valid',
    r.eventName || '',
    r.venue || '',
    r.eventDate || '',
    r.purpose || '',
    r.signatoryName || '',
    r.signatoryTitle || '',
    r.signatoryOffice || '',
    r.signatoryESignature || '',
    r.certificateTitle || '',
    r.templateId || '',
    r.messageTemplate || '',
    JSON.stringify(r.fieldValues || {}),
    JSON.stringify(r.fieldLabels || {}),
  ];
}

/** Converts a sheet row (array) to a record object. */
function fromRow(row) {
  return {
    certificateNo: row[0] || '',
    type: row[1] || '',
    fullName: row[2] || '',
    organization: row[3] || '',
    eventId: row[4] || '',
    purposeId: row[5] || '',
    signatoryId: row[6] || '',
    issueDate: row[7] || '',
    status: row[8] || 'Valid',
    eventName: row[9] || '',
    venue: row[10] || '',
    eventDate: row[11] || '',
    purpose: row[12] || '',
    signatoryName: row[13] || '',
    signatoryTitle: row[14] || '',
    signatoryOffice: row[15] || '',
    signatoryESignature: row[16] || '',
    certificateTitle: row[17] || '',
    templateId: row[18] || '',
    messageTemplate: row[19] || '',
    fieldValues: row[20] ? JSON.parse(row[20]) : {},
    fieldLabels: row[21] ? JSON.parse(row[21]) : {},
  };
}

/**
 * Returns the certificate numbers from column A, in sheet order
 * (index 0 = row 2, because row 1 is the header).
 */
async function getCertificateNumbers() {
  await ensureReady();
  const res = await callApi('getCertificateNumbers', (sheets) =>
    sheets.spreadsheets.values.get({
      spreadsheetId: config.google.sheetId,
      range: range('A2:A'),
    })
  );
  return (res.data.values || []).map((r) => (r[0] || '').trim());
}

/**
 * Appends a record.
 * @returns {Promise<number>} the 1-based sheet row number that was written
 */
async function appendRecord(record) {
  await ensureReady();
  const res = await callApi('appendRecord', (sheets) =>
    sheets.spreadsheets.values.append({
      spreadsheetId: config.google.sheetId,
      range: range(`A:${columnName(HEADERS.length - 1)}`),
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [toRow(record)] },
    })
  );

  // updatedRange looks like  Certificates!A5:H5
  const updatedRange = res.data.updates && res.data.updates.updatedRange;
  const match = /!?[A-Z]+(\d+):/.exec(updatedRange || '');
  if (!match) throw new AppError(502, 'Saved to Google Sheets, but could not confirm the row.');
  return Number(match[1]);
}

/** Overwrites the Certificate No cell of a specific row. */
async function updateCertificateNo(rowNumber, certificateNo) {
  await callApi('updateCertificateNo', (sheets) =>
    sheets.spreadsheets.values.update({
      spreadsheetId: config.google.sheetId,
      range: range(`A${rowNumber}`),
      valueInputOption: 'RAW',
      requestBody: { values: [[certificateNo]] },
    })
  );
}

/** Sets the Status cell (column I) of a specific row. */
async function updateCertificateStatus(rowNumber, status) {
  await callApi('updateCertificateStatus', (sheets) =>
    sheets.spreadsheets.values.update({
      spreadsheetId: config.google.sheetId,
      range: range(`I${rowNumber}`),
      valueInputOption: 'RAW',
      requestBody: { values: [[status]] },
    })
  );
}

/** Returns every record in the sheet (oldest first). */
async function getAllRecords() {
  await ensureReady();
  const res = await callApi('getAllRecords', (sheets) =>
    sheets.spreadsheets.values.get({
      spreadsheetId: config.google.sheetId,
      range: range(`A2:${columnName(HEADERS.length - 1)}`),
    })
  );
  // rowNumber = position in the sheet (row 1 is the header)
  return (res.data.values || [])
    .map((row, index) => ({ ...fromRow(row), rowNumber: index + 2 }))
    .filter((r) => r.certificateNo);
}

/** Finds one record by certificate number, or null. */
async function findByCertificateNo(certificateNo) {
  const records = await getAllRecords();
  return records.find((r) => r.certificateNo === certificateNo) || null;
}

module.exports = {
  HEADERS,
  callApi,
  columnName,
  ensureTab,
  rangeIn,
  appendRecord,
  updateCertificateNo,
  updateCertificateStatus,
  getCertificateNumbers,
  getAllRecords,
  findByCertificateNo,
};
