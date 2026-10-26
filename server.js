const express = require('express');
const multer = require('multer');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const ONE_HOUR_MS = 60 * 60 * 1000; // 1 hour expiration

// Ensure uploads folder exists on startup
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Multer memory storage (keeps file in memory buffer before writing to disk)
// Limit allows 10 MB plaintext plus small cryptographic header/tag overhead (64 KB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: (10 * 1024 * 1024) + (64 * 1024) }
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper to validate 16-byte hex ID (32 hex characters) to prevent directory traversal
function isValidId(id) {
  return typeof id === 'string' && /^[a-f0-9]{32}$/i.test(id);
}

// Helper to safely delete file pair (bin and json)
async function deleteUploadFiles(id) {
  const binPath = path.join(UPLOADS_DIR, `${id}.bin`);
  const jsonPath = path.join(UPLOADS_DIR, `${id}.json`);

  try {
    if (fs.existsSync(binPath)) await fsp.unlink(binPath);
  } catch (e) { /* ignore */ }

  try {
    if (fs.existsSync(jsonPath)) await fsp.unlink(jsonPath);
  } catch (e) { /* ignore */ }
}

// Periodic cleanup every 5 minutes: delete expired files only
setInterval(async () => {
  try {
    const files = await fsp.readdir(UPLOADS_DIR);
    const now = Date.now();
    let expiredCount = 0;

    for (const file of files) {
      if (file.endsWith('.json')) {
        const id = file.replace('.json', '');
        const jsonPath = path.join(UPLOADS_DIR, file);

        try {
          const content = await fsp.readFile(jsonPath, 'utf8');
          const meta = JSON.parse(content);
          // Delete only if expired
          if (meta.expiresAt && now > meta.expiresAt) {
            await deleteUploadFiles(id);
            expiredCount++;
          }
        } catch (e) {
          // If metadata is corrupted, check mtime to avoid touching newly uploaded files
          try {
            const stat = await fsp.stat(jsonPath);
            if (now - stat.mtimeMs > 60000) {
              await deleteUploadFiles(id);
              expiredCount++;
            }
          } catch (statErr) { /* ignore */ }
        }
      }
    }

    if (expiredCount > 0) {
      console.log(`[CLEANUP] Deleted ${expiredCount} expired files at ${new Date().toISOString()}`);
    }
  } catch (err) {
    console.error('[CLEANUP ERROR]:', err.message);
  }
}, 5 * 60 * 1000);

// POST /api/upload
// Receives encrypted blob, salt (base64), and IV (base64)
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file || !req.body.salt || !req.body.iv) {
      console.warn('[UPLOAD REJECTED] Missing encrypted file, salt, or IV');
      return res.status(400).json({ error: 'Missing encrypted file, salt, or IV' });
    }

    // Generate random 16-byte hex ID
    const id = crypto.randomBytes(16).toString('hex');
    const now = Date.now();

    // Prepare metadata
    const metadata = {
      salt: req.body.salt,
      iv: req.body.iv,
      createdAt: now,
      expiresAt: now + ONE_HOUR_MS
    };

    const binPath = path.join(UPLOADS_DIR, `${id}.bin`);
    const jsonPath = path.join(UPLOADS_DIR, `${id}.json`);

    // Race-condition prevention:
    // Write binary data first and await completion
    await fsp.writeFile(binPath, req.file.buffer);

    // Write JSON metadata LAST and await completion
    await fsp.writeFile(jsonPath, JSON.stringify(metadata, null, 2), 'utf8');

    console.log(`[UPLOAD SUCCESS] ID: ${id} (${req.file.buffer.length} bytes encrypted)`);

    // Return the file ID and share link
    res.json({
      id: id,
      link: `/download.html?id=${id}`
    });
  } catch (err) {
    console.error('[UPLOAD ERROR]:', err);
    res.status(500).json({ error: 'Failed to process file upload' });
  }
});

// GET /api/file/:id
// Returns JSON with { salt, iv, data, expiresAt, fileSize }
// Server does NOT delete the file on GET
app.get('/api/file/:id', async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    console.warn(`[GET REJECTED] Invalid ID: ${id}`);
    return res.status(404).json({ error: 'This link has already been used or has expired' });
  }

  const binPath = path.join(UPLOADS_DIR, `${id}.bin`);
  const jsonPath = path.join(UPLOADS_DIR, `${id}.json`);

  // Check both files exist
  if (!fs.existsSync(jsonPath) || !fs.existsSync(binPath)) {
    console.warn(`[GET 404] File not found or already deleted: ${id}`);
    return res.status(404).json({ error: 'This link has already been used or has expired' });
  }

  try {
    const metaContent = await fsp.readFile(jsonPath, 'utf8');
    const meta = JSON.parse(metaContent);

    // Check expiration
    if (Date.now() > meta.expiresAt) {
      console.warn(`[GET EXPIRED] File expired: ${id}`);
      await deleteUploadFiles(id);
      return res.status(404).json({ error: 'This link has already been used or has expired' });
    }

    // Read ciphertext binary buffer and encode as Base64
    const fileBuffer = await fsp.readFile(binPath);
    const dataBase64 = fileBuffer.toString('base64');

    console.log(`[GET SUCCESS] ID: ${id} (${fileBuffer.length} bytes delivered)`);

    // Return JSON payload with metadata including expiresAt and fileSize for recipient UI
    res.json({
      salt: meta.salt,
      iv: meta.iv,
      data: dataBase64,
      expiresAt: meta.expiresAt,
      fileSize: fileBuffer.length
    });
  } catch (err) {
    console.error(`[GET ERROR] ID: ${id}`, err);
    res.status(500).json({ error: 'Failed to retrieve file' });
  }
});

// DELETE /api/file/:id
// Called by client only after successful decryption to remove file from server
app.delete('/api/file/:id', async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    console.warn(`[DELETE REJECTED] Invalid ID: ${id}`);
    return res.status(400).json({ error: 'Invalid file ID' });
  }

  await deleteUploadFiles(id);
  console.log(`[DELETE SUCCESS] File deleted from server: ${id}`);
  res.json({ message: 'File deleted successfully from server' });
});

// Handle multer file size limit error
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    console.warn('[UPLOAD ERROR] File size exceeds 10 MB limit');
    return res.status(400).json({ error: 'File size exceeds maximum limit of 10 MB' });
  }
  if (err) {
    console.error('[SERVER ERROR]:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
  next();
});

// Start server listening on 0.0.0.0
app.listen(PORT, HOST, () => {
  console.log(`[SERVER START] SecureShare server running at http://${HOST}:${PORT}`);
});
