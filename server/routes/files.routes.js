/*
 * Report & document file storage (PDF, DOCX, DOC, RTF, HTML, images) with metadata documents in
 * collection "files" so every workstation sees uploads instantly.
 */
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { convert, sofficePath } = require('../services/converter');

const MIME_BY_EXT = {
  pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  rtf: 'application/rtf', html: 'text/html', htm: 'text/html', txt: 'text/plain', csv: 'text/csv', json: 'application/json',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', dcm: 'application/dicom', odt: 'application/vnd.oasis.opendocument.text', zip: 'application/zip'
};

function guessMime(name, fallback) {
  const ext = String(name || '').split('.').pop().toLowerCase();
  return MIME_BY_EXT[ext] || fallback || 'application/octet-stream';
}

function filesRoutes(ctx, deps) {
  const { auth, audit } = deps;
  const router = express.Router();
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, ctx.filesDir),
    filename: (req, file, cb) => cb(null, 'f_' + crypto.randomBytes(10).toString('hex'))
  });
  const upload = multer({ storage, limits: { fileSize: 60 * 1024 * 1024, files: 100 } });

  async function createFileDoc({ id, name, mime, size, sha, meta, user }) {
    const doc = Object.assign({
      id, name, mime, size, sha256: sha, storage: 'server', source: 'upload', category: 'Other',
      patientId: '', patientName: '', mobile: '', email: '', testName: '', tags: [],
      createdAt: Date.now(), createdBy: user ? user.id : null, updatedAt: Date.now()
    }, meta || {});
    await ctx.saveDoc('files', doc, { actor: user, force: true });
    return doc;
  }

  function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

  router.get('/files/capabilities', auth.verifyToken, (req, res) => res.json({ libreoffice: !!sofficePath() }));

  router.post('/files', auth.verifyToken, upload.array('files', 100), async (req, res, next) => {
    try {
      let meta = {};
      try { meta = req.body.meta ? JSON.parse(req.body.meta) : {}; } catch (e) { meta = {}; }
      const perFile = Array.isArray(meta.perFile) ? meta.perFile : [];
      delete meta.perFile;
      const out = [];
      for (let i = 0; i < (req.files || []).length; i++) {
        const f = req.files[i];
        const name = Buffer.from(f.originalname, 'latin1').toString('utf8');
        const doc = await createFileDoc({
          id: f.filename, name, mime: f.mimetype && f.mimetype !== 'application/octet-stream' ? f.mimetype : guessMime(name),
          size: f.size, sha: sha256(f.path), meta: Object.assign({}, meta, perFile[i] || {}), user: req.user
        });
        out.push(doc);
      }
      await audit.log(req, 'files:uploaded', 'files', { count: out.length, names: out.map((d) => d.name).slice(0, 20) });
      res.status(201).json({ files: out });
    } catch (e) { next(e); }
  });

  async function sendFile(res, doc, download) {
    const p = path.join(ctx.filesDir, path.basename(doc.id));
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'File content missing on server' });
    res.setHeader('Content-Type', doc.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', (download ? 'attachment' : 'inline') + '; filename*=UTF-8\'\'' + encodeURIComponent(doc.name || 'file'));
    res.setHeader('Cache-Control', 'private, max-age=300');
    fs.createReadStream(p).pipe(res);
  }

  router.get('/files/:id/raw', auth.verifyToken, async (req, res, next) => {
    try {
      const doc = await ctx.store.getDoc('files', req.params.id);
      if (!doc || doc._deleted) return res.status(404).json({ error: 'Not found' });
      await sendFile(res, doc, req.query.download === '1');
    } catch (e) { next(e); }
  });

  router.delete('/files/:id', auth.verifyToken, auth.requirePermission('print:dispatch_signed_reports', 'DRAFT'), async (req, res, next) => {
    try {
      const doc = await ctx.store.getDoc('files', req.params.id);
      if (!doc) return res.status(404).json({ error: 'Not found' });
      await ctx.saveDoc('files', Object.assign({}, doc, { _deleted: true, updatedAt: Date.now() }), { actor: req.user, force: true });
      fs.rm(path.join(ctx.filesDir, path.basename(doc.id)), { force: true }, () => {});
      await audit.log(req, 'files:deleted', 'files/' + doc.id, { name: doc.name });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  router.post('/files/:id/convert', auth.verifyToken, async (req, res, next) => {
    try {
      const doc = await ctx.store.getDoc('files', req.params.id);
      if (!doc) return res.status(404).json({ error: 'Not found' });
      const to = String((req.body && req.body.to) || 'pdf').toLowerCase();
      if (!['pdf', 'docx', 'odt', 'html'].includes(to)) return res.status(400).json({ error: 'Unsupported target format' });
      const buf = fs.readFileSync(path.join(ctx.filesDir, path.basename(doc.id)));
      const result = await convert(buf, doc.name, to === 'html' ? 'html:XHTML Writer File:UTF8' : to);
      const id = 'f_' + crypto.randomBytes(10).toString('hex');
      fs.writeFileSync(path.join(ctx.filesDir, id), result.buffer);
      const out = await createFileDoc({
        id, name: doc.name.replace(/\.[^.]+$/, '') + '.' + to, mime: guessMime('x.' + to), size: result.buffer.length,
        sha: crypto.createHash('sha256').update(result.buffer).digest('hex'),
        meta: { category: doc.category, patientId: doc.patientId, patientName: doc.patientName, mobile: doc.mobile, email: doc.email, testName: doc.testName, source: 'converted', parentId: doc.id },
        user: req.user
      });
      res.json({ file: out });
    } catch (e) { next(e); }
  });

  return { router, sendFile, createFileDoc, guessMime };
}

module.exports = { filesRoutes, guessMime };
