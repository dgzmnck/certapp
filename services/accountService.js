'use strict';

const crypto = require('crypto');
const { promisify } = require('util');

const config = require('../config');
const sheet = require('./googleSheetService');
const { AppError } = require('../utils/errors');

const scrypt = promisify(crypto.scrypt);
const HEADERS = ['USERNAME', 'PASSWORD_HASH', 'STATUS', 'CREATED_AT'];
const HASH_BYTES = 64;
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function validateAccountInput(input) {
  const username = typeof input.username === 'string' ? input.username.trim() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  const errors = {};

  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
    errors.username = 'Username must be 3-32 characters using letters, numbers, dots, underscores, or hyphens.';
  }
  if (password.length < 12 || password.length > 128) {
    errors.password = 'Password must be 12–128 characters.';
  }
  if (normalizeUsername(username) === normalizeUsername(config.admin.username)) {
    errors.username = 'This username is reserved.';
  }
  return { username, password, errors };
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, HASH_BYTES, SCRYPT_OPTIONS);
  return `scrypt$${SCRYPT_OPTIONS.N}$${SCRYPT_OPTIONS.r}$${SCRYPT_OPTIONS.p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

async function verifyPassword(password, storedHash) {
  const parts = String(storedHash || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (n !== SCRYPT_OPTIONS.N || r !== SCRYPT_OPTIONS.r || p !== SCRYPT_OPTIONS.p ||
      salt.length !== 16 || expected.length !== HASH_BYTES) return false;

  const actual = await scrypt(password, salt, HASH_BYTES, SCRYPT_OPTIONS);
  return crypto.timingSafeEqual(actual, expected);
}

async function getAccountRows() {
  await sheet.ensureTab(config.google.accountsSheetName, HEADERS);
  const response = await sheet.callApi('getAdminAccounts', (sheets) =>
    sheets.spreadsheets.values.get({
      spreadsheetId: config.google.sheetId,
      range: sheet.rangeIn(config.google.accountsSheetName, 'A2:D'),
    })
  );
  return (response.data.values || []).map((row, index) => ({
    username: row[0] || '',
    passwordHash: row[1] || '',
    status: row[2] || 'Active',
    createdAt: row[3] || '',
    rowNumber: index + 2,
  }));
}

let writeQueue = Promise.resolve();
function runExclusive(task) {
  const result = writeQueue.then(task);
  writeQueue = result.catch(() => {});
  return result;
}

function listAccounts() {
  return getAccountRows().then((rows) => rows.map(({ username, status, createdAt }) => ({
    username,
    status,
    createdAt,
  })));
}

function createAccount(input) {
  return runExclusive(async () => {
    const validated = validateAccountInput(input || {});
    if (Object.keys(validated.errors).length) {
      throw new AppError(400, 'Please correct the highlighted fields.', { fields: validated.errors });
    }

    const rows = await getAccountRows();
    if (rows.some((row) => normalizeUsername(row.username) === normalizeUsername(validated.username))) {
      throw new AppError(409, 'That username is already in use.');
    }

    const passwordHash = await hashPassword(validated.password);
    const createdAt = new Date().toISOString();
    await sheet.callApi('createAdminAccount', (sheets) =>
      sheets.spreadsheets.values.append({
        spreadsheetId: config.google.sheetId,
        range: sheet.rangeIn(config.google.accountsSheetName, 'A:D'),
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [[validated.username, passwordHash, 'Active', createdAt]],
        },
      })
    );
    return { username: validated.username, status: 'Active', createdAt };
  });
}

async function authenticate(username, password) {
  const account = (await getAccountRows()).find((row) =>
    row.status === 'Active' && normalizeUsername(row.username) === normalizeUsername(username)
  );
  if (!account || !await verifyPassword(password, account.passwordHash)) return null;
  return { username: account.username };
}

module.exports = { authenticate, createAccount, listAccounts };
