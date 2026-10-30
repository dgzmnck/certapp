'use strict';

/**
 * Events are stored in their own Google Sheet tab ("Events" by default).
 * Each event gets a random 8-character ID that is used in the QR link.
 */

const crypto = require('crypto');
const config = require('../config');
const sheet = require('./googleSheetService');
const { AppError } = require('../utils/errors');

const EVENT_HEADERS = [
  'EVENT_ID',
  'EVENT_NAME',
  'EVENT_DATE',
  'EVENT_PLACE',
  'STATUS',
  'CERTIFICATE_TYPE',
  'SIGNATORY_ID',
  'CREATED_AT',
  'CERTIFICATE_TITLE',
  'TEMPLATE_ID',
  'MESSAGE_TEMPLATE',
  'ADMIN_FIELDS',
  'RECIPIENT_FIELDS',
  'FIXED_VALUES',
];
const STATUS = { ACTIVE: 'Active', CLOSED: 'Closed' };

// No 0/O/1/I so IDs are easy to read and type.
const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const tab = () => config.google.eventsSheetName;

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (err) {
    throw new AppError(500, 'A saved event contains invalid certificate template data.');
  }
}

function generateEventId() {
  let id = '';
  for (let i = 0; i < 8; i += 1) id += ID_ALPHABET[crypto.randomInt(ID_ALPHABET.length)];
  return id;
}

const fromRow = (row, rowNumber) => {
  const fixedValues = parseJson(row[13], {});
  return {
    eventId: row[0] || '',
    eventName: row[1] || fixedValues.EVENT_NAME || '',
    eventDate: row[2] || fixedValues.EVENT_DATE || '',
    venue: row[3] || fixedValues.EVENT_PLACE || fixedValues.EVENTPLACE || '',
    status: row[4] || STATUS.ACTIVE,
    certificateType: row[5] || 'EVENT',
    signatoryId: row[6] || '',
    createdAt: row[7] || '',
    certificateTitle: row[8] || '',
    templateId: row[9] || '',
    messageTemplate: row[10] || '',
    adminFields: parseJson(row[11], []),
    recipientFields: parseJson(row[12], []),
    fixedValues,
    rowNumber,
  };
};

/** Reads every event row (oldest first). */
async function readAll() {
  await sheet.ensureTab(tab(), EVENT_HEADERS);
  const res = await sheet.callApi('readEvents', (api) =>
    api.spreadsheets.values.get({
      spreadsheetId: config.google.sheetId,
      range: sheet.rangeIn(tab(), 'A2:N'),
    })
  );
  return (res.data.values || []).map((row, index) => fromRow(row, index + 2));
}

/** All events, newest first. */
async function listEvents() {
  return (await readAll()).filter((e) => e.eventId).reverse();
}

async function getEvent(eventId) {
  const events = await readAll();
  return events.find((e) => e.eventId === eventId) || null;
}

/** Creates an event from validated values. */
async function createEvent(data) {
  const existing = new Set((await readAll()).map((e) => e.eventId));
  let eventId = generateEventId();
  while (existing.has(eventId)) eventId = generateEventId();

  const event = {
    eventId,
    eventName: data.eventName,
    eventDate: data.eventDate,
    venue: data.venue,
    status: STATUS.ACTIVE,
    certificateType: 'EVENT',
    signatoryId: data.signatoryId,
    certificateTitle: data.certificateTitle || '',
    createdAt: new Date().toISOString(),
    templateId: data.templateId || '',
    messageTemplate: data.messageTemplate || '',
    adminFields: data.adminFields || [],
    recipientFields: data.recipientFields || [],
    fixedValues: data.fixedValues || {},
  };

  await sheet.callApi('createEvent', (api) =>
    api.spreadsheets.values.append({
      spreadsheetId: config.google.sheetId,
      range: sheet.rangeIn(tab(), 'A:N'),
      valueInputOption: 'RAW', // text stays text; no formulas are evaluated
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[
          event.eventId, event.eventName, event.eventDate, event.venue,
          event.status, event.certificateType, event.signatoryId,
          event.createdAt, event.certificateTitle,
          event.templateId, event.messageTemplate,
          JSON.stringify(event.adminFields), JSON.stringify(event.recipientFields),
          JSON.stringify(event.fixedValues),
        ]],
      },
    })
  );
  return event;
}

/** Opens or closes an event (closed events stop issuing certificates). */
async function setStatus(eventId, status) {
  const rows = await readAll();
  const index = rows.findIndex((e) => e.eventId === eventId);
  if (index === -1) throw new AppError(404, 'Event not found.');

  await sheet.callApi('setEventStatus', (api) =>
    api.spreadsheets.values.update({
      spreadsheetId: config.google.sheetId,
      range: sheet.rangeIn(tab(), `E${index + 2}`), // +2: header row + 0-index
      valueInputOption: 'RAW',
      requestBody: { values: [[status]] },
    })
  );
  return { ...rows[index], status };
}

async function updateEventDetails(eventId, data) {
  const rows = await readAll();
  const event = rows.find((item) => item.eventId === eventId);
  if (!event) throw new AppError(404, 'Event not found.');
  const requests = [];
  if (data.certificateTitle !== undefined) {
    requests.push({
      range: sheet.rangeIn(tab(), `I${event.rowNumber}`),
      values: [[data.certificateTitle]],
    });
  }
  if (requests.length) {
    await sheet.callApi('updateEventDetails', (api) =>
      api.spreadsheets.values.batchUpdate({
        spreadsheetId: config.google.sheetId,
        requestBody: {
          valueInputOption: 'RAW',
          data: requests,
        },
      })
    );
  }
  return { ...event, ...data };
}

module.exports = { STATUS, EVENT_HEADERS, listEvents, getEvent, createEvent, setStatus, updateEventDetails };
