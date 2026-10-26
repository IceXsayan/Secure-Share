/**
 * crypto.js - Client-Side Cryptography Utilities
 * 
 * Uses the Web Crypto API (window.crypto.subtle):
 * 1. PBKDF2 with SHA-256 (100,000 iterations) for key derivation from password.
 * 2. AES-256-GCM for authenticated encryption and decryption.
 * 3. SHA-256 digest for pre-encryption integrity fingerprinting.
 * 4. Base64 encoding/decoding for consistent binary data handling.
 * 5. Password strength evaluation and cryptographic password generator.
 */

// Convert byte array (Uint8Array) to Hex string
function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Convert Hex string back to Uint8Array
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// Convert byte array (Uint8Array) to Base64 string safely even for large buffers
function bytesToBase64(bytes) {
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

// Convert Base64 string back to Uint8Array
function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Derive an AES-256-GCM key from a password string and a 16-byte salt
 * using PBKDF2 with SHA-256 and 100,000 iterations.
 */
async function deriveKey(password, salt) {
  const encoder = new TextEncoder();

  // 1. Import raw password as key material for PBKDF2
  const passwordKey = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  // 2. Derive AES-GCM 256-bit key
  const aesKey = await window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  return aesKey;
}

/**
 * Pack the filename and SHA-256 hash into a binary header before the file bytes:
 * [4 bytes: uint32 filename length (big-endian)]
 * [N bytes: filename UTF-8 bytes]
 * [32 bytes: SHA-256 raw hash bytes]
 * [M bytes: file content bytes]
 */
function packPlaintext(fileName, fileBuffer, hashBytes) {
  const encoder = new TextEncoder();
  const nameBytes = encoder.encode(fileName);
  const fileBytes = fileBuffer instanceof Uint8Array 
    ? fileBuffer 
    : new Uint8Array(fileBuffer);

  // Total buffer length: 4 (uint32) + name length + 32 (SHA-256) + file bytes
  const totalLength = 4 + nameBytes.length + 32 + fileBytes.byteLength;
  const combined = new Uint8Array(totalLength);
  const dataView = new DataView(combined.buffer);

  // 1. Store filename length in first 4 bytes (big-endian)
  dataView.setUint32(0, nameBytes.length, false);

  // 2. Store filename UTF-8 bytes
  combined.set(nameBytes, 4);

  // 3. Store 32-byte SHA-256 hash
  combined.set(hashBytes, 4 + nameBytes.length);

  // 4. Store original file content bytes
  combined.set(fileBytes, 4 + nameBytes.length + 32);

  return combined;
}

/**
 * Unpack decrypted binary back into original filename, SHA-256 hash, and file data
 */
function unpackPlaintext(decryptedBuffer) {
  // Minimum header size: 4 bytes (nameLength) + 0 bytes (name) + 32 bytes (SHA-256) = 36 bytes
  if (decryptedBuffer.byteLength < 36) {
    throw new Error('Corrupted file: invalid header size');
  }

  const dataView = new DataView(decryptedBuffer);
  const nameLength = dataView.getUint32(0, false);

  if (4 + nameLength + 32 > decryptedBuffer.byteLength) {
    throw new Error('Corrupted file: invalid filename or hash header');
  }

  // 1. Extract filename
  const nameBytes = new Uint8Array(decryptedBuffer, 4, nameLength);
  const fileName = new TextDecoder().decode(nameBytes);

  // 2. Extract original SHA-256 hash (32 bytes)
  const hashBytes = new Uint8Array(decryptedBuffer, 4 + nameLength, 32);
  const originalHashHex = bytesToHex(hashBytes);

  // 3. Extract original file content bytes
  const fileData = decryptedBuffer.slice(4 + nameLength + 32);

  return { fileName, fileData, originalHashHex };
}

/**
 * Encrypt a File object with a user password.
 * Computes original SHA-256 hash, packs it into the encrypted payload, and encrypts with AES-256-GCM.
 * Returns: { encryptedBlob, saltBase64, ivBase64, fileHashHex }
 */
async function encryptFile(file, password) {
  // Step 1: Read file content into ArrayBuffer
  const fileBuffer = await file.arrayBuffer();

  // Step 2: Compute SHA-256 integrity hash of original plaintext before encryption
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', fileBuffer);
  const hashBytes = new Uint8Array(hashBuffer);
  const fileHashHex = bytesToHex(hashBytes);

  // Step 3: Generate 16-byte random salt and 12-byte random IV
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  // Step 4: Derive AES-256 key from password + salt via PBKDF2 (100,000 iterations)
  const key = await deriveKey(password, salt);

  // Step 5: Pack filename, SHA-256 hash, and file data into combined buffer
  const packedData = packPlaintext(file.name, fileBuffer, hashBytes);

  // Step 6: Encrypt packed payload using AES-GCM
  const encryptedBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    packedData
  );

  return {
    encryptedBlob: new Blob([encryptedBuffer], { type: 'application/octet-stream' }),
    saltBase64: bytesToBase64(salt),
    ivBase64: bytesToBase64(iv),
    fileHashHex: fileHashHex
  };
}

/**
 * Decrypt encrypted Uint8Array or ArrayBuffer using password, saltBase64, and ivBase64.
 * Verifies SHA-256 integrity hash against recomputed hash of decrypted content.
 * Returns: { fileName, fileData, originalHashHex, recomputedHashHex, isIntegrityVerified }
 * Throws clear error on incorrect password or corrupted ciphertext.
 */
async function decryptFile(encryptedBufferOrBytes, password, saltBase64, ivBase64) {
  try {
    const salt = base64ToBytes(saltBase64);
    const iv = base64ToBytes(ivBase64);

    // Step 1: Derive the same AES key using password + salt
    const key = await deriveKey(password, salt);

    // Step 2: Ensure input is BufferSource (Uint8Array)
    const encryptedData = (encryptedBufferOrBytes instanceof Uint8Array)
      ? encryptedBufferOrBytes
      : new Uint8Array(encryptedBufferOrBytes);

    // Step 3: Decrypt using AES-GCM (verifies authentication tag automatically)
    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      encryptedData
    );

    // Step 4: Unpack filename, stored SHA-256 hash, and original file content
    const { fileName, fileData, originalHashHex } = unpackPlaintext(decryptedBuffer);

    // Step 5: Recompute SHA-256 hash of decrypted bytes and compare
    const recomputedHashBuffer = await window.crypto.subtle.digest('SHA-256', fileData);
    const recomputedHashHex = bytesToHex(new Uint8Array(recomputedHashBuffer));
    const isIntegrityVerified = (originalHashHex.toLowerCase() === recomputedHashHex.toLowerCase());

    return {
      fileName,
      fileData,
      originalHashHex,
      recomputedHashHex,
      isIntegrityVerified
    };
  } catch (err) {
    // Clear error on AES-GCM authentication failure or corrupted header
    throw new Error('Incorrect password or corrupted file');
  }
}

/**
 * Evaluate password strength in plain JS.
 * Returns { score, label, color, percent }
 */
function calculatePasswordStrength(pwd) {
  if (!pwd || pwd.length === 0) {
    return { score: 0, label: '', color: '#94a3b8', percent: 0 };
  }

  let score = 0;

  // Length scoring
  if (pwd.length >= 8) score += 1;
  if (pwd.length >= 12) score += 1;
  if (pwd.length >= 16) score += 1;

  // Variety scoring
  if (/[a-z]/.test(pwd)) score += 1;
  if (/[A-Z]/.test(pwd)) score += 1;
  if (/[0-9]/.test(pwd)) score += 1;
  if (/[^A-Za-z0-9]/.test(pwd)) score += 1;

  // Categorize
  if (pwd.length < 8 || score <= 3) {
    return { score: 1, label: 'Weak', color: '#ef4444', percent: 25 };
  } else if (score <= 4) {
    return { score: 2, label: 'Medium', color: '#f59e0b', percent: 50 };
  } else if (score <= 5) {
    return { score: 3, label: 'Strong', color: '#10b981', percent: 75 };
  } else {
    return { score: 4, label: 'Very strong', color: '#059669', percent: 100 };
  }
}

/**
 * Generate a random 16-character strong password using window.crypto.getRandomValues.
 */
function generateStrongPassword(length = 16) {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*_-+=';
  const randomBytes = new Uint8Array(length);
  window.crypto.getRandomValues(randomBytes);

  let password = '';
  for (let i = 0; i < length; i++) {
    password += charset[randomBytes[i] % charset.length];
  }
  return password;
}
