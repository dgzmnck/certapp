'use strict';

const crypto = require('crypto');
const config = require('../config');
const sheet = require('./googleSheetService');
const { AppError } = require('../utils/errors');

const HEADERS = ['SIGNATORY_ID', 'NAME', 'TITLE', 'OFFICE', 'ESIGNATURE', 'STATUS', 'CREATED_AT'];
const STATUS = { ACTIVE: 'Active', INACTIVE: 'Inactive' };
const tab = () => config.google.signatoriesSheetName;

function fromRow(row, rowNumber) {
  return {
    signatoryId: row[0] || '',
    name: row[1] || '',
    title: row[2] || '',
    office: row[3] || '',
    eSignature: row[4] || '',
    status: row[5] || STATUS.ACTIVE,
    createdAt: row[6] || '',
    rowNumber,
  };
}

async function readAll() {
  await sheet.ensureTab(tab(), HEADERS);
  const result = await sheet.callApi('readSignatories', (api) =>
    api.spreadsheets.values.get({
      spreadsheetId: config.google.sheetId,
      range: sheet.rangeIn(tab(), 'A2:G'),
    })
  );
  return (result.data.values || []).map((row, index) => fromRow(row, index + 2)).filter((item) => item.signatoryId);
}

async function listSignatories() {
  return (await readAll()).reverse();
}

async function getSignatory(signatoryId) {
  return (await readAll()).find((item) => item.signatoryId === signatoryId) || null;
}

async function createSignatory(data) {
  const record = {
    signatoryId: `SIG-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
    name: data.name,
    title: data.title,
    office: data.office,
    eSignature: data.eSignature,
    status: STATUS.ACTIVE,
    createdAt: new Date().toISOString(),
  };
  await sheet.callApi('createSignatory', (api) =>
    api.spreadsheets.values.append({
      spreadsheetId: config.google.sheetId,
      range: sheet.rangeIn(tab(), 'A:G'),
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[
          record.signatoryId, record.name, record.title, record.office,
          record.eSignature, record.status, record.createdAt,
        ]],
      },
    })
  );
  return record;
}

async function updateSignatory(signatoryId, data) {
  const current = await getSignatory(signatoryId);
  if (!current) throw new AppError(404, 'Signatory not found.');
  const updated = {
    ...current,
    name: data.name,
    title: data.title,
    office: data.office,
    eSignature: data.eSignature || current.eSignature,
  };
  await sheet.callApi('updateSignatory', (api) =>
    api.spreadsheets.values.update({
      spreadsheetId: config.google.sheetId,
      range: sheet.rangeIn(tab(), `A${current.rowNumber}:G${current.rowNumber}`),
      valueInputOption: 'RAW',
      requestBody: {
        values: [[
          updated.signatoryId, updated.name, updated.title, updated.office,
          updated.eSignature, updated.status, updated.createdAt,
        ]],
      },
    })
  );
  return updated;
}

async function setStatus(signatoryId, status) {
  if (!Object.values(STATUS).includes(status)) throw new AppError(400, 'Invalid signatory status.');
  const current = await getSignatory(signatoryId);
  if (!current) throw new AppError(404, 'Signatory not found.');
  await sheet.callApi('setSignatoryStatus', (api) =>
    api.spreadsheets.values.update({
      spreadsheetId: config.google.sheetId,
      range: sheet.rangeIn(tab(), `F${current.rowNumber}`),
      valueInputOption: 'RAW',
      requestBody: { values: [[status]] },
    })
  );
  return { ...current, status };
}

module.exports = { HEADERS, STATUS, listSignatories, getSignatory, createSignatory, updateSignatory, setStatus };
