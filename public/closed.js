const TOKEN_KEY = 'authToken';
const token = localStorage.getItem(TOKEN_KEY);
if (!token) window.location.href = '/login.html';
let account = null;

function hasAutomationAccess(planId) {
  const normalized = String(planId || '').trim().toLowerCase();
  return normalized === 'silver' || normalized === 'gold' || normalized === 'pro' || normalized === 'platinum';
}

function setMessage(message, isError = false) {
  const node = document.getElementById('closed-message');
  node.textContent = message;
  node.style.color = isError ? '#ff5f7a' : '#9aa8be';
}

async function authedFetch(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
    }
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      window.location.href = '/login.html';
      return null;
    }
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

async function loadAccount() {
  account = await authedFetch('/api/auth/me');
  if (!account) return;
  const runButton = document.getElementById('run-closed-followup');
  if (runButton && !hasAutomationAccess(account.subscription?.planId)) {
    runButton.style.display = 'none';
    setMessage('Bronze plan does not run automatic closed-client follow-ups. Silver/Gold only.');
  }
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleDateString();
}

function renderClosed(leads) {
  const node = document.getElementById('closed-list');
  node.innerHTML = '';
  if (!leads.length) {
    node.innerHTML = '<p class="meta">No closed clients yet.</p>';
    return;
  }

  for (const lead of leads) {
    const card = document.createElement('article');
    card.className = 'invite-item';
    card.innerHTML = `
      <strong>${lead.name}</strong>
      <span class="meta">${lead.email}</span>
      <span class="meta">Closed: ${formatDate(lead.closedAt)}</span>
    `;
    node.appendChild(card);
  }
}

async function loadClosed() {
  const data = await authedFetch('/api/leads/closed');
  if (!data) return;
  renderClosed(data.closed || []);
}

document.getElementById('run-closed-followup').addEventListener('click', async () => {
  if (!hasAutomationAccess(account?.subscription?.planId)) {
    setMessage('Closed-client automation is available on Silver and Gold plans.', true);
    return;
  }
  try {
    const result = await authedFetch('/api/automation/closed-followup-3m', { method: 'POST' });
    if (!result) return;
    setMessage(`3-month follow-up run complete. Sent ${result.sentCount}, skipped ${result.skippedCount}.`);
  } catch (error) {
    setMessage(error.message, true);
  }
});

document.getElementById('logout-button').addEventListener('click', async () => {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
  } catch {}
  localStorage.removeItem(TOKEN_KEY);
  window.location.href = '/login.html';
});

Promise.all([loadAccount(), loadClosed()]).catch((error) => setMessage(error.message, true));
