'use strict';

/**
 * Express application.
 *  - Local:  node server.js   (listens on PORT)
 *  - Vercel: api/index.js re-exports this app as a serverless function
 */

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const certificateRoutes = require('./routes/certificate');
const adminRoutes = require('./routes/admin');
const eventRoutes = require('./routes/events');
const purposeTemplateRoutes = require('./routes/purposeTemplates');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

// Vercel sits behind a proxy; needed so rate limiting sees the real client IP.
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Security headers. The CSP allows only the CDNs used by public/index.html.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://cdn.jsdelivr.net', 'https://code.jquery.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  })
);
app.use(compression());
app.use(express.json({ limit: '10kb' }));

// Basic abuse protection (per server instance).
// Event QR page: issuing certificates is the heaviest operation.
const generateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please wait a minute and try again.' },
});

// Public verification: also makes guessing certificate numbers impractical.
const lookupLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many lookups. Please wait a minute and try again.' },
});

// Slow down password guessing on the admin login (per server instance).
const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many failed login attempts. Please try again in 5 minutes.' },
});

// Static files (on Vercel, /public is served by the CDN automatically).
app.use(express.static(path.join(__dirname, 'public'), { maxAge: config.isProduction ? '1h' : 0 }));

// Health check
app.get('/api/health', (req, res) => res.json({ success: true, status: 'ok' }));

// Public issuer branding for the verifier page.
app.get('/api/branding', (req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.json({
    success: true,
    data: {
      issuerName: config.branding.issuerName,
      issuerAddress: config.branding.issuerAddress,
    },
  });
});

// Pretty URLs. On Vercel these are handled by the rewrites in vercel.json.
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/e/:eventId', (req, res) => res.sendFile(path.join(__dirname, 'public', 'event.html')));
app.get('/p/:purposeId', (req, res) => res.sendFile(path.join(__dirname, 'public', 'purpose.html')));
app.get('/request', (req, res) => res.sendFile(path.join(__dirname, 'public', 'request.html')));

// API
app.post('/api/admin/login', loginLimiter);
app.get('/api/certificate/:certificateNo', lookupLimiter);
app.post('/api/events/:eventId/certificate', generateLimiter);
app.post('/api/purpose-templates/:purposeId/certificate', generateLimiter);
app.post('/api/certificate/request', generateLimiter);

app.use('/api/admin', adminRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/purpose-templates', purposeTemplateRoutes);
app.use('/api/certificate', certificateRoutes);

app.use('/api', notFound);
app.use(errorHandler);

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`Certificate app running at http://localhost:${config.port}`);
  });
}

module.exports = app;
