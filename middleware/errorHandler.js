'use strict';

const { AppError } = require('../utils/errors');
const config = require('../config');

/** Handles unknown API routes. */
function notFound(req, res) {
  res.status(404).json({ success: false, message: 'Route not found.' });
}

/** Central error handler: logs details, returns a safe JSON message. */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  // Malformed or oversized JSON body
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'Invalid JSON in request body.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ success: false, message: 'Request body is too large.' });
  }

  if (err instanceof AppError) {
    if (err.status >= 500) console.error(`[${req.method} ${req.originalUrl}]`, err);
    return res.status(err.status).json({
      success: false,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  console.error(`[${req.method} ${req.originalUrl}] Unexpected error:`, err);
  return res.status(500).json({
    success: false,
    message: 'Something went wrong on our side. Please try again.',
    ...(config.isProduction ? {} : { debug: err.message }),
  });
}

/** Wraps async route handlers so rejected promises reach errorHandler. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { notFound, errorHandler, asyncHandler };
