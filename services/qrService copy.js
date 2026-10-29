'use strict';

const QRCode = require('qrcode');
const config = require('../config');

/**
 * Builds the text encoded in the QR code:
 * Certificate No, Full Name, Event and Issue Date.
 * When BASE_URL is configured a link to the verification page is added;
 * scanning it opens the checker with the certificate number pre-filled.
 */
function buildQrPayload(record) {
  const lines = [
    `CA Reference No: ${record.certificateNo}`,
    `Name: ${record.fullName}`,
    `Event: ${record.eventName}`,
    `Issue Date: ${record.issueDate}`,
  ];
  if (config.baseUrl) {
    lines.push(`Verify: ${config.baseUrl}/?id=${encodeURIComponent(record.certificateNo)}`);
  }
  return lines.join('\n');
}

/** Returns a PNG data URI that can be embedded in the certificate HTML. */
function generateQrDataUri(record) {
  return QRCode.toDataURL(buildQrPayload(record), {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 260,
    color: { dark: '#14432c', light: '#ffffff' },
  });
}

module.exports = { generateQrDataUri, buildQrPayload };
