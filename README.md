# SecureShare

**SecureShare** is a browser-based, zero-knowledge secure file transfer portal built as a college cryptography course project. It allows users to encrypt any file using AES-256-GCM directly in their browser before transmission, ensuring that neither the plain file nor the encryption password ever touches the server or network unencrypted.

---

## How It Works

1. **Client-Side Encryption:**
   - The sender selects any file (up to 500 MB) and enters or generates a secure password.
   - The browser computes the original file's **SHA-256 integrity hash**.
   - A cryptographically secure 16-byte random salt and 12-byte initialization vector (IV) are generated via `window.crypto.getRandomValues`.
   - A 256-bit AES key is derived from the password and salt using **PBKDF2** (SHA-256 with 100,000 iterations).
   - The filename and SHA-256 digest are packed into a binary header prefix with the file bytes and encrypted end-to-end using **AES-256-GCM**.
2. **Server Storage:**
   - The client uploads the ciphertext blob, salt (Base64), and IV (Base64) to the server via `FormData`.
   - The server stores the encrypted payload under a randomly generated 16-byte hex ID (`uploads/<id>.bin` and `uploads/<id>.json`).
   - The server returns a shareable link: `/download.html?id=<id>`.
3. **Client-Side Decryption & Integrity Verification:**
   - The recipient opens the link and enters the shared password.
   - The browser downloads `{ salt, iv, data, expiresAt, fileSize }` as JSON.
   - The browser derives the AES key using the identical PBKDF2 parameters and decrypts the ciphertext.
   - Upon successful decryption, the recipient's browser recomputes the SHA-256 hash of the decrypted data and verifies it against the embedded original hash.
   - If the password is wrong or ciphertext has been altered, AES-GCM tag verification fails and reports: `"Incorrect password or corrupted file"`.
4. **Auto-Deletion & Expiration:**
   - Links expire automatically after **1 hour** (cleaned up periodically by the server).
   - The server never deletes files on GET. Once decrypted and downloaded successfully, the client sends a `DELETE /api/file/:id` request to permanently delete the file from the server.

---

## Encrypted Binary Header Format

Inside the AES-256-GCM ciphertext payload, the plaintext is packed using the following byte structure:

```
+--------------------------+-----------------------+-----------------------+--------------------+
| 4 Bytes (Uint32 Big-End) | N Bytes (UTF-8)       | 32 Bytes (Binary)     | M Bytes (Binary)   |
| Filename Length          | Original Filename     | SHA-256 File Hash     | File Content Data  |
+--------------------------+-----------------------+-----------------------+--------------------+
```

Because this header is encrypted inside the AES-GCM envelope:
- The server never sees the filename, the file hash, or the file data.
- The recipient can reliably reconstruct the original filename, extension, and verify the file's cryptographic integrity without trusting the server.

---

## Cryptography Features Added

### 1. Password Strength Meter & Cryptographic Password Generator
- **Live Strength Meter:** Real-time visual feedback (Weak / Medium / Strong / Very strong) based on password length, character variety (uppercase, lowercase, numbers, symbols).
- **Cryptographic Generator:** Generates 16-character high-entropy passwords using `window.crypto.getRandomValues`.

### 2. SHA-256 Integrity Fingerprint
- **Sender Fingerprint:** Senders see the first 16 hex characters of the file's SHA-256 hash (with a toggle to view the full 64-character hash) to verify out-of-band with the recipient.
- **Recipient Verification:** After decryption, the recipient's browser recalculates the hash and confirms byte-for-byte fidelity with a green verified banner.
- **Collapsible Viva Demo Info:** Both success screens feature a collapsible "Encryption Details" accordion displaying AES-256-GCM, PBKDF2 parameters, salt length, and IV length.

---

## Tech Stack

- **Backend:** Node.js + Express, Multer (in-memory file handling)
- **Frontend:** Plain HTML5, CSS3, Vanilla JavaScript (no external libraries, no emojis)
- **Cryptography:** Standard W3C Web Crypto API (`window.crypto.subtle`)

---

## How to Run Locally

### Prerequisites
- Node.js (v18 or higher)
- npm

### Steps

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the server:
   ```bash
   npm start
   ```
   *(or run `npm run dev` for development with auto-reload)*

3. Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

---

## How to Deploy on Render

1. Push this repository to **GitHub**.
2. Log in to [Render](https://render.com/) and click **New > Web Service**.
3. Connect your GitHub repository.
4. Configure the service settings:
   - **Environment:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free plan
5. Click **Create Web Service**.

> **Note on Render's Free Tier:** 
> Render free web services spin down and sleep after periods of inactivity, and use temporary (ephemeral) disk storage. As a result, older uploaded files may disappear when the service restarts. This fits SecureShare's ephemeral design, as files are already intended to be deleted after download or after their 1-hour expiration.
