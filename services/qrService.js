'use strict';

const QRCode = require('qrcode');
const config = require('../config');

/**
 * Builds a verifier URL that pre-fills the certificate number and recipient name.
 */
function buildQrPayload(record) {
  const query = new URLSearchParams({
    id: record.certificateNo,
    name: record.fullName,
  });
  return `${config.baseUrl}/?${query.toString()}`;
}

/** Returns a PNG data URI that can be embedded in the certificate HTML. */
function generateQrDataUri(record) {
  return QRCode.toDataURL(buildQrPayload(record), {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 260,
    color: { dark: '#000000', light: '#ffffff' },
  });
}

module.exports = { generateQrDataUri, buildQrPayload };
