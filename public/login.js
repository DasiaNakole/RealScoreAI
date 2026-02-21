const TOKEN_KEY = 'authToken';
const query = new URLSearchParams(window.location.search);
const prefillEmail = query.get('email') || '';
const messageNode = document.getElementById('auth-message');

function setMessage(msg, isError = false) {
  messageNode.textContent = msg;
  messageNode.style.color = isError ? '#9f1239' : '#4d5b6b';
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
  window.location.href = '/portal.html';
}

if (prefillEmail) {
  const loginEmail = document.querySelector('#login-form input[name="email"]');
  if (loginEmail) loginEmail.value = prefillEmail;
}

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
