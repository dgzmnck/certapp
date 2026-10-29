'use strict';

/** Returns today's date as YYYY-MM-DD in the given IANA timezone. */
function todayISO(timeZone) {
  // The "en-CA" locale formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** True when the string is a real calendar date in YYYY-MM-DD form. */
function isValidISODate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

/** Converts YYYY-MM-DD to a readable string, e.g. "October 29, 2026". */
function formatLongDate(iso) {
  if (!isValidISODate(iso)) return iso || '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

module.exports = { todayISO, isValidISODate, formatLongDate };
