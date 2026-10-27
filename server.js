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

// Multer disk storage streams incoming large files directly to disk chunks,
// preventing Node.js heap exhaustion / Out-Of-Memory crashes on 500 MB uploads.
const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB limit
const OVERHEAD_BYTES = 64 * 1024; // 64 KB overhead for envelope, filename header & auth tag

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    // Generate temporary filename until metadata is validated
    const tempName = `temp_${Date.now()}_${crypto.randomBytes(8).toString('hex')}.tmp`;
    cb(null, tempName);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES + OVERHEAD_BYTES }
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

// Periodic cleanup every 5 minutes: delete expired files and orphan temp files
setInterval(async () => {
  try {
    const files = await fsp.readdir(UPLOADS_DIR);
    const now = Date.now();
    let expiredCount = 0;

    for (const file of files) {
      const filePath = path.join(UPLOADS_DIR, file);

      // Clean up orphaned temp files older than 10 minutes
      if (file.startsWith('temp_') || file.endsWith('.tmp')) {
        try {
          const stat = await fsp.stat(filePath);
          if (now - stat.mtimeMs > 10 * 60 * 1000) {
            await fsp.unlink(filePath);
          }
        } catch (e) { /* ignore */ }
        continue;
      }

      if (file.endsWith('.json')) {
        const id = file.replace('.json', '');
        const jsonPath = filePath;

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
      if (req.file && req.file.path) {
        await fsp.unlink(req.file.path).catch(() => {});
      }
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
    // Move binary data first and await completion
    await fsp.rename(req.file.path, binPath);

    // Write JSON metadata LAST and await completion
    await fsp.writeFile(jsonPath, JSON.stringify(metadata, null, 2), 'utf8');

    console.log(`[UPLOAD SUCCESS] ID: ${id} (${req.file.size} bytes encrypted)`);

    // Return the file ID and share link
    res.json({
      id: id,
      link: `/download.html?id=${id}`
    });
  } catch (err) {
    if (req.file && req.file.path) {
      await fsp.unlink(req.file.path).catch(() => {});
    }
    console.error('[UPLOAD ERROR]:', err);
    res.status(500).json({ error: 'Failed to process file upload' });
  }
});

// GET /api/file/:id
// Returns metadata JSON: { salt, iv, expiresAt, fileSize, downloadUrl, data (optional for small files) }
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

    const stat = await fsp.stat(binPath);

    const responsePayload = {
      salt: meta.salt,
      iv: meta.iv,
      expiresAt: meta.expiresAt,
      fileSize: stat.size,
      downloadUrl: `/api/file/${id}/download`
    };

    // For backwards compatibility with smaller files (<= 10 MB), include inline Base64 data.
    // Omitted for large files to avoid V8 string limit crashes (512 MB string length cap).
    if (stat.size <= 10 * 1024 * 1024) {
      try {
        const fileBuffer = await fsp.readFile(binPath);
        responsePayload.data = fileBuffer.toString('base64');
      } catch (bufErr) {
        // Fallback without inline data
      }
    }

    console.log(`[GET SUCCESS] ID: ${id} metadata delivered (file size: ${stat.size} bytes)`);
    res.json(responsePayload);
  } catch (err) {
    console.error(`[GET ERROR] ID: ${id}`, err);
    res.status(500).json({ error: 'Failed to retrieve file' });
  }
});

// GET /api/file/:id/download
// Streams ciphertext binary directly without Base64 memory overhead
app.get('/api/file/:id/download', async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    console.warn(`[DOWNLOAD REJECTED] Invalid ID: ${id}`);
    return res.status(404).json({ error: 'This link has already been used or has expired' });
  }

  const binPath = path.join(UPLOADS_DIR, `${id}.bin`);
  const jsonPath = path.join(UPLOADS_DIR, `${id}.json`);

  if (!fs.existsSync(jsonPath) || !fs.existsSync(binPath)) {
    console.warn(`[DOWNLOAD 404] File not found or already deleted: ${id}`);
    return res.status(404).json({ error: 'This link has already been used or has expired' });
  }

  try {
    const metaContent = await fsp.readFile(jsonPath, 'utf8');
    const meta = JSON.parse(metaContent);

    if (Date.now() > meta.expiresAt) {
      console.warn(`[DOWNLOAD EXPIRED] File expired: ${id}`);
      await deleteUploadFiles(id);
      return res.status(404).json({ error: 'This link has already been used or has expired' });
    }

    const stat = await fsp.stat(binPath);
    console.log(`[DOWNLOAD STREAM] ID: ${id} (${stat.size} bytes streaming)`);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Disposition', `attachment; filename="${id}.bin"`);

    const fileStream = fs.createReadStream(binPath);
    fileStream.pipe(res);
  } catch (err) {
    console.error(`[DOWNLOAD ERROR] ID: ${id}`, err);
    res.status(500).json({ error: 'Failed to stream file' });
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
  // Clean up any temporary file created before limit was exceeded
  if (req.file && req.file.path) {
    fs.unlink(req.file.path, () => {});
  }
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    console.warn('[UPLOAD ERROR] File size exceeds 500 MB limit');
    return res.status(400).json({ error: 'File size exceeds maximum limit of 500 MB' });
  }
  if (err) {
    console.error('[SERVER ERROR]:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
  next();
});

// Start server listening on 0.0.0.0
const server = app.listen(PORT, HOST, () => {
  console.log(`[SERVER START] SecureShare server running at http://${HOST}:${PORT}`);
});

// Configure timeouts for large 500 MB file uploads and downloads
server.keepAliveTimeout = 650000;
server.headersTimeout = 660000;
server.requestTimeout = 30 * 60 * 1000; // 30 minutes

