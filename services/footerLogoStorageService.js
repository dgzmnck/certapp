'use strict';

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const { AppError } = require('../utils/errors');

const ROOT = path.join(__dirname, '..');
const LOGO_DIRECTORY = path.join(ROOT, 'public', 'uploads', 'footer-logos');
const MANIFEST_PATH = path.join(ROOT, 'data', 'footer-logos.json');
const MIME_EXTENSION = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
const MAX_LOGOS = 8;
let operationQueue = Promise.resolve();

function serialize(operation) {
  const result = operationQueue.then(operation);
  operationQueue = result.catch(() => undefined);
  return result;
}

async function readLogos() {
  let contents;
  try {
    contents = await fs.readFile(MANIFEST_PATH, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    console.error('Footer logo manifest read failed:', err.message);
    throw new AppError(500, 'Could not load the saved certificate footer logos.');
  }

  let logos;
  try {
    logos = JSON.parse(contents);
  } catch (err) {
    throw new AppError(500, 'The saved certificate footer logo list is invalid.');
  }
  if (!Array.isArray(logos) || logos.some((logo) =>
    !logo || !/^[a-f0-9]{32}$/.test(logo.id || '') ||
    !/^footer-logo-[a-f0-9]{32}\.(png|jpg|webp)$/.test(logo.filename || '') ||
    typeof logo.name !== 'string'
  )) {
    throw new AppError(500, 'The saved certificate footer logo list is invalid.');
  }
  return logos;
}

function publicLogo(logo) {
  return { id: logo.id, name: logo.name, url: `/uploads/footer-logos/${logo.filename}` };
}

async function persistLogos(logos) {
  const temporaryPath = `${MANIFEST_PATH}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  try {
    await fs.mkdir(path.dirname(MANIFEST_PATH), { recursive: true });
    await fs.writeFile(temporaryPath, JSON.stringify(logos), { flag: 'wx' });
    await fs.rename(temporaryPath, MANIFEST_PATH);
  } catch (err) {
    try {
      await fs.unlink(temporaryPath);
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') console.error('Footer logo manifest cleanup failed:', cleanupError.message);
    }
    console.error('Footer logo manifest save failed:', err.message);
    if (process.env.VERCEL || ['EROFS', 'EACCES', 'EPERM'].includes(err.code)) {
      throw new AppError(503, 'Footer logo uploads require persistent writable storage. Runtime uploads are not durable on Vercel.');
    }
    throw new AppError(500, 'Could not save the certificate footer logo list.');
  }
}

async function removeFile(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Footer logo file cleanup failed:', err.message);
  }
}

async function listFooterLogos() {
  return (await readLogos()).map(publicLogo);
}

async function addFooterLogos(files) {
  return serialize(async () => {
    const logos = await readLogos();
    if (logos.length + files.length > MAX_LOGOS) {
      throw new AppError(400, `You can add up to ${MAX_LOGOS} footer logos.`);
    }

    const added = [];
    try {
      await fs.mkdir(LOGO_DIRECTORY, { recursive: true });
      for (const file of files) {
        const extension = MIME_EXTENSION[file.mimetype];
        const id = crypto.randomBytes(16).toString('hex');
        const filename = `footer-logo-${id}.${extension}`;
        const name = String(file.originalname || 'Logo')
          .replace(/^.*[\\/]/, '')
          .replace(/[\u0000-\u001F\u007F]/g, '')
          .slice(0, 100) || 'Logo';
        const logo = { id, filename, name };
        added.push(logo);
        await fs.writeFile(path.join(LOGO_DIRECTORY, filename), file.buffer, { flag: 'wx' });
      }
      const updated = logos.concat(added);
      await persistLogos(updated);
      return updated.map(publicLogo);
    } catch (err) {
      await Promise.all(added.map((logo) => removeFile(path.join(LOGO_DIRECTORY, logo.filename))));
      if (err instanceof AppError) throw err;
      console.error('Footer logo upload failed:', err.message);
      if (process.env.VERCEL || ['EROFS', 'EACCES', 'EPERM'].includes(err.code)) {
        throw new AppError(503, 'Footer logo uploads require persistent writable storage. Runtime uploads are not durable on Vercel.');
      }
      throw new AppError(500, 'Could not save the uploaded certificate footer logo.');
    }
  });
}

async function reorderFooterLogos(ids) {
  return serialize(async () => {
    const logos = await readLogos();
    if (!Array.isArray(ids) || ids.length !== logos.length ||
      new Set(ids).size !== logos.length ||
      ids.some((id) => !logos.some((logo) => logo.id === id))
    ) {
      throw new AppError(400, 'The new logo order must include every saved logo exactly once.');
    }
    const byId = new Map(logos.map((logo) => [logo.id, logo]));
    const ordered = ids.map((id) => byId.get(id));
    await persistLogos(ordered);
    return ordered.map(publicLogo);
  });
}

async function removeFooterLogo(id) {
  return serialize(async () => {
    if (!/^[a-f0-9]{32}$/.test(id || '')) throw new AppError(400, 'Invalid footer logo ID.');
    const logos = await readLogos();
    const logo = logos.find((item) => item.id === id);
    if (!logo) throw new AppError(404, 'Footer logo not found.');
    const updated = logos.filter((item) => item.id !== id);
    await persistLogos(updated);
    const filePath = path.join(LOGO_DIRECTORY, logo.filename);
    try {
      await fs.unlink(filePath);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('Footer logo file removal failed:', err.message);
        throw new AppError(500, 'The logo was removed from certificates, but its image file could not be deleted.');
      }
    }
    return updated.map(publicLogo);
  });
}

async function footerLogoDataUris() {
  const logos = await readLogos();
  return Promise.all(logos.map(async (logo) => {
    const extension = path.extname(logo.filename).slice(1);
    const mimeType = extension === 'jpg' ? 'image/jpeg' : `image/${extension}`;
    try {
      const buffer = await fs.readFile(path.join(LOGO_DIRECTORY, logo.filename));
      return { id: logo.id, name: logo.name, dataUri: `data:${mimeType};base64,${buffer.toString('base64')}` };
    } catch (err) {
      if (err.code === 'ENOENT') throw new AppError(500, `Footer logo "${logo.name}" is missing from storage.`);
      console.error('Footer logo file read failed:', err.message);
      throw new AppError(500, 'Could not read a saved certificate footer logo.');
    }
  }));
}

module.exports = {
  MAX_LOGOS,
  addFooterLogos,
  footerLogoDataUris,
  listFooterLogos,
  removeFooterLogo,
  reorderFooterLogos,
};
