const TOKEN_KEY = 'authToken';
const token = localStorage.getItem(TOKEN_KEY);
if (!token) window.location.href = '/login.html';

let leadsCache = [];

function setMessage(message, isError = false) {
  const node = document.getElementById('followups-message');
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
  try {
    const result = await authedFetch('/api/automation/followup-cadence', { method: 'POST' });
    setMessage(`Cadence run complete. ${result.dueCount} lead(s) due.`);
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
  } catch (error) {
    setMessage(error.message, true);
  }
});

loadLeads().catch((error) => setMessage(error.message, true));
