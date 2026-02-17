const TOKEN_KEY = 'authToken';
const PLAN_KEY = 'selectedPlan';
const query = new URLSearchParams(window.location.search);
const prefillEmail = query.get('email') || '';

const messageNode = document.getElementById('auth-message');
const selectedPlanNode = document.getElementById('selected-plan');
const selectedPlan = localStorage.getItem(PLAN_KEY) || 'pro';
selectedPlanNode.textContent = selectedPlan.toUpperCase();

if (prefillEmail) {
  const registerEmail = document.querySelector('#register-form input[name="email"]');
  const loginEmail = document.querySelector('#login-form input[name="email"]');
  if (registerEmail) registerEmail.value = prefillEmail;
  if (loginEmail) loginEmail.value = prefillEmail;
}

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

async function routeAfterAuth(token) {
  const meRes = await fetch('/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` }
  });

  const meData = await meRes.json();
  if (!meRes.ok) throw new Error(meData.error || 'Could not load account');

  if (!meData.onboardingComplete) {
    window.location.href = '/onboarding.html';
    return;
  }

  if (!meData.hasDashboardAccess) {
    window.location.href = '/payment.html';
    return;
  }

  window.location.href = '/app.html';
}

document.getElementById('register-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const password = String(form.get('password') || '');

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
    await routeAfterAuth(result.token);
  } catch (error) {
    setMessage(error.message, true);
  }
});

document.getElementById('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);

  try {
    const result = await authRequest('/api/auth/login', {
      email: form.get('email'),
      password: form.get('password')
    });

    localStorage.setItem(TOKEN_KEY, result.token);
    await routeAfterAuth(result.token);
  } catch (error) {
    setMessage(error.message, true);
  }
});
