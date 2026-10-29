'use strict';

/**
 * PDF service: EJS template -> HTML -> Puppeteer -> PDF buffer.
 *
 * On Vercel we use "puppeteer-core" together with "@sparticuz/chromium"
 * (a Chromium build small enough for serverless functions). For local
 * development we use the Chrome/Edge/Chromium installed on your machine.
 */

const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const config = require('../config');
const { AppError } = require('../utils/errors');
const { formatLongDate } = require('../utils/dates');
const signatureStorage = require('./signatureStorageService');

const ROOT = path.join(__dirname, '..');
const TEMPLATE_PATH = path.join(ROOT, 'views', 'certificate.ejs');
const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

const MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

/* ------------------------------------------------------------------ */
/* Asset loading (cached for the life of the process)                  */
/* ------------------------------------------------------------------ */

let cachedBootstrapCss; // undefined = not loaded yet, null = unavailable
const imageCache = new Map(); // setting -> data URI / URL / null

/** Reads Bootstrap's CSS from node_modules so it can be inlined. */
function loadBootstrapCss() {
  if (cachedBootstrapCss !== undefined) return cachedBootstrapCss;
  try {
    const cssPath = require.resolve('bootstrap/dist/css/bootstrap.min.css');
    cachedBootstrapCss = fs.readFileSync(cssPath, 'utf8');
  } catch (err) {
    console.warn('Bootstrap CSS not found locally; falling back to CDN link.');
    cachedBootstrapCss = null;
  }
  return cachedBootstrapCss;
}

/**
 * Resolves an image setting from the environment:
 *  - "https://..."  -> used as is (the browser downloads it while rendering)
 *  - "banner.png"   -> read from /public and embedded as a data URI
 * Returns null when empty or unreadable (the certificate renders without it).
 */
function loadImage(setting) {
  if (!setting) return null;
  if (imageCache.has(setting)) return imageCache.get(setting);

  let result = null;
  if (/^https:\/\//i.test(setting)) {
    result = setting;
  } else {
    try {
      // path.basename keeps the setting from escaping the public folder
      const file = path.join(ROOT, 'public', path.basename(setting));
      const mime = MIME_TYPES[path.extname(file).toLowerCase()];
      if (!mime) throw new Error('unsupported image type');
      result = `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
    } catch (err) {
      console.warn(`Image "${setting}" not loaded (${err.message}). Rendering without it.`);
    }
  }
  imageCache.set(setting, result);
  return result;
}

/* ------------------------------------------------------------------ */
/* HTML rendering                                                      */
/* ------------------------------------------------------------------ */

/**
 * Renders the certificate HTML.
 * @param {object} certificate saved record
 * @param {string} qrDataUri   QR code image as a data URI
 */
async function renderCertificateHtml(certificate, qrDataUri) {
  const signatureImage = certificate.signatoryESignature
    ? await signatureStorage.signatureDataUri(certificate.signatoryESignature)
    : null;
  return ejs.renderFile(TEMPLATE_PATH, {
    certificate,
    isPurpose: certificate.type === 'PURPOSE' || !certificate.eventName,
    signatory: {
      name: certificate.signatoryName || '',
      title: certificate.signatoryTitle || '',
      office: certificate.signatoryOffice || '',
    },
    signatureImage,
    qrDataUri,
    branding: config.branding,
    logoImage: loadImage(config.branding.logoFile),
    headerImage: loadImage(config.branding.headerImage),
    footerImage: loadImage(config.branding.footerImage),
    bootstrapCss: loadBootstrapCss(),
    eventDateLong: formatLongDate(certificate.eventDate),
    issueDateLong: formatLongDate(certificate.issueDate),
  });
}

/* ------------------------------------------------------------------ */
/* Browser management                                                  */
/* ------------------------------------------------------------------ */

let browserPromise = null;

/** Finds a locally installed Chrome/Chromium for development. */
function findLocalChrome() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;

  const candidates = {
    win32: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ],
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ],
    linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
  }[process.platform] || [];

  return candidates.find((p) => fs.existsSync(p)) || null;
}

async function launchBrowser() {
  if (IS_SERVERLESS) {
    return puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
  }

  const executablePath = findLocalChrome();
  if (!executablePath) {
    throw new AppError(
      500,
      'No local Chrome found. Install Google Chrome or set PUPPETEER_EXECUTABLE_PATH in .env.'
    );
  }
  return puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
  });
}

/** Returns a shared browser, relaunching it if it has crashed/closed. */
async function getBrowser() {
  if (browserPromise) {
    try {
      const browser = await browserPromise;
      if (browser.isConnected()) return browser;
    } catch (err) {
      /* fall through and relaunch */
    }
    browserPromise = null;
  }
  browserPromise = launchBrowser().catch((err) => {
    browserPromise = null;
    throw err;
  });
  return browserPromise;
}

/* ------------------------------------------------------------------ */
/* PDF generation                                                      */
/* ------------------------------------------------------------------ */

/**
 * Converts certificate HTML to an A4 landscape PDF.
 * @param {string} html
 * @returns {Promise<Buffer>}
 */
async function htmlToPdf(html) {
  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    // Make sure web fonts finished loading before printing
    await page.evaluate(() => document.fonts && document.fonts.ready);

    const pdf = await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    return Buffer.from(pdf);
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('PDF generation failed:', err);
    throw new AppError(500, 'Could not generate the PDF. Please try again.');
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

/** Convenience: record + QR -> PDF buffer. */
async function generateCertificatePdf(certificate, qrDataUri) {
  const html = await renderCertificateHtml(certificate, qrDataUri);
  return htmlToPdf(html);
}

module.exports = { generateCertificatePdf, renderCertificateHtml, htmlToPdf };
