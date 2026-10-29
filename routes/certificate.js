'use strict';

const express = require('express');

const { AppError } = require('../utils/errors');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAdmin } = require('../middleware/auth');
const { isValidCertificateNo } = require('../utils/validators');
const certificateService = require('../services/certificateService');
const { STATUS } = certificateService;
const { buildPdf, sendPdf } = require('../services/issueService');

const router = express.Router();

/** Purpose certificates are now issued only from admin-created template links. */
router.post('/request', (req, res, next) => {
  next(new AppError(410, 'Purpose certificates must be issued from a template QR link provided by an administrator.'));
});

/**
 * GET /api/certificate/list   (admin session or x-api-key)
 * Optional query: ?limit=50&offset=0
 * NOTE: must be declared before "/:certificateNo".
 */
router.get(
  '/list',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const all = await certificateService.listCertificates();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      total: all.length,
      count: Math.min(limit, Math.max(all.length - offset, 0)),
      offset,
      data: all.slice(offset, offset + limit),
    });
  })
);

/**
 * GET /api/certificate/:certificateNo
 * Public verification. Returns the record if the certificate exists.
 * Add ?download=pdf to regenerate the certificate PDF from the stored record.
 * (The purpose field is left out of the JSON; it only appears on the PDF.)
 */
router.get(
  '/:certificateNo',
  asyncHandler(async (req, res) => {
    const certificateNo = String(req.params.certificateNo).trim().toUpperCase();
    if (!isValidCertificateNo(certificateNo)) {
      throw new AppError(400, 'The CA Reference No. must look like 2026-1029-001.');
    }

    const record = await certificateService.getCertificate(certificateNo);
    if (!record) throw new AppError(404, `No certificate was found with CA Reference No. ${certificateNo}.`);

    // A rejected certificate can no longer be verified or downloaded.
    if (record.status === STATUS.REJECTED) {
      throw new AppError(410, `Certificate ${record.certificateNo} has been rejected and is not valid.`);
    }

    if (req.query.download === 'pdf') {
      return sendPdf(res, await buildPdf(record), record.certificateNo);
    }

    // Only expose what a verifier needs (no purpose, row number, event ID or status).
    const publicRecord = {
      certificateNo: record.certificateNo,
      fullName: record.fullName,
      eventName: record.eventName,
      eventDate: record.eventDate,
      venue: record.venue,
      organization: record.organization, // only filled on no-event certificates
      issueDate: record.issueDate,
    };
    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, valid: true, data: publicRecord });
  })
);

module.exports = router;
