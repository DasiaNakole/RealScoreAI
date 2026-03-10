const TOKEN_KEY = 'authToken';
const PLAN_KEY = 'selectedPlan';
const query = new URLSearchParams(window.location.search);
const prefillEmail = query.get('email') || '';
const messageNode = document.getElementById('auth-message');
const selectedPlanNode = document.getElementById('selected-plan');
const passwordInput = document.querySelector('#register-form input[name="password"]');
const confirmInput = document.querySelector('#register-form input[name="confirmPassword"]');
const strengthNode = document.getElementById('password-strength-signup');
const matchNode = document.getElementById('password-match-signup');
const PLAN_ALIASES = { core: 'bronze', pro: 'silver', team: 'gold', platinum: 'gold' };
const selectedPlanRaw = localStorage.getItem(PLAN_KEY) || 'silver';
const selectedPlan = PLAN_ALIASES[selectedPlanRaw] || selectedPlanRaw;
localStorage.setItem(PLAN_KEY, selectedPlan);
selectedPlanNode.textContent = selectedPlan.charAt(0).toUpperCase() + selectedPlan.slice(1);

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

async function authRequest(path, payload) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

if (prefillEmail) {
  const registerEmail = document.querySelector('#register-form input[name="email"]');
  if (registerEmail) registerEmail.value = prefillEmail;
}

passwordInput?.addEventListener('input', renderPasswordFeedback);
confirmInput?.addEventListener('input', renderPasswordFeedback);

document.getElementById('register-form').addEventListener('submit', async (event) => {
  event.preventDefault();
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
    const result = await authRequest('/api/auth/register', {
      name: form.get('name'),
      email: form.get('email'),
      password
    });

    localStorage.setItem(TOKEN_KEY, result.token);
    window.location.href = '/onboarding.html';
  } catch (error) {
    setMessage(error.message, true);
  }
});
