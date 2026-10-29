'use strict';

const express = require('express');
const QRCode = require('qrcode');
const multer = require('multer');

const config = require('../config');
const auth = require('../services/authService');
const eventService = require('../services/eventService');
const certificateService = require('../services/certificateService');
const signatoryService = require('../services/signatoryService');
const purposeTemplateService = require('../services/purposeTemplateService');
const signatureStorageService = require('../services/signatureStorageService');
const { AppError } = require('../utils/errors');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAdmin } = require('../middleware/auth');
const {
  validateEventInput,
  validatePurposeTemplateInput,
  isValidEventId,
  isValidCertificateNo,
} = require('../utils/validators');

const router = express.Router();

/** Public base URL used in event links: BASE_URL, else the request's own host. */
function baseUrl(req) {
  return config.baseUrl || `${req.protocol}://${req.get('host')}`;
}

const eventLink = (req, eventId) => `${baseUrl(req)}/e/${eventId}`;
const purposeLink = (req, purposeId) => `${baseUrl(req)}/p/${purposeId}`;
const withLink = (req, event) => ({ ...event, link: eventLink(req, event.eventId) });
const purposeWithLink = (req, template) => ({ ...template, link: purposeLink(req, template.purposeId) });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

function parseSignatureUpload(req, res, next) {
  upload.single('eSignature')(req, res, (err) => {
    if (!err) return next();
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return next(new AppError(status, status === 413 ? 'Signature image must be 2 MB or smaller.' : 'Invalid signature image upload.'));
  });
}

function validateSignatureImage(file) {
  if (!file) return false;
  const buffer = file.buffer;
  if (file.mimetype === 'image/png') {
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (file.mimetype === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  if (file.mimetype === 'image/webp') {
    return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  }
  return false;
}

function signatoryInput(body) {
  const input = body || {};
  const value = {};
  const errors = {};
  [['name', 'Name', 120], ['title', 'Title', 160], ['office', 'Office', 200]].forEach(([key, label, max]) => {
    const text = typeof input[key] === 'string' ? input[key].replace(/\s+/g, ' ').trim() : '';
    value[key] = text;
    if (!text) errors[key] = `${label} is required.`;
    else if (text.length > max) errors[key] = `${label} must be ${max} characters or fewer.`;
  });
  return { value, errors };
}

/** Loads :eventId from the URL or throws 404. */
function parseEventId(req) {
  const eventId = String(req.params.eventId).toUpperCase();
  if (!isValidEventId(eventId)) throw new AppError(400, 'Invalid event ID.');
  return eventId;
}

/* ------------------------------ Session ------------------------------ */

/** POST /api/admin/login  { username, password } */
router.post('/login', (req, res, next) => {
  if (!auth.isConfigured()) {
    return next(
      new AppError(503, 'Admin login is not configured. Set ADMIN_USERNAME, ADMIN_PASSWORD and SESSION_SECRET (16+ characters).')
    );
  }
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !auth.verifyCredentials(username, password)) {
    return next(new AppError(401, 'Incorrect username or password.'));
  }
  auth.setSessionCookie(res, username);
  return res.json({ success: true });
});

/** POST /api/admin/logout */
router.post('/logout', (req, res) => {
  auth.clearSessionCookie(res);
  res.json({ success: true });
});

/** GET /api/admin/me  -> { authenticated: boolean } */
router.get('/me', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, authenticated: Boolean(auth.readSession(req)) });
});

/* ------------------------------ Events ------------------------------ */

/** GET /api/admin/events */
router.get(
  '/events',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const events = await eventService.listEvents();
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: events.map((e) => withLink(req, e)) });
  })
);

/** POST /api/admin/events  { eventName, eventDate, venue } */
router.post(
  '/events',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { value, errors } = validateEventInput(req.body);
    if (Object.keys(errors).length) {
      throw new AppError(400, 'Please correct the highlighted fields.', { fields: errors });
    }
    const signatory = await signatoryService.getSignatory(value.signatoryId);
    if (!signatory || signatory.status !== signatoryService.STATUS.ACTIVE) {
      throw new AppError(400, 'Select an active signatory.');
    }
    const event = await eventService.createEvent(value);
    res.status(201).json({ success: true, data: withLink(req, event) });
  })
);

/* ---------------------------- Signatories ---------------------------- */

router.get(
  '/signatories',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const signatories = await signatoryService.listSignatories();
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: signatories.map(({ rowNumber, ...item }) => item) });
  })
);

router.post(
  '/signatories',
  requireAdmin,
  parseSignatureUpload,
  asyncHandler(async (req, res) => {
    const { value, errors } = signatoryInput(req.body);
    if (!req.file || !validateSignatureImage(req.file)) errors.eSignature = 'Upload a valid PNG, JPEG, or WebP signature image.';
    if (Object.keys(errors).length) throw new AppError(400, 'Please correct the highlighted fields.', { fields: errors });
    value.eSignature = await signatureStorageService.uploadSignature(req.file);
    const signatory = await signatoryService.createSignatory(value);
    res.status(201).json({ success: true, data: signatory });
  })
);

router.put(
  '/signatories/:signatoryId',
  requireAdmin,
  parseSignatureUpload,
  asyncHandler(async (req, res) => {
    const { value, errors } = signatoryInput(req.body);
    if (req.file && !validateSignatureImage(req.file)) errors.eSignature = 'Upload a valid PNG, JPEG, or WebP signature image.';
    if (Object.keys(errors).length) throw new AppError(400, 'Please correct the highlighted fields.', { fields: errors });
    if (req.file) value.eSignature = await signatureStorageService.uploadSignature(req.file);
    const signatory = await signatoryService.updateSignatory(req.params.signatoryId, value);
    res.json({ success: true, data: signatory });
  })
);

router.patch(
  '/signatories/:signatoryId/status',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const signatory = await signatoryService.setStatus(req.params.signatoryId, req.body && req.body.status);
    res.json({ success: true, data: signatory });
  })
);

/* -------------------------- Purpose templates -------------------------- */

router.get(
  '/purpose-templates',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const templates = await purposeTemplateService.listPurposeTemplates();
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: templates.map((item) => purposeWithLink(req, item)) });
  })
);

router.post(
  '/purpose-templates',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { value, errors } = validatePurposeTemplateInput(req.body);
    if (Object.keys(errors).length) throw new AppError(400, 'Please correct the highlighted fields.', { fields: errors });
    const signatory = await signatoryService.getSignatory(value.signatoryId);
    if (!signatory || signatory.status !== signatoryService.STATUS.ACTIVE) {
      throw new AppError(400, 'Select an active signatory.');
    }
    const template = await purposeTemplateService.createPurposeTemplate(value);
    res.status(201).json({ success: true, data: purposeWithLink(req, template) });
  })
);

router.patch(
  '/purpose-templates/:purposeId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const template = await purposeTemplateService.setStatus(req.params.purposeId, req.body && req.body.status);
    res.json({ success: true, data: purposeWithLink(req, template) });
  })
);

router.get(
  '/purpose-templates/:purposeId/qr',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const template = await purposeTemplateService.getPurposeTemplate(req.params.purposeId);
    if (!template) throw new AppError(404, 'Purpose template not found.');
    const png = await QRCode.toBuffer(purposeLink(req, template.purposeId), {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 800,
      color: { dark: '#14213d', light: '#ffffff' },
    });
    res.set({
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store',
      ...(req.query.download ? { 'Content-Disposition': `attachment; filename="purpose-${template.purposeId}-qr.png"` } : {}),
    });
    res.end(png);
  })
);

/** PATCH /api/admin/events/:eventId updates status and/or event certificate settings. */
router.patch(
  '/events/:eventId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const eventId = parseEventId(req);
    const body = req.body || {};
    let event;
    if (body.status !== undefined) {
      if (!Object.values(eventService.STATUS).includes(body.status)) {
        throw new AppError(400, 'Status must be "Active" or "Closed".');
      }
      event = await eventService.setStatus(eventId, body.status);
    }
    if (body.signatoryId !== undefined || body.certificateTitle !== undefined) {
      const updates = {};
      if (body.signatoryId !== undefined) {
        const signatory = await signatoryService.getSignatory(body.signatoryId);
        if (!signatory || signatory.status !== signatoryService.STATUS.ACTIVE) {
          throw new AppError(400, 'Select an active signatory.');
        }
        updates.signatoryId = body.signatoryId;
      }
      if (body.certificateTitle !== undefined) {
        if (typeof body.certificateTitle !== 'string' || body.certificateTitle.trim().length > 120) {
          throw new AppError(400, 'Certificate title must be 120 characters or fewer.');
        }
        updates.certificateTitle = body.certificateTitle.trim();
      }
      event = await eventService.updateEventDetails(eventId, updates);
    }
    if (!event) throw new AppError(400, 'Provide a status or event setting to update.');
    res.json({ success: true, data: withLink(req, event) });
  })
);

/** GET /api/admin/events/:eventId/certificates  -> who availed a certificate */
router.get(
  '/events/:eventId/certificates',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const event = await eventService.getEvent(parseEventId(req));
    if (!event) throw new AppError(404, 'Event not found.');

    const records = await certificateService.listByEvent(event);
    const certificates = records
      .map(({ rowNumber, eventId, ...rest }) => rest) // hide internals
      .reverse(); // newest first

    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      data: { event: { eventId: event.eventId, eventName: event.eventName }, certificates },
    });
  })
);

/** GET /api/admin/certificates/no-event  -> certificates issued without an event */
router.get(
  '/certificates/no-event',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const records = await certificateService.listNoEvent();
    const certificates = records.map(({ rowNumber, eventId, ...rest }) => rest).reverse();
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: { certificates } });
  })
);

/**
 * PATCH /api/admin/certificates/:certificateNo  { status: "Valid" | "Rejected" }
 * Rejected certificates fail verification on the home page.
 */
router.patch(
  '/certificates/:certificateNo',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const certificateNo = String(req.params.certificateNo).trim().toUpperCase();
    if (!isValidCertificateNo(certificateNo)) throw new AppError(400, 'Invalid certificate number.');

    const status = req.body && req.body.status;
    if (!Object.values(certificateService.STATUS).includes(status)) {
      throw new AppError(400, 'Status must be "Valid" or "Rejected".');
    }

    const record = await certificateService.setStatus(certificateNo, status);
    res.json({ success: true, data: { certificateNo: record.certificateNo, status: record.status } });
  })
);

/** GET /api/admin/events/:eventId/qr[?download=1]  -> PNG of the event link */
router.get(
  '/events/:eventId/qr',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const eventId = parseEventId(req);
    const event = await eventService.getEvent(eventId);
    if (!event) throw new AppError(404, 'Event not found.');

    const png = await QRCode.toBuffer(eventLink(req, eventId), {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 800,
      color: { dark: '#14213d', light: '#ffffff' },
    });

    res.set({
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store',
      ...(req.query.download
        ? { 'Content-Disposition': `attachment; filename="event-${eventId}-qr.png"` }
        : {}),
    });
    res.end(png);
  })
);

module.exports = router;
