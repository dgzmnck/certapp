'use strict';

const express = require('express');

const eventService = require('../services/eventService');
const signatoryService = require('../services/signatoryService');
const certificateTemplateService = require('../services/certificateTemplateService');
const { issueCertificate, sendPdf } = require('../services/issueService');
const { AppError } = require('../utils/errors');
const { asyncHandler } = require('../middleware/errorHandler');
const { validateAttendeeInput, isValidEventId } = require('../utils/validators');

const router = express.Router();

/** Finds the event from the URL or throws 400/404. */
async function loadEvent(req) {
  const eventId = String(req.params.eventId).toUpperCase();
  if (!isValidEventId(eventId)) throw new AppError(404, 'This event link is not valid.');
  const event = await eventService.getEvent(eventId);
  if (!event) throw new AppError(404, 'This event link is not valid.');
  return event;
}

/** GET /api/events/:eventId  -> public event details shown on the QR page */
router.get(
  '/:eventId',
  asyncHandler(async (req, res) => {
    const event = await loadEvent(req);
    const signatory = await signatoryService.getSignatory(event.signatoryId);
    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      data: {
        eventId: event.eventId,
        eventName: event.eventName,
        eventDate: event.eventDate,
        venue: event.venue,
        certificateType: event.certificateType || 'EVENT',
        certificateTitle: event.certificateTitle || '',
        templateMode: Boolean(event.templateId),
        recipientFields: event.recipientFields || [],
        fixedFieldSummary: (event.adminFields || []).map((field) => ({
          key: field.key,
          label: field.label,
          value: (event.fixedValues || {})[field.key] || '',
        })).filter((field) => field.value),
        open: event.status === eventService.STATUS.ACTIVE,
        signatoryReady: Boolean(signatory && signatory.status === signatoryService.STATUS.ACTIVE),
      },
    });
  })
);

/**
 * POST /api/events/:eventId/certificate
 * Legacy events accept { fullName }; template events accept configured
 * attendee values under { fields }.
 */
router.post(
  '/:eventId/certificate',
  asyncHandler(async (req, res) => {
    const event = await loadEvent(req);
    if (event.status !== eventService.STATUS.ACTIVE) {
      throw new AppError(403, 'This event is no longer issuing certificates.');
    }

    const dynamicEvent = Boolean(event.templateId);
    const dynamicValues = dynamicEvent
      ? certificateTemplateService.validateFieldValues(req.body && req.body.fields, event.recipientFields)
      : null;
    const { value, errors } = dynamicEvent
      ? { value: { fullName: dynamicValues.values.NAME || '' }, errors: dynamicValues.errors }
      : validateAttendeeInput(req.body);
    if (Object.keys(errors).length) {
      throw new AppError(400, 'Please correct the highlighted fields.', { fields: errors });
    }

    const signatory = await signatoryService.getSignatory(event.signatoryId);
    if (!signatory || signatory.status !== signatoryService.STATUS.ACTIVE) {
      throw new AppError(503, 'The event signatory is unavailable. Please contact the organizers.');
    }

    const { record, pdf } = await issueCertificate({
      type: 'EVENT',
      eventId: event.eventId,
      fullName: value.fullName,
      eventName: event.eventName,
      eventDate: event.eventDate,
      venue: event.venue,
      certificateTitle: event.certificateTitle,
      signatoryId: signatory.signatoryId,
      signatoryName: signatory.name,
      signatoryTitle: signatory.title,
      signatoryOffice: signatory.office,
      signatoryESignature: signatory.eSignature,
      ...(dynamicEvent ? {
        templateId: event.templateId,
        messageTemplate: event.messageTemplate,
        fieldValues: { ...event.fixedValues, ...dynamicValues.values },
        fieldLabels: Object.fromEntries(
          [...event.adminFields, ...event.recipientFields].map((field) => [field.key, field.label])
        ),
      } : {}),
    });
    return sendPdf(res, pdf, record.certificateNo);
  })
);

module.exports = router;
