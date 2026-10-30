# Dynamic Certificate Management

Node.js + Express certificate issuance with Google Sheets storage, EJS/Puppeteer PDFs, Bootstrap 5/jQuery admin screens, QR links, and Vercel deployment. Certificate verification URLs and the existing daily certificate number format remain supported.

## Public and admin flow

| Page | Purpose |
|---|---|
| `/` | Verify a certificate and download its PDF |
| `/e/<EVENT_ID>` | Event QR landing page; attendee enters the fields configured for that event |
| `/p/<PURPOSE_ID>` | Purpose-template QR landing page; attendee enters full name and organization |
| `/admin` | Template Maker, Create Event, Events, Signatories, issued Certificates, and owner-managed Accounts |
| `/request` | Legacy informational page; new purpose certificates require an admin-created template link |

Admin creates an `EVENT` with event name/date/place and an active signatory, or creates a purpose template with place/date/purpose and an active signatory. Both create shareable URLs and QR images. Signature image files are stored in `public/uploads/signatures/`; Google Sheets stores their app-relative path, such as `/uploads/signatures/signature-<random-id>.png`.

Certificate Templates let an admin save a reusable certificate title, message, organizer-managed fields, and attendee-managed fields. Message variables use `_VARIABLE_KEY_` tokens; issue-date and signatory variables are supplied automatically. The Sample Certificate tab previews the current template with a selected signatory. Creating an event instance snapshots the template and its organizer values, assigns an active signatory, and creates a separate QR link. Attendee fields are collected on that QR page. The QR printed on each issued certificate opens the verifier with its reference number and recipient name prefilled; manual verification requires both values.

## Folder structure

```text
api/index.js
config/index.js
middleware/
routes/
  admin.js                 Admin CRUD, signatory upload, and QR endpoints
  certificate.js           Verification, PDF regeneration, and certificate list
  events.js                Public event flow
  purposeTemplates.js      Public purpose-template flow
services/
  certificateTemplateService.js Reusable template definitions and field validation
  certificateService.js    Certificate numbers and certificate records
  eventService.js           Event records
  googleSheetService.js     Shared Sheets client and schema migration
  issueService.js           Save -> QR -> PDF
  pdfService.js             EJS -> Puppeteer PDF generation
  purposeTemplateService.js PurposeTemplates tab
  signatureStorageService.js Local signature file upload/read
  signatoryService.js       Signatories tab
  qrService.js
utils/
views/certificate.ejs
public/
  admin.html, event.html, purpose.html, index.html
  js/admin.js, js/event.js, js/purpose.js
server.js
vercel.json
```

## Google Sheets schemas

Tabs are created automatically if missing. The existing certificate and event tabs are migrated by their header names on first use; rows are preserved and remapped.

**Events** (`GOOGLE_EVENTS_SHEET_NAME`, default `Events`):

| EVENT_ID | EVENT_NAME | EVENT_DATE | EVENT_PLACE | STATUS | CERTIFICATE_TYPE | SIGNATORY_ID | CREATED_AT | CERTIFICATE_TITLE | TEMPLATE_ID | MESSAGE_TEMPLATE | ADMIN_FIELDS | RECIPIENT_FIELDS | FIXED_VALUES |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

**PurposeTemplates** (`GOOGLE_PURPOSE_TEMPLATES_SHEET_NAME`, default `PurposeTemplates`):

| PURPOSE_ID | EVENT_PLACE | EVENT_DATE | PURPOSE | SIGNATORY_ID | STATUS | CREATED_AT |
|---|---|---|---|---|---|---|

**CertificateTemplates** (`GOOGLE_CERTIFICATE_TEMPLATES_SHEET_NAME`, default `CertificateTemplates`):

| TEMPLATE_ID | TEMPLATE_NAME | CERTIFICATE_TITLE | MESSAGE_TEMPLATE | ADMIN_FIELDS | RECIPIENT_FIELDS | STATUS | CREATED_AT |
|---|---|---|---|---|---|---|---|

**AdminAccounts** (`GOOGLE_ACCOUNTS_SHEET_NAME`, default `AdminAccounts`):

| USERNAME | PASSWORD_HASH | STATUS | CREATED_AT |
|---|---|---|---|

The environment-configured admin account is the owner and can create additional full-access admin accounts from the Accounts tab. Other accounts cannot create accounts. Account passwords are stored as salted scrypt hashes, not reversible encrypted text; account records are written to Google Sheets through the service account.

The Events tab appends `TEMPLATE_ID`, `MESSAGE_TEMPLATE`, `ADMIN_FIELDS`, `RECIPIENT_FIELDS`, and `FIXED_VALUES` to preserve each event's template snapshot and organizer-supplied values. The Certificates tab appends `TEMPLATE_ID`, `MESSAGE_TEMPLATE`, `FIELD_VALUES`, and `FIELD_LABELS` so verification downloads can reproduce the issued message and the admin certificate list can display custom details after template changes.

**Signatories** (`GOOGLE_SIGNATORIES_SHEET_NAME`, default `Signatories`):

| SIGNATORY_ID | NAME | TITLE | OFFICE | ESIGNATURE | STATUS | CREATED_AT |
|---|---|---|---|---|---|---|

**Certificates** (`GOOGLE_SHEET_NAME`, default `Certificates`):

| CERTIFICATE_NO | TYPE | FULL_NAME | ORGANIZATION | EVENT_ID | PURPOSE_ID | SIGNATORY_ID | ISSUE_DATE | STATUS |
|---|---|---|---|---|---|---|---|---|

To make historical PDFs reproducible when templates or signatory profiles later change, the Certificates tab also stores issuance snapshots: `EVENT_NAME`, `EVENT_PLACE`, `EVENT_DATE`, `PURPOSE`, `SIGNATORY_NAME`, `SIGNATORY_TITLE`, `SIGNATORY_OFFICE`, `SIGNATORY_ESIGNATURE`, and `CERTIFICATE_TITLE`. These are additional columns after the requested core schema. The signature snapshot is the relative path to the saved local image file, not image bytes. The issue date is kept in the reference number/QR verification data and is no longer printed as a separate footer line.

## API endpoints

### Public

| Method and route | Purpose |
|---|---|
| `GET /api/events/:eventId` | Event page details/status |
| `POST /api/events/:eventId/certificate` | Issue an existing event PDF from `{ "fullName": "..." }`, or a template event from `{ "fields": { "NAME": "...", "...": "..." } }` |
| `GET /api/purpose-templates/:purposeId` | Purpose page details/status |
| `POST /api/purpose-templates/:purposeId/certificate` | Issue purpose PDF from `{ "fullName": "...", "organization": "..." }` |
| `GET /api/certificate/:certificateNo?name=...` | Verify certificate using the reference number and recipient name; add `&download=pdf` to regenerate its PDF |
| `GET /api/certificate/list` | Admin-authenticated certificate list |

The old open-ended `POST /api/certificate/request` now returns HTTP 410. This prevents users from overriding event/place/date/purpose fields; they must use the URL for an admin-managed purpose template.

### Admin (session-authenticated)

| Method and route | Purpose |
|---|---|
| `POST /api/admin/login`, `POST /api/admin/logout`, `GET /api/admin/me` | Admin session |
| `GET /api/admin/events`, `POST /api/admin/events`, `PATCH /api/admin/events/:id` | Event management; list includes issued-certificate counts, and patch updates status and/or title (signatory is fixed at creation) |
| `GET /api/admin/certificate-templates`, `POST /api/admin/certificate-templates` | Save and list reusable certificate templates |
| `GET /api/admin/events/:id/qr` | Event QR PNG |
| `GET /api/admin/purpose-templates`, `POST /api/admin/purpose-templates`, `PATCH /api/admin/purpose-templates/:id` | Purpose-template management |
| `GET /api/admin/purpose-templates/:id/qr` | Purpose-template QR PNG |
| `GET /api/admin/signatories`, `POST /api/admin/signatories`, `PUT /api/admin/signatories/:id` | List/add/edit signatories; multipart image field is `eSignature` |
| `PATCH /api/admin/signatories/:id/status` | Activate/deactivate a signatory |
| `GET /api/admin/events/:id/certificates`, `GET /api/admin/certificates/no-event` | Issued certificate review; event details include recipient names and issue dates |
| `PATCH /api/admin/certificates/:certificateNo` | Reject/restore a certificate |

## Service and template behavior

- `googleSheetService` remains the shared Google Sheets client; it performs header-based migration, RAW writes, and retains existing certificate-number collision checks.
- `SignatoryService` and `PurposeTemplateService` own their sheet tabs. `signatureStorageService` uploads and retrieves PNG/JPEG/WebP files in `public/uploads/signatures/`.
- `issueService` stores the complete issuance snapshot before PDF generation. `certificate.ejs` renders the EVENT or PURPOSE wording and the selected signatory's uploaded e-signature, name, title, and office.
- The engine branches on `TYPE`, so future types (Recognition, Participation, Appreciation) can add a type-specific template/wording without changing number allocation, verification, QR, persistence, or Puppeteer infrastructure.

## Setup and deployment

1. Enable **Google Sheets API** in the Google Cloud project.
2. Share the spreadsheet with the service-account email as Editor.
3. Set the environment values in `.env` locally or Vercel:
   - Required: `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEET_ID`
   - Admin: `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SESSION_SECRET` (16+ characters)
   - Optional tabs: `GOOGLE_SHEET_NAME`, `GOOGLE_EVENTS_SHEET_NAME`, `GOOGLE_SIGNATORIES_SHEET_NAME`, `GOOGLE_PURPOSE_TEMPLATES_SHEET_NAME`, `GOOGLE_CERTIFICATE_TEMPLATES_SHEET_NAME`, `GOOGLE_ACCOUNTS_SHEET_NAME`
   - Optional: `BASE_URL`, `CERT_TIMEZONE`, `ISSUER_NAME`, `ISSUER_ADDRESS`, `ISSUER_MOTTO`, `LOGO_FILE`, `HEADER_IMAGE`, `FOOTER_IMAGE`, `ADMIN_API_KEY`
4. Do not configure `SIGNATORY_NAME`, `SIGNATORY_TITLE`, or `SIGNATORY_OFFICE`; signatories are managed in `/admin`.
5. Run `npm install`, populate `.env` from `.env.example`, then `npm run dev`. For production, deploy the repository to Vercel and set the same environment variables in Project Settings.

Signature files are written to `public/uploads/signatures/` and are served as static files. Back up this directory along with the spreadsheet: the Sheet stores only each relative path, not the image itself. The file upload limit is 2 MB; supported formats are PNG, JPEG, and WebP.

**Vercel limitation:** Vercel deployments do not provide durable writable storage for runtime uploads. This local-folder storage works on a persistent Node.js host or during local development, but uploads on Vercel may fail because the deployment filesystem is read-only. Files also cannot persist across deployments or be shared reliably between serverless instances. Use a persistent writable host or external durable file storage if signatures must be uploaded and available in production on Vercel.

## Implementation plan

The implementation is organized into these deployable phases:

1. **Schema compatibility:** expand the existing tabs and migrate old rows by column header without changing certificate numbers, issue dates, or event IDs.
2. **Signatory management:** add local signature image uploads and the Signatories admin screen; remove signatory configuration from environment-based branding.
3. **Template management:** add PurposeTemplates, active-signatory selection, status controls, and QR/link creation to the admin menu.
4. **Type-specific public forms:** keep event forms name-only and add the purpose form with name and organization; server-side data always comes from the chosen stored event/template.
5. **Shared issuance and verification:** persist type, IDs, issue data, and snapshots; use the existing numbering, QR, PDF, and verification pipelines.
6. **Future types:** add a type definition/wording branch in the shared EJS renderer and corresponding admin inputs while reusing the existing service and issuance flow.

## Migration plan

1. Back up the spreadsheet before deploying. Avoid simultaneous certificate issuance by old and new app versions during the first schema migration.
2. Deploy with the existing Sheet ID and service-account access. Do not rename or delete existing tabs.
3. On first read, the service migrates the old Certificates and Events row data into the expanded columns based on legacy header names. Existing certificate numbers, issue dates, names, event details, purpose, organization, status, and event IDs are retained.
4. Add signatories through `/admin` and upload their signatures. The new Signatories and PurposeTemplates tabs are created on first use.
5. For existing events, select an active signatory in the Events list and save it. Events can remain open while missing a signatory; their existing QR page explains that the organizer must assign one before certificate issuance. The original `/e/<EVENT_ID>` QR URLs remain valid.
6. Existing certificate verification URLs and numbers continue working. New events and purpose templates use the new schemas and save snapshot fields for future PDF regeneration.
7. Historical certificates had no signatory ID or uploaded signature to migrate; their regenerated PDFs retain their saved certificate details but cannot invent a historical signature.

## Certificate wording

**EVENT**

> TO WHOM IT MAY CONCERN: This is to certify that [FULL NAME] appeared and actively participated during the [EVENT NAME] held at [EVENT PLACE] on [EVENT DATE].

**PURPOSE**

> THIS IS TO CERTIFY THAT [FULL NAME] of [ORGANIZATION] was at [EVENT PLACE] on [EVENT DATE]. Purpose: [PURPOSE]

## Certificate numbers and verification

Numbers keep the existing `YYYY-mmdd-xxx` daily sequence (for example `2026-1029-001`); the old `COA-YYYY-000001` verification format remains accepted. Certificate QR codes still point to the existing public verification route. Rejected certificates no longer verify or download.
