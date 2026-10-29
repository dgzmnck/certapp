'use strict';

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const { AppError } = require('../utils/errors');

const SIGNATURE_DIRECTORY = path.join(__dirname, '..', 'public', 'uploads', 'signatures');
const MIME_EXTENSION = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
const MIME_BY_EXTENSION = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
const imageCache = new Map();

function parseSignaturePath(signaturePath) {
  const match = /^\/uploads\/signatures\/(signature-[a-f0-9]{32}\.(?:png|jpg|webp))$/i.exec(signaturePath || '');
  if (!match) throw new AppError(404, 'Signature image not found.');
  return { filename: match[1], extension: path.extname(match[1]).slice(1).toLowerCase() };
}

async function uploadSignature(file) {
  const extension = MIME_EXTENSION[file.mimetype];
  if (!extension) throw new AppError(400, 'Signature must be a PNG, JPEG, or WebP image.');

  const filename = `signature-${crypto.randomBytes(16).toString('hex')}.${extension}`;
  const filePath = path.join(SIGNATURE_DIRECTORY, filename);
  try {
    await fs.mkdir(SIGNATURE_DIRECTORY, { recursive: true });
    await fs.writeFile(filePath, file.buffer, { flag: 'wx' });
    return `/uploads/signatures/${filename}`;
  } catch (err) {
    console.error('Local signature image save failed:', err.message);
    if (process.env.VERCEL) {
      throw new AppError(
        503,
        'Vercel does not provide durable writable application folders for signature uploads. Use a persistent Node.js host.'
      );
    }
    throw new AppError(
      500,
      'Could not save the signature image in public/uploads/signatures. The application filesystem must be writable.'
    );
  }
}

async function downloadSignature(signaturePath) {
  const { filename, extension } = parseSignaturePath(signaturePath);
  try {
    const buffer = await fs.readFile(path.join(SIGNATURE_DIRECTORY, filename));
    return { buffer, mimeType: MIME_BY_EXTENSION[extension] };
  } catch (err) {
    if (err.code === 'ENOENT') throw new AppError(404, 'Signature image not found in public/uploads/signatures.');
    console.error('Local signature image read failed:', err.message);
    throw new AppError(500, 'Could not read the stored signature image.');
  }
}

async function signatureDataUri(signaturePath) {
  if (!signaturePath) return null;
  if (!imageCache.has(signaturePath)) {
    imageCache.set(signaturePath, downloadSignature(signaturePath).then(({ buffer, mimeType }) =>
      `data:${mimeType};base64,${buffer.toString('base64')}`
    ).catch((err) => {
      imageCache.delete(signaturePath);
      throw err;
    }));
  }
  return imageCache.get(signaturePath);
}

module.exports = { uploadSignature, downloadSignature, signatureDataUri };
