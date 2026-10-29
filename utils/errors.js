'use strict';

/**
 * Error type that carries an HTTP status code and a safe, client-facing
 * message. Anything that is NOT an AppError is treated as an unexpected
 * failure and reported to the client as a generic 500.
 */
class AppError extends Error {
  /**
   * @param {number} status    HTTP status code
   * @param {string} message   Message that is safe to show to the user
   * @param {object} [details] Extra machine-readable info (e.g. field errors)
   */
  constructor(status, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.details = details;
  }
}

module.exports = { AppError };
