// download.js - Handles fetching, live countdown, animated lock, 4-stage decryption, and file download

const mainCard = document.getElementById('mainCard');
const lockIconWrap = document.getElementById('lockIconWrap');
const infoRow = document.getElementById('infoRow');
const expiryTimerText = document.getElementById('expiryTimerText');
const downloadForm = document.getElementById('downloadForm');
const passwordInput = document.getElementById('password');
const togglePasswordBtn = document.getElementById('togglePasswordBtn');
const decryptBtn = document.getElementById('decryptBtn');
const statusMessage = document.getElementById('statusMessage');

// Stepper Elements
const downloadStepper = document.getElementById('downloadStepper');
const dlStep1 = document.getElementById('dlStep1');
const dlStep2 = document.getElementById('dlStep2');
const dlStep3 = document.getElementById('dlStep3');
const dlStep4 = document.getElementById('dlStep4');
const dlLine1 = document.getElementById('dlLine1');
const dlLine2 = document.getElementById('dlLine2');
const dlLine3 = document.getElementById('dlLine3');
const dlStatusText = document.getElementById('dlStatusText');

// Views
const downloadSuccessView = document.getElementById('downloadSuccessView');
const decryptedFileInfo = document.getElementById('decryptedFileInfo');
const emptyStateView = document.getElementById('emptyStateView');

// URL query parameter
const urlParams = new URLSearchParams(window.location.search);
const fileId = urlParams.get('id');

let cachedPayload = null;
let timerInterval = null;

// Format file size helper
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function showStatus(message, type) {
  statusMessage.textContent = message;
  statusMessage.className = 'status-msg ' + type;
  statusMessage.style.display = 'block';
}

function clearStatus() {
  statusMessage.textContent = '';
  statusMessage.style.display = 'none';
}

function triggerShake() {
  mainCard.classList.remove('card-shake');
  void mainCard.offsetWidth; // Force CSS reflow
  mainCard.classList.add('card-shake');
  setTimeout(() => mainCard.classList.remove('card-shake'), 500);
}

// Show/Hide password toggle
togglePasswordBtn.addEventListener('click', () => {
  const isPassword = passwordInput.type === 'password';
  passwordInput.type = isPassword ? 'text' : 'password';
  togglePasswordBtn.textContent = isPassword ? 'Hide Password' : 'Show Password';
});

// Update 4-stage stepper
function updateDlStepper(step) {
  [dlStep1, dlStep2, dlStep3, dlStep4].forEach((s) => s.classList.remove('active', 'completed'));
  [dlLine1, dlLine2, dlLine3].forEach((l) => l.classList.remove('completed'));

  if (step >= 1) dlStep1.classList.add(step === 1 ? 'active' : 'completed');
  if (step >= 2) {
    dlLine1.classList.add('completed');
    dlStep2.classList.add(step === 2 ? 'active' : 'completed');
  }
  if (step >= 3) {
    dlLine2.classList.add('completed');
    dlStep3.classList.add(step === 3 ? 'active' : 'completed');
  }
  if (step >= 4) {
    dlLine3.classList.add('completed');
    dlStep4.classList.add('completed');
  }
}

// Trigger automatic browser download
function triggerDownload(buffer, fileName) {
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = fileName || 'downloaded_file';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Keep object URL alive for 10 seconds so browser completes download safely
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10000);
}

// Live Countdown Timer highlighting the expiry time
function startCountdown(expiresAt) {
  if (timerInterval) clearInterval(timerInterval);

  function update() {
    const remainingMs = expiresAt - Date.now();
    if (remainingMs <= 0) {
      clearInterval(timerInterval);
      showEmptyState('This link has expired.');
      return;
    }

    const totalSeconds = Math.floor(remainingMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    expiryTimerText.textContent = `Expires in ${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  update();
  timerInterval = setInterval(update, 1000);
}

// Show empty state for used or expired links
function showEmptyState(msg) {
  if (timerInterval) clearInterval(timerInterval);
  downloadForm.style.display = 'none';
  infoRow.style.display = 'none';
  emptyStateView.style.display = 'block';
  if (msg) {
    const desc = emptyStateView.querySelector('.empty-state-desc');
    if (desc) desc.textContent = msg;
  }
}

// Initial Metadata Pre-fetch on page load
async function initDownloadPage() {
  if (!fileId) {
    showEmptyState('Invalid link: No file ID specified.');
    return;
  }

  try {
    const res = await fetch(`/api/file/${fileId}`);
    if (!res.ok) {
      showEmptyState('This link has already been used or has expired.');
      return;
    }

    cachedPayload = await res.json();
    if (!cachedPayload.salt || !cachedPayload.iv) {
      showEmptyState('This link has already been used or has expired.');
      return;
    }

    // Highlight the countdown timer
    if (cachedPayload.expiresAt) {
      startCountdown(cachedPayload.expiresAt);
      infoRow.style.display = 'inline-flex';
    }
  } catch (err) {
    showEmptyState('Could not reach server. Please check your internet connection.');
  }
}

initDownloadPage();

// Decryption and Download Submit Handler
downloadForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearStatus();

  const password = passwordInput.value;
  if (!password) {
    showStatus('Please enter the decryption password.', 'error');
    return;
  }

  if (!fileId) {
    showStatus('Missing file ID in URL.', 'error');
    return;
  }

  try {
    decryptBtn.disabled = true;
    downloadStepper.style.display = 'block';

    // Step 1: Fetching (use cached payload or re-fetch)
    updateDlStepper(1);
    dlStatusText.textContent = 'Verifying link and retrieving encrypted file...';
    await new Promise((r) => setTimeout(r, 60));

    let payload = cachedPayload;
    if (!payload) {
      const res = await fetch(`/api/file/${fileId}`);
      if (!res.ok) {
        throw new Error('This link has already been used or has expired');
      }
      payload = await res.json();
      cachedPayload = payload;
    }

    // Step 2: Key Derivation
    updateDlStepper(2);
    dlStatusText.textContent = 'Deriving AES-256 key with PBKDF2...';
    await new Promise((r) => setTimeout(r, 80));

    // Step 3: Decrypting
    updateDlStepper(3);
    dlStatusText.textContent = 'Decrypting ciphertext and verifying integrity...';
    await new Promise((r) => setTimeout(r, 60));

    let encryptedBytes;
    if (payload.downloadUrl || !payload.data) {
      const downloadRes = await fetch(payload.downloadUrl || `/api/file/${fileId}/download`);
      if (!downloadRes.ok) {
        throw new Error('Failed to retrieve encrypted file from server');
      }
      const arrayBuffer = await downloadRes.arrayBuffer();
      encryptedBytes = new Uint8Array(arrayBuffer);
    } else {
      encryptedBytes = base64ToBytes(payload.data);
    }

    // Call decryptFile (throws "Incorrect password or corrupted file" on mismatch)
    const { fileName, fileData } = await decryptFile(encryptedBytes, password, payload.salt, payload.iv);

    // Step 4: Downloading
    updateDlStepper(4);
    dlStatusText.textContent = 'Saving decrypted file...';

    // Animate lock icon to unlocked state!
    lockIconWrap.classList.add('unlocked');

    // Trigger download in browser
    triggerDownload(fileData, fileName);

    // Call DELETE after download trigger; ignore errors silently
    try {
      fetch(`/api/file/${fileId}`, { method: 'DELETE' }).catch(() => {});
    } catch (e) { /* ignore */ }

    // Stop countdown timer
    if (timerInterval) clearInterval(timerInterval);

    await new Promise((r) => setTimeout(r, 350));

    // Display success view
    downloadForm.style.display = 'none';
    infoRow.style.display = 'none';
    downloadStepper.style.display = 'none';
    downloadSuccessView.style.display = 'block';

    decryptedFileInfo.textContent = `File: ${fileName} (${formatSize(fileData.byteLength)})`;

  } catch (err) {
    triggerShake();
    showStatus(err.message || 'Decryption failed', 'error');
    downloadStepper.style.display = 'none';
    updateDlStepper(0);
    decryptBtn.disabled = false;
  }
});
