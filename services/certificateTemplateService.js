'use strict';

const crypto = require('crypto');
const config = require('../config');
const sheet = require('./googleSheetService');
const { AppError } = require('../utils/errors');
const { isValidISODate } = require('../utils/dates');

const HEADERS = [
  'TEMPLATE_ID',
  'TEMPLATE_NAME',
  'CERTIFICATE_TITLE',
  'MESSAGE_TEMPLATE',
  'ADMIN_FIELDS',
  'RECIPIENT_FIELDS',
  'STATUS',
  'CREATED_AT',
];
const STATUS = { ACTIVE: 'Active', INACTIVE: 'Inactive' };
const SYSTEM_FIELDS = new Set([
  'ISSUE_DAY',
  'ISSUE_MONTH',
  'ISSUE_YEAR',
  'ISSUE_DATE',
  'SIGNATORY',
  'SIGNATORY_NAME',
  'SIGNATORY_TITLE',
  'SIGNATORY_OFFICE',
  'EVENTPLACE',
]);
const REQUIRED_EVENT_FIELDS = [
  { key: 'EVENT_NAME', label: 'Event name', required: true },
  { key: 'EVENT_DATE', label: 'Event date', required: true },
  { key: 'EVENT_PLACE', label: 'Event place', required: true },
];
const tab = () => config.google.certificateTemplatesSheetName;

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (err) {
    throw new AppError(500, 'A saved certificate template contains invalid field data.');
  }
}

function fromRow(row) {
  const adminFields = ensureRequiredEventFields(parseJson(row[4], []));
  return {
    templateId: row[0] || '',
    templateName: row[1] || '',
    certificateTitle: row[2] || '',
    messageTemplate: row[3] || '',
    adminFields,
    recipientFields: parseJson(row[5], []),
    status: row[6] || STATUS.ACTIVE,
    createdAt: row[7] || '',
  };
}

function ensureRequiredEventFields(fields) {
  const requiredKeys = new Set(REQUIRED_EVENT_FIELDS.map((field) => field.key));
  return REQUIRED_EVENT_FIELDS.concat(
    fields.filter((field) => field && !requiredKeys.has(field.key))
  );
}

function cleanText(value) {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
}

function normalizeFields(raw, fieldName, errors) {
  if (!Array.isArray(raw) || raw.length > 20) {
    errors[fieldName] = 'Provide no more than 20 fields.';
    return [];
  }
  const keys = new Set();
  return raw.map((field, index) => {
    const key = typeof field?.key === 'string' ? field.key.trim().toUpperCase() : '';
    const label = cleanText(field?.label);
    const errorKey = `${fieldName}.${index}`;
    if (!/^[A-Z][A-Z0-9_]{0,39}$/.test(key)) {
      errors[errorKey] = 'Use a variable key with letters, numbers, and underscores.';
    } else if (keys.has(key)) {
      errors[errorKey] = `The variable ${key} is duplicated.`;
    } else if (SYSTEM_FIELDS.has(key)) {
      errors[errorKey] = `${key} is reserved for an automatically supplied value.`;
    }
    if (keys.has(key)) errors[errorKey] = `The variable ${key} is duplicated.`;
    keys.add(key);
    if (!label || label.length > 80) errors[errorKey] = 'Enter a label up to 80 characters.';
    return { key, label, required: field?.required !== false };
  });
}

function validateTemplateInput(body) {
  const input = body && typeof body === 'object' ? body : {};
  const errors = {};
  const templateName = cleanText(input.templateName);
  const certificateTitle = cleanText(input.certificateTitle);
  const messageTemplate = typeof input.messageTemplate === 'string' ? input.messageTemplate.trim() : '';
  const adminFields = ensureRequiredEventFields(normalizeFields(input.adminFields, 'adminFields', errors));
  const recipientFields = normalizeFields(input.recipientFields, 'recipientFields', errors);
  const adminKeys = new Set(adminFields.map((field) => field.key));

  if (!templateName || templateName.length > 120) errors.templateName = 'Enter a template name up to 120 characters.';
  if (!certificateTitle || certificateTitle.length > 120) {
    errors.certificateTitle = 'Enter a certificate title up to 120 characters.';
  }
  if (!messageTemplate || messageTemplate.length > 5000) {
    errors.messageTemplate = 'Enter a certificate message up to 5,000 characters.';
  }
  if (!adminFields.length) errors.adminFields = 'Add at least one admin-managed field.';
  if (!recipientFields.some((field) => field.key === 'NAME')) {
    errors.recipientFields = 'Add the required attendee field with the variable key NAME.';
  } else if (recipientFields.find((field) => field.key === 'NAME').required === false) {
    errors.recipientFields = 'The NAME attendee field must be required.';
  }
  if (adminFields.some((field) => field.key === 'NAME')) {
    errors.adminFields = 'NAME is reserved for the attendee who requests the certificate.';
  }
  if (recipientFields.some((field) =>
    field.key !== 'NAME' && (adminKeys.has(field.key) ||
      ['EVENT_NAME', 'EVENT_DATE', 'EVENT_PLACE'].includes(field.key))
  )) {
    errors.recipientFields = 'Attendee field keys cannot duplicate organizer or event-detail variables.';
  }

  const available = new Set([
    ...adminFields.map((field) => field.key),
    ...recipientFields.map((field) => field.key),
    ...SYSTEM_FIELDS,
  ]);
  const placeholders = messageTemplate.match(/_([A-Z][A-Z0-9_]*)_/g) || [];
  placeholders.forEach((placeholder) => {
    const key = placeholder.slice(1, -1);
    if (!available.has(key)) errors.messageTemplate = `The message uses the undefined variable ${placeholder}.`;
  });

  return {
    value: { templateName, certificateTitle, messageTemplate, adminFields, recipientFields },
    errors,
  };
}

async function readAll() {
  await sheet.ensureTab(tab(), HEADERS);
  const result = await sheet.callApi('readCertificateTemplates', (api) =>
    api.spreadsheets.values.get({
      spreadsheetId: config.google.sheetId,
      range: sheet.rangeIn(tab(), 'A2:H'),
    })
  );
  return (result.data.values || []).map(fromRow).filter((item) => item.templateId);
}

async function listTemplates() {
  return (await readAll()).reverse();
}

async function getTemplate(templateId) {
  return (await readAll()).find((item) => item.templateId === templateId) || null;
}

async function createTemplate(data) {
  const existing = new Set((await readAll()).map((item) => item.templateId));
  let templateId = `TPL-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  while (existing.has(templateId)) templateId = `TPL-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const template = { ...data, templateId, status: STATUS.ACTIVE, createdAt: new Date().toISOString() };
  await sheet.callApi('createCertificateTemplate', (api) =>
    api.spreadsheets.values.append({
      spreadsheetId: config.google.sheetId,
      range: sheet.rangeIn(tab(), 'A:H'),
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[
          template.templateId,
          template.templateName,
          template.certificateTitle,
          template.messageTemplate,
          JSON.stringify(template.adminFields),
          JSON.stringify(template.recipientFields),
          template.status,
          template.createdAt,
        ]],
      },
    })
  );
  return template;
}

function validateFieldValues(rawValues, fields) {
  const values = {};
  const errors = {};
  const input = rawValues && typeof rawValues === 'object' && !Array.isArray(rawValues) ? rawValues : {};
  fields.forEach((field) => {
    const text = cleanText(input[field.key]);
    values[field.key] = text;
    if (!text && field.required) errors[field.key] = `${field.label} is required.`;
    else if (text.length > (field.key === 'NAME' ? 120 : 300)) {
      errors[field.key] = `${field.label} is too long.`;
    } else if (field.key === 'NAME' && text.length < 2) {
      errors[field.key] = 'Full name must be at least 2 characters.';
    } else if (field.key === 'EVENT_DATE' && text && !isValidISODate(text)) {
      errors[field.key] = 'Event date must be a valid date (YYYY-MM-DD).';
    }
  });
  return { values, errors };
}

module.exports = {
  HEADERS,
  STATUS,
  SYSTEM_FIELDS,
  validateTemplateInput,
  validateFieldValues,
  listTemplates,
  getTemplate,
  createTemplate,
};
