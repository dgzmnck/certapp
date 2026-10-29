'use strict';

const config = require('../config');
const auth = require('../services/authService');
const { AppError } = require('../utils/errors');

/**
 * Allows a request when it has a valid admin session cookie
 * OR (for scripts) a correct x-api-key header matching ADMIN_API_KEY.
 */
function requireAdmin(req, res, next) {
  if (!auth.isConfigured() && !config.adminApiKey) {
    return next(
      new AppError(503, 'Admin access is not configured. Set ADMIN_USERNAME, ADMIN_PASSWORD and SESSION_SECRET.')
    );
  }

  const key = req.get('x-api-key');
  if (config.adminApiKey && key && auth.safeEqual(key, config.adminApiKey)) return next();

  const session = auth.readSession(req);
  if (session) {
    req.admin = session;
    return next();
  }
  return next(new AppError(401, 'Please sign in as admin.'));
}

module.exports = { requireAdmin };
