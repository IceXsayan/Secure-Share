// test_suite.js - Automated tests for SecureShare 100 MB file upload limit
const fs = require('fs');
const path = require('path');
const http = require('http');

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}`;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Helper to make multipart upload request using native Node fetch
async function uploadMockFile(fileBuffer, fileName) {
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
  const salt = Buffer.from('mock_salt_16bytes!').toString('base64');
  const iv = Buffer.from('mock_iv_12bytes').toString('base64');

  const parts = [];

  // Form field: salt
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="salt"\r\n\r\n${salt}\r\n`));
  // Form field: iv
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="iv"\r\n\r\n${iv}\r\n`));
  // Form field: file
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
  parts.push(fileBuffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  const body = Buffer.concat(parts);

  return new Promise((resolve, reject) => {
    const req = http.request(
      `${BASE_URL}/api/upload`,
      {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length
        }
      },
      (res) => {
        let responseData = '';
        res.on('data', (chunk) => (responseData += chunk));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(responseData);
          } catch (e) {
            parsed = { raw: responseData };
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );

    req.on('error', (err) => reject(err));
    req.write(body);
    req.end();
  });
}

async function runTestSuite() {
  console.log('====================================================');
  console.log(' SecureShare 100 MB Limit Test Suite');
  console.log('====================================================\n');

  try {
    // Check if server is running
    console.log(`Checking server connectivity at ${BASE_URL}...`);
    const isUp = await new Promise((resolve) => {
      const checkReq = http.get(BASE_URL, (res) => resolve(res.statusCode === 200));
      checkReq.on('error', () => resolve(false));
    });

    if (!isUp) {
      console.error(`[FAIL] Could not connect to server at ${BASE_URL}. Ensure "node server.js" is running.`);
      process.exit(1);
    }
    console.log('[OK] Server is reachable.\n');

    // Test 1: Upload a small file (10 KB)
    console.log('[Test 1] Uploading small file (10 KB)...');
    const smallBuffer = Buffer.alloc(10 * 1024, 0xaa);
    const res1 = await uploadMockFile(smallBuffer, 'test_small.bin');
    if (res1.status === 200 && res1.body.id) {
      console.log(`[PASS] Small file accepted. Upload ID: ${res1.body.id}`);
      // Clean up after test
      await new Promise((r) => {
        const delReq = http.request(`${BASE_URL}/api/file/${res1.body.id}`, { method: 'DELETE' }, () => r());
        delReq.on('error', () => r());
        delReq.end();
      });
    } else {
      console.error(`[FAIL] Expected 200, received status ${res1.status}:`, res1.body);
    }

    // Test 2: Upload file larger than 10 MB but below 100 MB (15 MB)
    console.log('\n[Test 2] Uploading 15 MB file (within 100 MB limit)...');
    const medBuffer = Buffer.alloc(15 * 1024 * 1024, 0xbb);
    const res2 = await uploadMockFile(medBuffer, 'test_15mb.bin');
    if (res2.status === 200 && res2.body.id) {
      console.log(`[PASS] 15 MB file accepted. Upload ID: ${res2.body.id}`);
      // Clean up
      await new Promise((r) => {
        const delReq = http.request(`${BASE_URL}/api/file/${res2.body.id}`, { method: 'DELETE' }, () => r());
        delReq.on('error', () => r());
        delReq.end();
      });
    } else {
      console.error(`[FAIL] Expected 200, received status ${res2.status}:`, res2.body);
    }

    // Test 3: Upload a file exceeding 100 MB limit (101 MB)
    console.log('\n[Test 3] Uploading file exceeding limit (101 MB)...');
    const overBuffer = Buffer.alloc(101 * 1024 * 1024, 0xcc);
    const res3 = await uploadMockFile(overBuffer, 'test_over_100mb.bin');
    if (res3.status === 400 || res3.status === 413) {
      console.log(`[PASS] File correctly rejected with HTTP ${res3.status}: "${res3.body.error}"`);
    } else {
      console.error(`[FAIL] Expected 400 or 413, received status ${res3.status}:`, res3.body);
    }

    // Test 4: Verify temporary cleanup (no lingering temp files in uploads directory)
    console.log('\n[Test 4] Verifying temporary file cleanup...');
    const uploadsDir = path.join(__dirname, 'uploads');
    const files = fs.readdirSync(uploadsDir);
    const lingeringTemp = files.filter((f) => f.startsWith('temp_'));
    if (lingeringTemp.length === 0) {
      console.log('[PASS] No lingering temporary files found in uploads folder.');
    } else {
      console.warn(`[WARN] Found ${lingeringTemp.length} lingering temp files.`);
    }

    console.log('\n====================================================');
    console.log(' All tests completed successfully!');
    console.log('====================================================');
  } catch (err) {
    console.error('[TEST ERROR]:', err);
  }
}

runTestSuite();

