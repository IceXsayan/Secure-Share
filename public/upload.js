// upload.js - Handles landing page modal, drag-and-drop, password generator, strength meter, client-side encryption, and upload tracking

// DOM Elements
const openModalBtn = document.getElementById('openModalBtn');
const closeModalBtn = document.getElementById('closeModalBtn');
const uploadModal = document.getElementById('uploadModal');
const uploadForm = document.getElementById('uploadForm');
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const fileInfo = document.getElementById('fileInfo');
const passwordInput = document.getElementById('password');
const confirmPasswordInput = document.getElementById('confirmPassword');
const togglePasswordBtn = document.getElementById('togglePasswordBtn');
const generatePasswordBtn = document.getElementById('generatePasswordBtn');
const pwdHint = document.getElementById('pwdHint');
const strengthBar = document.getElementById('strengthBar');
const strengthLabel = document.getElementById('strengthLabel');
const uploadBtn = document.getElementById('uploadBtn');
const statusMessage = document.getElementById('statusMessage');

// Progress Stepper Elements
const progressStepper = document.getElementById('progressStepper');
const uploadProgressBar = document.getElementById('uploadProgressBar');
const progressStatusText = document.getElementById('progressStatusText');
const step1 = document.getElementById('step1');
const step2 = document.getElementById('step2');
const step3 = document.getElementById('step3');
const step4 = document.getElementById('step4');
const line1 = document.getElementById('line1');
const line2 = document.getElementById('line2');
const line3 = document.getElementById('line3');

// Success View Elements
const successView = document.getElementById('successView');
const shareLinkInput = document.getElementById('shareLink');
const copyBtn = document.getElementById('copyBtn');
const shareAnotherBtn = document.getElementById('shareAnotherBtn');

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB limit
let selectedFile = null;

// Format file size for human-readable display
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// Show inline status error message
function showError(message) {
  statusMessage.textContent = message;
  statusMessage.className = 'status-msg error';
  statusMessage.style.display = 'block';
}

function clearError() {
  statusMessage.textContent = '';
  statusMessage.style.display = 'none';
}

// Modal open/close controls
function openModal() {
  uploadModal.classList.add('active');
  uploadModal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  resetModal();
}

function closeModal() {
  uploadModal.classList.remove('active');
  uploadModal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

openModalBtn.addEventListener('click', openModal);
closeModalBtn.addEventListener('click', closeModal);

uploadModal.addEventListener('click', (e) => {
  if (e.target === uploadModal) {
    closeModal();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && uploadModal.classList.contains('active')) {
    closeModal();
  }
});

// Drag and drop event handling
dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});

['dragenter', 'dragover'].forEach((eventName) => {
  dropZone.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('dragover');
  });
});

['dragleave', 'drop'].forEach((eventName) => {
  dropZone.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('dragover');
  });
});

dropZone.addEventListener('drop', (e) => {
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    handleFileSelected(e.dataTransfer.files[0]);
  }
});

fileInput.addEventListener('change', () => {
  if (fileInput.files && fileInput.files.length > 0) {
    handleFileSelected(fileInput.files[0]);
  }
});

function handleFileSelected(file) {
  clearError();
  selectedFile = file;

  if (file.size > MAX_FILE_SIZE) {
    fileInfo.textContent = `${file.name} (${formatSize(file.size)}) - Exceeds 100 MB maximum limit.`;
    fileInfo.className = 'file-info error';
  } else {
    fileInfo.textContent = `${file.name} (${formatSize(file.size)})`;
    fileInfo.className = 'file-info';
  }
}

// Password strength meter evaluation
function updatePasswordStrength() {
  const pwd = passwordInput.value;
  const { label, color, percent } = calculatePasswordStrength(pwd);

  strengthBar.style.width = `${percent}%`;
  strengthBar.style.backgroundColor = color;
  strengthLabel.textContent = label ? `Strength: ${label}` : 'Enter a password';
  strengthLabel.style.color = color;
}

passwordInput.addEventListener('input', updatePasswordStrength);

// Password show/hide toggle
togglePasswordBtn.addEventListener('click', () => {
  const isPassword = passwordInput.type === 'password';
  const newType = isPassword ? 'text' : 'password';
  passwordInput.type = newType;
  confirmPasswordInput.type = newType;
  togglePasswordBtn.textContent = isPassword ? 'Hide Passwords' : 'Show Passwords';
});

// Generate strong password
generatePasswordBtn.addEventListener('click', () => {
  const strongPwd = generateStrongPassword(16);
  passwordInput.value = strongPwd;
  confirmPasswordInput.value = strongPwd;

  // Reveal password so user can read/copy it
  passwordInput.type = 'text';
  confirmPasswordInput.type = 'text';
  togglePasswordBtn.textContent = 'Hide Passwords';

  updatePasswordStrength();
  pwdHint.style.display = 'block';
  clearError();
});

// Stepper visual updates
function updateStepper(step) {
  [step1, step2, step3, step4].forEach((s) => s.classList.remove('active', 'completed'));
  [line1, line2, line3].forEach((l) => l.classList.remove('completed'));

  if (step >= 1) step1.classList.add(step === 1 ? 'active' : 'completed');
  if (step >= 2) {
    line1.classList.add('completed');
    step2.classList.add(step === 2 ? 'active' : 'completed');
  }
  if (step >= 3) {
    line2.classList.add('completed');
    step3.classList.add(step === 3 ? 'active' : 'completed');
  }
  if (step >= 4) {
    line3.classList.add('completed');
    step4.classList.add('completed');
  }
}

// Form submission & encryption pipeline
uploadForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();

  const password = passwordInput.value;
  const confirmPassword = confirmPasswordInput.value;

  if (!selectedFile) {
    showError('Please select or drop a file to upload.');
    return;
  }

  if (selectedFile.size > MAX_FILE_SIZE) {
    showError('File size exceeds the 100 MB limit. Please select a smaller file.');
    return;
  }

  if (!password) {
    showError('Please enter an encryption password.');
    return;
  }

  if (password !== confirmPassword) {
    showError('Passwords do not match. Please verify both fields.');
    return;
  }

  try {
    uploadBtn.disabled = true;
    progressStepper.style.display = 'block';

    // Stage 1: Key Derivation
    updateStepper(1);
    uploadProgressBar.style.width = '15%';
    progressStatusText.textContent = 'Deriving encryption key with PBKDF2...';

    await new Promise((resolve) => setTimeout(resolve, 80));

    // Stage 2: Encrypting (packs filename, SHA-256 hash, and file bytes)
    updateStepper(2);
    uploadProgressBar.style.width = '35%';
    progressStatusText.textContent = 'Encrypting file with AES-256-GCM in browser...';

    await new Promise((resolve) => setTimeout(resolve, 50));
    const { encryptedBlob, saltBase64, ivBase64 } = await encryptFile(selectedFile, password);

    // Stage 3: Uploading
    updateStepper(3);
    progressStatusText.textContent = 'Uploading encrypted payload to server...';

    const formData = new FormData();
    formData.append('file', encryptedBlob, 'encrypted.bin');
    formData.append('salt', saltBase64);
    formData.append('iv', ivBase64);

    // Use XMLHttpRequest for accurate upload progress tracking
    const uploadResult = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload');

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const uploadPercent = Math.round((event.loaded / event.total) * 60);
          uploadProgressBar.style.width = `${35 + uploadPercent}%`;
          progressStatusText.textContent = `Uploading: ${Math.round((event.loaded / event.total) * 100)}%`;
        }
      };

      xhr.onload = () => {
        try {
          const res = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(res);
          } else {
            reject(new Error(res.error || `Upload failed with HTTP ${xhr.status}`));
          }
        } catch (err) {
          reject(new Error('Invalid response received from server.'));
        }
      };

      xhr.onerror = () => reject(new Error('Network connection error while uploading.'));
      xhr.send(formData);
    });

    // Stage 4: Done
    updateStepper(4);
    uploadProgressBar.style.width = '100%';
    progressStatusText.textContent = 'Upload complete!';

    await new Promise((resolve) => setTimeout(resolve, 300));

    // Show success view
    uploadForm.style.display = 'none';
    successView.style.display = 'block';

    const shareUrl = `${window.location.origin}/download.html?id=${uploadResult.id}`;
    shareLinkInput.value = shareUrl;

  } catch (err) {
    showError(err.message || 'An unexpected error occurred during encryption or upload.');
    progressStepper.style.display = 'none';
    uploadProgressBar.style.width = '0%';
  } finally {
    uploadBtn.disabled = false;
  }
});

// Copy button
copyBtn.addEventListener('click', async () => {
  if (!shareLinkInput.value) return;

  try {
    await navigator.clipboard.writeText(shareLinkInput.value);
    copyBtn.textContent = 'Copied!';
    setTimeout(() => {
      copyBtn.textContent = 'Copy';
    }, 2000);
  } catch (e) {
    shareLinkInput.select();
    document.execCommand('copy');
    copyBtn.textContent = 'Copied!';
    setTimeout(() => {
      copyBtn.textContent = 'Copy';
    }, 2000);
  }
});

// Reset modal to initial state
function resetModal() {
  selectedFile = null;
  fileInput.value = '';
  fileInfo.textContent = '';
  fileInfo.className = 'file-info';
  passwordInput.value = '';
  confirmPasswordInput.value = '';
  passwordInput.type = 'password';
  confirmPasswordInput.type = 'password';
  togglePasswordBtn.textContent = 'Show Passwords';
  pwdHint.style.display = 'none';
  clearError();

  updatePasswordStrength();
  progressStepper.style.display = 'none';
  uploadProgressBar.style.width = '0%';
  updateStepper(0);

  uploadForm.style.display = 'block';
  successView.style.display = 'none';
  uploadBtn.disabled = false;
}

shareAnotherBtn.addEventListener('click', resetModal);
