const query = new URLSearchParams(window.location.search);
const token = query.get('token') || '';
const messageNode = document.getElementById('reset-message');
const passwordInput = document.querySelector('#reset-form input[name="password"]');
const confirmInput = document.querySelector('#reset-form input[name="confirmPassword"]');
const strengthNode = document.getElementById('password-strength-reset');
const matchNode = document.getElementById('password-match-reset');

function setMessage(msg, isError = false) {
  messageNode.textContent = msg;
  messageNode.style.color = isError ? '#9f1239' : '#4d5b6b';
}

function strongPassword(password) {
  const value = String(password || '');
  return value.length >= 10
    && /[A-Z]/.test(value)
    && /[a-z]/.test(value)
    && /[0-9]/.test(value)
    && /[^A-Za-z0-9]/.test(value);
}

function renderPasswordFeedback() {
  const password = String(passwordInput?.value || '');
  const confirmPassword = String(confirmInput?.value || '');

  if (!password) {
    strengthNode.textContent = '';
  } else if (strongPassword(password)) {
    strengthNode.textContent = 'Password strength: strong';
    strengthNode.style.color = '#86efac';
  } else {
    strengthNode.textContent = 'Password strength: weak';
    strengthNode.style.color = '#ff5f7a';
  }

  if (!confirmPassword) {
    matchNode.textContent = '';
  } else if (password === confirmPassword) {
    matchNode.textContent = 'Passwords match';
    matchNode.style.color = '#86efac';
  } else {
    matchNode.textContent = 'Passwords do not match';
    matchNode.style.color = '#ff5f7a';
  }
}

if (!token) {
  setMessage('Reset link is invalid. Request a new one.', true);
}

passwordInput?.addEventListener('input', renderPasswordFeedback);
confirmInput?.addEventListener('input', renderPasswordFeedback);

document.getElementById('reset-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!token) return;

  const form = new FormData(event.currentTarget);
  const password = String(form.get('password') || '');
  const confirmPassword = String(form.get('confirmPassword') || '');

  if (password !== confirmPassword) {
    setMessage('Password and confirm password must match.', true);
    return;
  }

  if (!strongPassword(password)) {
    setMessage('Use a stronger password: 10+ chars, uppercase, lowercase, number, and special character.', true);
    return;
  }

  try {
    const response = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not reset password.');

    setMessage('Password updated. Redirecting to login...');
    setTimeout(() => {
      window.location.href = '/login.html';
    }, 1200);
  } catch (error) {
    setMessage(error.message, true);
  }
});
