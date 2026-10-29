'use strict';

const express = require('express');
const purposeTemplateService = require('../services/purposeTemplateService');
const signatoryService = require('../services/signatoryService');
const { issueCertificate, sendPdf } = require('../services/issueService');
const { AppError } = require('../utils/errors');
const { asyncHandler } = require('../middleware/errorHandler');
const { validatePurposeCertificateInput } = require('../utils/validators');

const router = express.Router();

async function loadTemplate(req) {
  const purposeId = String(req.params.purposeId || '').trim().toUpperCase();
  const template = await purposeTemplateService.getPurposeTemplate(purposeId);
  if (!template) throw new AppError(404, 'This purpose certificate link is not valid.');
  return template;
}

router.get(
  '/:purposeId',
  asyncHandler(async (req, res) => {
    const template = await loadTemplate(req);
    const signatory = await signatoryService.getSignatory(template.signatoryId);
    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      data: {
        purposeId: template.purposeId,
        eventPlace: template.eventPlace,
        eventDate: template.eventDate,
        purpose: template.purpose,
        open: template.status === purposeTemplateService.STATUS.ACTIVE &&
          Boolean(signatory && signatory.status === signatoryService.STATUS.ACTIVE),
      },
    });
  })
);

router.post(
  '/:purposeId/certificate',
  asyncHandler(async (req, res) => {
    const template = await loadTemplate(req);
    if (template.status !== purposeTemplateService.STATUS.ACTIVE) {
      throw new AppError(403, 'This purpose certificate link is no longer issuing certificates.');
    }

    const { value, errors } = validatePurposeCertificateInput(req.body);
    if (Object.keys(errors).length) {
      throw new AppError(400, 'Please correct the highlighted fields.', { fields: errors });
    }

    const signatory = await signatoryService.getSignatory(template.signatoryId);
    if (!signatory || signatory.status !== signatoryService.STATUS.ACTIVE) {
      throw new AppError(503, 'The template signatory is unavailable. Please contact the organizers.');
    }

    const { record, pdf } = await issueCertificate({
      type: 'PURPOSE',
      purposeId: template.purposeId,
      fullName: value.fullName,
      organization: value.organization,
      eventName: '',
      eventDate: template.eventDate,
      venue: template.eventPlace,
      purpose: template.purpose,
      signatoryId: signatory.signatoryId,
      signatoryName: signatory.name,
      signatoryTitle: signatory.title,
      signatoryOffice: signatory.office,
      signatoryESignature: signatory.eSignature,
    });
    return sendPdf(res, pdf, record.certificateNo);
  })
);

module.exports = router;
