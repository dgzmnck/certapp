'use strict';

/**
 * Shared "save to Sheets -> render PDF -> send" flow, used by both the open
 * form route and the event (QR) route.
 */

const certificateService = require('./certificateService');
const { generateQrDataUri } = require('./qrService');
const { generateCertificatePdf } = require('./pdfService');
const { AppError } = require('../utils/errors');

/** Builds the PDF for an existing record. */
async function buildPdf(record) {
  const qr = await generateQrDataUri(record);
  return generateCertificatePdf(record, qr);
}

/**
 * Saves a certificate record and renders its PDF. The row is saved first,
 * so if the PDF step fails the error tells the user the certificate number
 * (they can re-download via GET /api/certificate/:no?name=...&download=pdf).
 */
async function issueCertificate(data) {
  const record = await certificateService.createCertificate(data);
  try {
    return { record, pdf: await buildPdf(record) };
  } catch (err) {
    const base = err instanceof AppError ? err.message : 'Could not generate the PDF.';
    throw new AppError(500, `${base} Your record was saved as ${record.certificateNo}.`, {
      certificateNo: record.certificateNo,
    });
  }
}

/** Sends a PDF as a browser download. */
function sendPdf(res, pdfBuffer, certificateNo) {
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${certificateNo}.pdf"`,
    'Content-Length': pdfBuffer.length,
    'X-Certificate-No': certificateNo,
    'Cache-Control': 'no-store',
  });
  res.status(200).end(pdfBuffer);
}

module.exports = { issueCertificate, buildPdf, sendPdf };
