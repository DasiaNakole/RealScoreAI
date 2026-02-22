const TOKEN_KEY = 'authToken';
const token = localStorage.getItem(TOKEN_KEY);
if (!token) window.location.href = '/login.html';

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
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
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
  renderClosed(data.closed || []);
}

document.getElementById('run-closed-followup').addEventListener('click', async () => {
  try {
    const result = await authedFetch('/api/automation/closed-followup-3m', { method: 'POST' });
    setMessage(`3-month follow-up run complete. Sent ${result.sentCount}, skipped ${result.skippedCount}.`);
  } catch (error) {
    setMessage(error.message, true);
  }
});

loadClosed().catch((error) => setMessage(error.message, true));
