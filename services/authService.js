'use strict';

/**
 * Stateless admin sessions (works on Vercel, where there is no shared memory).
 *
 * After login the server sends an HttpOnly cookie holding
 *   base64url(payload) + "." + HMAC-SHA256(payload, SESSION_SECRET)
 * The payload contains the username, owner flag, and expiry time. Changing
 * SESSION_SECRET logs everyone out.
 */

const crypto = require('crypto');
const config = require('../config');

const COOKIE_NAME = 'admin_session';

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest();

/** Constant-time string comparison (hashing makes the lengths equal). */
function safeEqual(a, b) {
  return crypto.timingSafeEqual(sha256(a), sha256(b));
}

/** True when username, password and a decent session secret are set. */
function isConfigured() {
  const { username, password, sessionSecret } = config.admin;
  return Boolean(username && password && sessionSecret.length >= 16);
}

function verifyCredentials(username, password) {
  // Evaluate both comparisons so timing does not reveal which one failed.
  const userOk = safeEqual(username, config.admin.username);
  const passOk = safeEqual(password, config.admin.password);
  return userOk && passOk;
}

function sign(data) {
  return crypto.createHmac('sha256', config.admin.sessionSecret).update(data).digest('base64url');
}

function createToken(username, isOwner) {
  const payload = Buffer.from(
    JSON.stringify({ u: username, owner: Boolean(isOwner), exp: Date.now() + config.admin.sessionHours * 3600 * 1000 })
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/** Returns the session payload, or null when the token is invalid/expired. */
function verifyToken(token) {
  if (typeof token !== 'string' || !isConfigured()) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.exp > Date.now() ? data : null;
  } catch (err) {
    return null;
  }
}

/** Minimal cookie parser (avoids an extra dependency). */
function parseCookies(header) {
  const out = {};
  String(header || '')
    .split(';')
    .forEach((part) => {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    });
  return out;
}

function readSession(req) {
  return verifyToken(parseCookies(req.headers.cookie)[COOKIE_NAME]);
}

function setSessionCookie(res, username, isOwner) {
  res.cookie(COOKIE_NAME, createToken(username, isOwner), {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.isProduction, // HTTPS only on Vercel
    maxAge: config.admin.sessionHours * 3600 * 1000,
    path: '/',
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.isProduction,
    path: '/',
  });
}

module.exports = {
  isConfigured,
  verifyCredentials,
  readSession,
  setSessionCookie,
  clearSessionCookie,
  safeEqual,
};
