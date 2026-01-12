import express from 'express';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

import { authRequired } from '../utils/helpers.js';

const router = express.Router();

const ensureProofDir = async proofDir => {
  try {
    await fs.mkdir(proofDir, { recursive: true });
  } catch {
    // ignore
  }
};

const parseImagePayload = raw => {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('data:')) {
    const match = trimmed.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!match) return null;
    return {
      mime: match[1],
      base64: match[2]
    };
  }

  return { mime: 'image/jpeg', base64: trimmed };
};

const saveImage = async ({ orderId, payload, folder }) => {
  if (!orderId) throw new Error('orderId is required');
  if (!payload?.base64) throw new Error('imageData is required');

  const fileExt = payload.mime === 'image/png' ? 'png' : 'jpg';
  const fileName = `${orderId}-${crypto.randomUUID()}.${fileExt}`;
  const proofDir = path.resolve('uploads', folder);

  await ensureProofDir(proofDir);

  const buffer = Buffer.from(payload.base64, 'base64');
  await fs.writeFile(path.join(proofDir, fileName), buffer);

  return `/uploads/${folder}/${fileName}`;
};

router.post('/proof', authRequired, async (req, res) => {
  try {
    const orderId = String(req.body?.orderId || '').trim();
    const payload = parseImagePayload(req.body?.imageData);

    if (!orderId) return res.status(400).json({ error: 'orderId is required' });
    if (!payload?.base64) {
      return res.status(400).json({ error: 'imageData is required' });
    }

    const url = await saveImage({ orderId, payload, folder: 'proofs' });
    res.json({ ok: true, url });
  } catch (err) {
    console.error('PROOF UPLOAD ERROR:', err);
    res.status(500).json({ error: 'Failed to upload proof' });
  }
});

router.post('/return-photo', authRequired, async (req, res) => {
  try {
    const orderId = String(req.body?.orderId || '').trim();
    const payload = parseImagePayload(req.body?.imageData);

    if (!orderId) return res.status(400).json({ error: 'orderId is required' });
    if (!payload?.base64) {
      return res.status(400).json({ error: 'imageData is required' });
    }

    const url = await saveImage({ orderId, payload, folder: 'return-photos' });
    res.json({ ok: true, url });
  } catch (err) {
    console.error('RETURN PHOTO UPLOAD ERROR:', err);
    res.status(500).json({ error: 'Failed to upload return photo' });
  }
});

export default router;
