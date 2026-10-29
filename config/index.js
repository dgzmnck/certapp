'use strict';

/**
 * Central configuration. Every setting comes from environment variables,
 * so no secrets are ever hardcoded in the repository.
 */
require('dotenv').config();

/**
 * Environment dashboards (Vercel, .env files) store the private key with
 * literal "\n" sequences and sometimes wrap it in quotes. Normalise it here.
 */
function normalisePrivateKey(raw) {
  if (!raw) return '';
  return raw.trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');
}

const config = {
  env: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT) || 3000,
  baseUrl: (process.env.BASE_URL || '').replace(/\/+$/, ''),
  timezone: process.env.CERT_TIMEZONE || 'Asia/Manila',
  adminApiKey: process.env.ADMIN_API_KEY || '',
  admin: {
    username: process.env.ADMIN_USERNAME || '',
    password: process.env.ADMIN_PASSWORD || '',
    sessionSecret: process.env.SESSION_SECRET || '',
    sessionHours: Number(process.env.SESSION_HOURS) || 8,
  },

  google: {
    clientEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
    privateKey: normalisePrivateKey(process.env.GOOGLE_PRIVATE_KEY),
    sheetId: process.env.GOOGLE_SHEET_ID || '',
    sheetName: process.env.GOOGLE_SHEET_NAME || 'Certificates',
    eventsSheetName: process.env.GOOGLE_EVENTS_SHEET_NAME || 'Events',
    signatoriesSheetName: process.env.GOOGLE_SIGNATORIES_SHEET_NAME || 'Signatories',
    purposeTemplatesSheetName: process.env.GOOGLE_PURPOSE_TEMPLATES_SHEET_NAME || 'PurposeTemplates',
  },

  branding: {
    issuerName: process.env.ISSUER_NAME || 'Your School / Organization Name',
    issuerAddress: process.env.ISSUER_ADDRESS || '',
    // Words separated by commas, bullets or | are shown with gold bullets between them.
    issuerMotto: process.env.ISSUER_MOTTO || '',
    logoFile: process.env.LOGO_FILE || 'logo.svg',
    // Banner images: a file name inside /public, or a full https:// URL.
    headerImage: (process.env.HEADER_IMAGE || '').trim(),
    footerImage: (process.env.FOOTER_IMAGE || '').trim(),
  },
};

module.exports = config;
