'use strict';

const { isValidISODate } = require('./dates');

// New format YYYY-mmdd-xxx (e.g. 2026-1029-001). The old COA-YYYY-000001 format
// is still accepted so certificates issued before the change can be verified.
const CERTIFICATE_NO_REGEX = /^(\d{4}-\d{4}-\d{3,}|COA-\d{4}-\d{6})$/;
const EVENT_ID_REGEX = /^[A-HJ-NP-Z2-9]{8}$/;

/** Text field rules: key -> [label, required, minLength, maxLength] */
const RULES = {
  fullName: ['Full name', true, 2, 120],
  eventName: ['Event name', true, 2, 200],
  venue: ['Venue', true, 2, 200],
  eventPlace: ['Event place', true, 2, 200],
  organization: ['Organization', true, 2, 200],
  purpose: ['Purpose', false, 0, 300],
};

/** Collapses whitespace and strips control characters. */
function clean(value) {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Validates the given text fields (and optionally the event date).
 * @returns {{ value: object, errors: Record<string,string> }}
 */
function validateFields(body, keys, withEventDate) {
  const input = body && typeof body === 'object' ? body : {};
  const value = {};
  const errors = {};

  for (const key of keys) {
    const [label, required, min, max] = RULES[key];
    const text = clean(input[key]);
    value[key] = text;

    if (!text) {
      if (required) errors[key] = `${label} is required.`;
      continue;
    }
    if (text.length < min) errors[key] = `${label} must be at least ${min} characters.`;
    else if (text.length > max) errors[key] = `${label} must be ${max} characters or fewer.`;
  }

  if (withEventDate) {
    const eventDate = clean(input.eventDate);
    value.eventDate = eventDate;
    if (!eventDate) errors.eventDate = 'Event date is required.';
    else if (!isValidISODate(eventDate)) errors.eventDate = 'Event date must be a valid date (YYYY-MM-DD).';
  }

  return { value, errors };
}

function validateAdminAssignment(body, value, errors, includeTitle) {
  const input = body && typeof body === 'object' ? body : {};
  const signatoryId = clean(input.signatoryId);
  value.signatoryId = signatoryId;
  if (!signatoryId) errors.signatoryId = 'Select a signatory.';
  if (includeTitle) {
    const certificateTitle = clean(input.certificateTitle);
    value.certificateTitle = certificateTitle;
    if (certificateTitle.length > 120) errors.certificateTitle = 'Certificate title must be 120 characters or fewer.';
  }
}

/** Admin creating an event. */
function validateEventInput(body) {
  const result = validateFields(body, ['eventName', 'venue'], true);
  validateAdminAssignment(body, result.value, result.errors, true);
  return result;
}

function validatePurposeTemplateInput(body) {
  const result = validateFields(body, ['eventPlace', 'purpose'], true);
  validateAdminAssignment(body, result.value, result.errors, false);
  if (!result.value.purpose) result.errors.purpose = 'Purpose is required.';
  return result;
}

/** Attendee requesting a certificate for an existing event (name only). */
const validateAttendeeInput = (body) => validateFields(body, ['fullName'], false);

/** Certificate without an event: the requester supplies everything, including the purpose. */
function validateNoEventInput(body) {
  const result = validateFields(body, ['fullName', 'organization', 'venue', 'purpose'], true);
  if (!result.value.purpose) result.errors.purpose = 'Purpose is required.';
  return result;
}

function validatePurposeCertificateInput(body) {
  return validateFields(body, ['fullName', 'organization'], false);
}

const isValidCertificateNo = (no) => CERTIFICATE_NO_REGEX.test(no);
const isValidEventId = (id) => EVENT_ID_REGEX.test(id);

module.exports = {
  validateEventInput,
  validateAttendeeInput,
  validateNoEventInput,
  validatePurposeTemplateInput,
  validatePurposeCertificateInput,
  isValidCertificateNo,
  isValidEventId,
  CERTIFICATE_NO_REGEX,
  EVENT_ID_REGEX,
};
