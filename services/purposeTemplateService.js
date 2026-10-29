'use strict';

const crypto = require('crypto');
const config = require('../config');
const sheet = require('./googleSheetService');
const { AppError } = require('../utils/errors');

const HEADERS = [
  'PURPOSE_ID',
  'EVENT_PLACE',
  'EVENT_DATE',
  'PURPOSE',
  'SIGNATORY_ID',
  'STATUS',
  'CREATED_AT',
];
const STATUS = { ACTIVE: 'Active', CLOSED: 'Closed' };
const tab = () => config.google.purposeTemplatesSheetName;

function generatePurposeId() {
  return `PUR-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function fromRow(row) {
  return {
    purposeId: row[0] || '',
    eventPlace: row[1] || '',
    eventDate: row[2] || '',
    purpose: row[3] || '',
    signatoryId: row[4] || '',
    status: row[5] || STATUS.ACTIVE,
    createdAt: row[6] || '',
  };
}

async function readAll() {
  await sheet.ensureTab(tab(), HEADERS);
  const result = await sheet.callApi('readPurposeTemplates', (api) =>
    api.spreadsheets.values.get({
      spreadsheetId: config.google.sheetId,
      range: sheet.rangeIn(tab(), 'A2:G'),
    })
  );
  return (result.data.values || []).map(fromRow).filter((item) => item.purposeId);
}

async function listPurposeTemplates() {
  return (await readAll()).reverse();
}

async function getPurposeTemplate(purposeId) {
  return (await readAll()).find((item) => item.purposeId === purposeId) || null;
}

async function createPurposeTemplate(data) {
  const existing = new Set((await readAll()).map((item) => item.purposeId));
  let purposeId = generatePurposeId();
  while (existing.has(purposeId)) purposeId = generatePurposeId();
  const template = {
    purposeId,
    eventPlace: data.eventPlace,
    eventDate: data.eventDate,
    purpose: data.purpose,
    signatoryId: data.signatoryId,
    status: STATUS.ACTIVE,
    createdAt: new Date().toISOString(),
  };
  await sheet.callApi('createPurposeTemplate', (api) =>
    api.spreadsheets.values.append({
      spreadsheetId: config.google.sheetId,
      range: sheet.rangeIn(tab(), 'A:G'),
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[
          template.purposeId, template.eventPlace, template.eventDate,
          template.purpose, template.signatoryId, template.status, template.createdAt,
        ]],
      },
    })
  );
  return template;
}

async function setStatus(purposeId, status) {
  if (!Object.values(STATUS).includes(status)) throw new AppError(400, 'Invalid purpose template status.');
  const rows = await readAll();
  const index = rows.findIndex((item) => item.purposeId === purposeId);
  if (index < 0) throw new AppError(404, 'Purpose template not found.');
  await sheet.callApi('setPurposeTemplateStatus', (api) =>
    api.spreadsheets.values.update({
      spreadsheetId: config.google.sheetId,
      range: sheet.rangeIn(tab(), `F${index + 2}`),
      valueInputOption: 'RAW',
      requestBody: { values: [[status]] },
    })
  );
  return { ...rows[index], status };
}

module.exports = { HEADERS, STATUS, listPurposeTemplates, getPurposeTemplate, createPurposeTemplate, setStatus };
