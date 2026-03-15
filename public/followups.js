const TOKEN_KEY = 'authToken';
const token = localStorage.getItem(TOKEN_KEY);
if (!token) window.location.href = '/login.html';

let leadsCache = [];
let account = null;
let lastTrackingUrl = '';

function hasAutomationAccess(planId) {
  const normalized = String(planId || '').trim().toLowerCase();
  return normalized === 'silver' || normalized === 'gold' || normalized === 'pro' || normalized === 'platinum';
}

function setMessage(message, isError = false) {
  const node = document.getElementById('followups-message');
  node.textContent = message;
  node.style.color = isError ? '#ff5f7a' : '#9aa8be';
}

function setTrackingStatus(message, isError = false) {
  const node = document.getElementById('tracking-status');
  if (!node) return;
  node.textContent = message;
  node.style.color = isError ? '#ff5f7a' : '#9aa8be';
}

function setTrackingUrl(url) {
  const node = document.getElementById('tracking-url');
  if (!node) return;
  lastTrackingUrl = String(url || '').trim();
  if (!lastTrackingUrl) {
    node.style.display = 'none';
    node.href = '#';
    node.textContent = '';
    return;
  }
  node.style.display = '';
  node.href = lastTrackingUrl;
  node.textContent = lastTrackingUrl;
}

function renderSentLog() {
  const node = document.getElementById('sent-log');
  node.innerHTML = '';

  if (!window.sentLogCache?.length) {
    node.innerHTML = '<p class="meta">No follow-up activity yet.</p>';
    return;
  }

  window.sentLogCache.forEach((entry) => {
    const card = document.createElement('article');
    card.className = 'invite-item';
    card.innerHTML = `
      <strong>${entry.leadName || 'Lead follow-up'}</strong>
      <span class="meta">Type: ${entry.type}</span>
      <span class="meta">Mode: ${entry.mode || 'n/a'}</span>
      <span class="meta">${entry.timestampLabel || new Date(entry.createdAt).toLocaleString()}</span>
    `;
    node.appendChild(card);
  });
}

async function loadSentLog() {
  const data = await authedFetch('/api/followups/sent-log');
  if (!data) return;
  window.sentLogCache = (data.sentLog || []).map((entry) => ({
    ...entry,
    timestampLabel: new Date(entry.createdAt).toLocaleString()
  }));
  renderSentLog();
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
  const isPro = hasAutomationAccess(account.subscription?.planId);
  const runButton = document.getElementById('run-cadence');
  if (runButton) runButton.style.display = isPro ? '' : 'none';
  if (!isPro) {
    setMessage('Bronze plan uses manual follow-ups only. Review suggestions and send manually.');
  }
}

function selectedLeadId() {
  return document.getElementById('lead-select').value;
}

async function loadSuggestion() {
  const leadId = selectedLeadId();
  if (!leadId) return;
  const data = await authedFetch(`/api/leads/${leadId}/suggested-follow-up`);
  document.getElementById('followup-subject').value = data.suggestion.subject;
  document.getElementById('followup-body').value = data.suggestion.body;
  setMessage(`Loaded suggestion for score ${data.score}.`);
}

async function loadLeads() {
  const data = await authedFetch('/api/leads');
  leadsCache = (data.leads || []).filter((lead) => lead.stage !== 'closed' && !lead.pipelineProgress?.closed);
  const select = document.getElementById('lead-select');
  select.innerHTML = '';
  for (const lead of leadsCache) {
    const option = document.createElement('option');
    option.value = lead.id;
    option.textContent = `${lead.name} (${lead.score})`;
    select.appendChild(option);
  }
  if (leadsCache.length) await loadSuggestion();
}

document.getElementById('lead-select').addEventListener('change', () => {
  loadSuggestion().catch((error) => setMessage(error.message, true));
});

document.getElementById('run-cadence').addEventListener('click', async () => {
  if (!hasAutomationAccess(account?.subscription?.planId)) {
    setMessage('Run follow ups is available on Silver and Gold plans.', true);
    return;
  }
  try {
    const result = await authedFetch('/api/automation/followup-cadence', { method: 'POST' });
    if (!result) return;
    setMessage(`Run follow ups complete. ${result.autoSentCount || 0} email(s) auto-sent, ${result.dueCount} lead(s) queued.`);
    await loadSentLog();
    await loadLeads();
  } catch (error) {
    setMessage(error.message, true);
  }
});

document.getElementById('send-followup').addEventListener('click', async () => {
  const leadId = selectedLeadId();
  if (!leadId) return;
  try {
    const result = await authedFetch(`/api/leads/${leadId}/send-follow-up`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: document.getElementById('followup-subject').value,
        body: document.getElementById('followup-body').value
      })
    });
    setMessage(`Follow-up sent (${result.delivery.mode}).`);
    await loadSentLog();
  } catch (error) {
    setMessage(error.message, true);
  }
});

document.getElementById('create-tracking-link')?.addEventListener('click', async () => {
  const leadId = selectedLeadId();
  if (!leadId) {
    setTrackingStatus('Select a lead first.', true);
    return;
  }

  const destinationUrl = document.getElementById('tracking-destination-url').value.trim();
  if (!destinationUrl) {
    setTrackingStatus('Enter a listing URL first.', true);
    return;
  }

  try {
    const data = await authedFetch(`/api/leads/${leadId}/tracking-links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destinationUrl, channel: 'email' })
    });
    if (!data) return;
    setTrackingUrl(data.link?.trackingUrl || '');
    setTrackingStatus('Tracked link created.');
  } catch (error) {
    setTrackingStatus(error.message, true);
  }
});

document.getElementById('insert-tracking-link')?.addEventListener('click', () => {
  if (!lastTrackingUrl) {
    setTrackingStatus('Create a tracked link first.', true);
    return;
  }

  const bodyNode = document.getElementById('followup-body');
  const spacer = bodyNode.value.trim().length ? '\n\n' : '';
  bodyNode.value = `${bodyNode.value}${spacer}Property link: ${lastTrackingUrl}`.trim();
  setTrackingStatus('Tracked link inserted into follow-up message.');
});

document.getElementById('log-email-open')?.addEventListener('click', async () => {
  const leadId = selectedLeadId();
  if (!leadId) {
    setTrackingStatus('Select a lead first.', true);
    return;
  }

  try {
    await authedFetch(`/api/leads/${leadId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'EMAIL_OPENED', value: 1, meta: { channel: 'manual_test' } })
    });
    setTrackingStatus('Email-open activity logged.');
    await loadLeads();
  } catch (error) {
    setTrackingStatus(error.message, true);
  }
});

document.getElementById('log-listing-engagement')?.addEventListener('click', async () => {
  const leadId = selectedLeadId();
  if (!leadId) {
    setTrackingStatus('Select a lead first.', true);
    return;
  }

  try {
    await authedFetch(`/api/leads/${leadId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'LISTING_ENGAGEMENT', value: 1, meta: { channel: 'manual_test' } })
    });
    setTrackingStatus('Listing-engagement activity logged.');
    await loadLeads();
  } catch (error) {
    setTrackingStatus(error.message, true);
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

window.sentLogCache = [];
renderSentLog();
setTrackingUrl('');
Promise.all([loadAccount(), loadLeads(), loadSentLog()]).catch((error) => setMessage(error.message, true));
