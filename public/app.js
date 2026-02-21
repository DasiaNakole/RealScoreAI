const TOKEN_KEY = 'authToken';
const token = localStorage.getItem(TOKEN_KEY);

if (!token) {
  window.location.href = '/login.html';
}

let selectedLeadId = null;
let refreshTimer = null;
let stream = null;
let allLeadsCache = [];
let cadenceDueCache = [];
let lastTrackingUrl = '';

const FOLLOW_THROUGH_SIGNAL_TO_RATE = {
  none: 0.1,
  replied: 0.35,
  docs_shared: 0.55,
  tour_booked: 0.75,
  multiple_tours: 0.88,
  offer_submitted: 0.97
};

function rateFromSignal(signal) {
  return FOLLOW_THROUGH_SIGNAL_TO_RATE[signal] ?? FOLLOW_THROUGH_SIGNAL_TO_RATE.none;
}

function signalFromRate(rate) {
  const value = Number(rate || 0);
  if (value >= 0.94) return 'offer_submitted';
  if (value >= 0.84) return 'multiple_tours';
  if (value >= 0.68) return 'tour_booked';
  if (value >= 0.5) return 'docs_shared';
  if (value >= 0.25) return 'replied';
  return 'none';
}

async function authedFetch(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
    }
  });

  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = {};
  }
  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      window.location.href = '/login.html';
      return null;
    }

    if (response.status === 402) {
      window.location.href = '/payment.html';
      return null;
    }

    throw new Error(data.error || 'Request failed');
  }

  return data;
}

function setFollowUpStatus(message, isError = false) {
  const node = document.getElementById('followup-status');
  node.textContent = message;
  node.style.color = isError ? '#ff5f7a' : '';
}

function setToneProfileStatus(message, isError = false) {
  const node = document.getElementById('tone-profile');
  node.textContent = message;
  node.style.color = isError ? '#ff5f7a' : '#9aa8be';
}

function setCadenceStatus(message, isError = false) {
  const node = document.getElementById('cadence-status');
  node.textContent = message;
  node.style.color = isError ? '#ff5f7a' : '#9aa8be';
}

function setLeadManagerStatus(message, isError = false) {
  const node = document.getElementById('lead-manager-status');
  node.textContent = message;
  node.style.color = isError ? '#ff5f7a' : '';
}

function setTrackingStatus(message, isError = false) {
  const node = document.getElementById('tracking-status');
  node.textContent = message;
  node.style.color = isError ? '#ff5f7a' : '#9aa8be';
}

function setTrackingUrl(url) {
  const node = document.getElementById('tracking-url');
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

function renderScoreDetails(data) {
  document.getElementById('score-summary').textContent = data.whyScore.summary;
  document.getElementById('score-ai-meta').textContent = `Trend: ${data.behaviorTrend} | Confidence: ${data.confidenceScore}% | Intent confidence: ${Math.round((data.aiIntentClassification?.confidence || 0) * 100)}%`;

  const details = document.getElementById('score-details');
  details.innerHTML = '';

  for (const detail of data.whyScore.details) {
    const row = document.createElement('div');
    row.className = 'detail-row';
    row.innerHTML = `<span>${detail.signal}</span><span>${detail.weightedContribution} pts</span>`;
    details.appendChild(row);
  }
}

async function loadSuggestedFollowUp(leadId) {
  const data = await authedFetch(`/api/leads/${leadId}/suggested-follow-up`);
  if (!data) return;

  document.getElementById('followup-subject').value = data.suggestion.subject;
  document.getElementById('followup-body').value = data.suggestion.body;
  setFollowUpStatus(data.isHighPriority
    ? `High-priority lead (score ${data.score}). Review and send.`
    : `Lead score is ${data.score}. You can still send this suggestion if needed.`);
}

function renderCadenceQueue() {
  const node = document.getElementById('cadence-queue');
  node.innerHTML = '';

  if (!cadenceDueCache.length) {
    node.innerHTML = '<p class="meta">No due follow-ups in queue.</p>';
    return;
  }

  cadenceDueCache.forEach((item) => {
    const card = document.createElement('article');
    card.className = 'invite-item';
    card.innerHTML = `
      <strong>${item.leadName}</strong>
      <span class="meta">Score ${item.score} | cadence ${item.cadence}</span>
      <div class="hero-actions">
        <button class="btn btn-secondary" data-load-cadence="${item.leadId}" type="button">Load suggestion</button>
      </div>
    `;
    node.appendChild(card);
  });

  document.querySelectorAll('[data-load-cadence]').forEach((button) => {
    button.addEventListener('click', () => {
      const item = cadenceDueCache.find((due) => due.leadId === button.dataset.loadCadence);
      if (!item) return;
      selectedLeadId = item.leadId;
      document.getElementById('followup-subject').value = item.suggestion.subject;
      document.getElementById('followup-body').value = item.suggestion.body;
      setFollowUpStatus(`Loaded cadence suggestion for ${item.leadName}.`);
    });
  });
}

function leadItem(lead) {
  const li = document.createElement('li');
  li.className = `lead-item ${lead.score < 50 ? 'low' : ''}`;
  li.innerHTML = `
    <strong>${lead.name}</strong>
    <span class="meta">${lead.stage} | trend: ${lead.behaviorTrend}</span>
    <span class="score">Score: ${lead.score} | confidence: ${lead.confidenceScore}%</span>
  `;

  li.addEventListener('click', async () => {
    selectedLeadId = lead.id;
    setTrackingStatus(`Lead selected: ${lead.name}.`);
    setTrackingUrl('');
    const explanation = await authedFetch(`/api/leads/${lead.id}/explanation`);
    if (!explanation) return;
    renderScoreDetails(explanation);
    await loadSuggestedFollowUp(lead.id);
  });

  return li;
}

function clearLeadForm() {
  document.getElementById('lead-id').value = '';
  document.getElementById('lead-name').value = '';
  document.getElementById('lead-email').value = '';
  document.getElementById('lead-phone').value = '';
  document.getElementById('lead-stage').value = 'new';
  document.getElementById('lead-response-time').value = '60';
  document.getElementById('lead-intent').value = 'unknown';
  document.getElementById('lead-follow-through').value = '0';
  document.getElementById('lead-touches').value = '0';
}

function fillLeadForm(lead) {
  document.getElementById('lead-id').value = lead.id;
  document.getElementById('lead-name').value = lead.name || '';
  document.getElementById('lead-email').value = lead.email || '';
  document.getElementById('lead-phone').value = lead.phone || '';
  document.getElementById('lead-stage').value = lead.stage || 'new';
  document.getElementById('lead-response-time').value = String(lead.signals?.responseTimeMinutes ?? 60);
  document.getElementById('lead-intent').value = lead.signals?.messageIntent || 'unknown';
  const followSignal = signalFromRate(lead.signals?.followThroughRate ?? 0);
  document.getElementById('lead-follow-through-signal').value = followSignal;
  document.getElementById('lead-follow-through').value = String(rateFromSignal(followSignal));
  document.getElementById('lead-touches').value = String(lead.signals?.weeklyEngagementTouches ?? 0);
}

function renderLeadManagerList(leads) {
  const container = document.getElementById('lead-manager-list');
  container.innerHTML = '';

  if (!leads.length) {
    container.innerHTML = '<p class="meta">No leads yet. Create your first one above.</p>';
    return;
  }

  for (const lead of leads) {
    const card = document.createElement('article');
    card.className = 'invite-item';
    card.innerHTML = `
      <strong>${lead.name}</strong>
      <span class="meta">${lead.email} | ${lead.stage}</span>
      <span class="meta">Score: ${lead.score} | Bucket: ${lead.bucket}</span>
      <div class="hero-actions">
        <button class="btn btn-secondary" data-edit-lead="${lead.id}">Edit</button>
        <button class="btn btn-secondary" data-delete-lead="${lead.id}">Delete</button>
      </div>
    `;
    container.appendChild(card);
  }

  document.querySelectorAll('[data-edit-lead]').forEach((button) => {
    button.addEventListener('click', () => {
      const lead = allLeadsCache.find((item) => item.id === button.dataset.editLead);
      if (!lead) return;
      fillLeadForm(lead);
      setLeadManagerStatus(`Editing ${lead.name}.`);
    });
  });

  document.querySelectorAll('[data-delete-lead]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.deleteLead;
      if (!confirm('Delete this lead?')) return;

      try {
        await authedFetch(`/api/leads/${id}`, { method: 'DELETE' });
        if (selectedLeadId === id) {
          selectedLeadId = null;
          document.getElementById('followup-subject').value = '';
          document.getElementById('followup-body').value = '';
          setFollowUpStatus('Lead deleted. Select another lead.');
          setTrackingUrl('');
        }
        setLeadManagerStatus('Lead deleted.');
        await loadDashboard();
      } catch (error) {
        setLeadManagerStatus(error.message, true);
      }
    });
  });
}

async function loadLeadManager() {
  const data = await authedFetch('/api/leads');
  if (!data) return;
  allLeadsCache = data.leads || [];
  renderLeadManagerList(allLeadsCache);
}

async function loadDashboard() {
  const me = await authedFetch('/api/auth/me');
  if (!me) return;

  if (!me.onboardingComplete) {
    window.location.href = '/onboarding.html';
    return;
  }

  if (!me.hasDashboardAccess) {
    window.location.href = '/payment.html';
    return;
  }

  const firstName = String(me.user?.name || '').trim().split(/\s+/)[0] || 'Agent';
  document.getElementById('welcome-name').textContent = `Welcome, ${firstName}.`;

  const data = await authedFetch('/api/dashboard');
  if (!data) return;

  const mappings = [
    ['today-focus', data.todayFocus],
    ['at-risk', data.atRisk],
    ['low-value', data.lowValue]
  ];

  for (const [id, leads] of mappings) {
    const target = document.getElementById(id);
    target.innerHTML = '';
    for (const lead of leads) {
      target.appendChild(leadItem(lead));
    }
  }

  await loadLeadManager();
}

function scheduleDashboardRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    loadDashboard().catch(() => {});
  }, 180);
}

function connectRealtimeStream() {
  if (stream) return;
  const url = `/api/stream?token=${encodeURIComponent(token)}`;
  stream = new EventSource(url);

  stream.addEventListener('connected', () => {
    setFollowUpStatus('Live updates connected.');
  });

  stream.addEventListener('lead.updated', () => {
    scheduleDashboardRefresh();
  });

  stream.addEventListener('dashboard.refresh', () => {
    scheduleDashboardRefresh();
  });

  stream.onerror = () => {
    setFollowUpStatus('Live updates reconnecting...');
  };
}

document.getElementById('lead-cancel').addEventListener('click', () => {
  clearLeadForm();
  setLeadManagerStatus('Lead form cleared.');
});

document.getElementById('lead-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const id = document.getElementById('lead-id').value.trim();
  const payload = {
    name: document.getElementById('lead-name').value.trim(),
    email: document.getElementById('lead-email').value.trim(),
    phone: document.getElementById('lead-phone').value.trim(),
    stage: document.getElementById('lead-stage').value,
    responseTimeMinutes: Number(document.getElementById('lead-response-time').value || 0),
    messageIntent: document.getElementById('lead-intent').value,
    followThroughSignal: document.getElementById('lead-follow-through-signal').value,
    followThroughRate: rateFromSignal(document.getElementById('lead-follow-through-signal').value),
    weeklyEngagementTouches: Number(document.getElementById('lead-touches').value || 0)
  };

  try {
    if (id) {
      await authedFetch(`/api/leads/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      setLeadManagerStatus('Lead updated.');
    } else {
      await authedFetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      setLeadManagerStatus('Lead created.');
    }

    clearLeadForm();
    await loadDashboard();
  } catch (error) {
    setLeadManagerStatus(error.message, true);
  }
});

document.getElementById('send-followup').addEventListener('click', async () => {
  if (!selectedLeadId) {
    setFollowUpStatus('Select a lead first.', true);
    return;
  }

  const subject = document.getElementById('followup-subject').value;
  const body = document.getElementById('followup-body').value;

  try {
    const result = await authedFetch(`/api/leads/${selectedLeadId}/send-follow-up`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, body })
    });

    if (!result) return;
    setFollowUpStatus(`Follow-up sent (${result.delivery.mode}).`);
    const before = cadenceDueCache.length;
    cadenceDueCache = cadenceDueCache.filter((item) => item.leadId !== selectedLeadId);
    if (cadenceDueCache.length !== before) {
      renderCadenceQueue();
      setCadenceStatus(`${cadenceDueCache.length} lead(s) still due in queue.`);
    }
  } catch (error) {
    setFollowUpStatus(error.message, true);
  }
});

document.getElementById('run-followup-cadence').addEventListener('click', async () => {
  try {
    const result = await authedFetch('/api/automation/followup-cadence', { method: 'POST' });
    if (!result) return;

    if (!result.dueCount) {
      setFollowUpStatus('No cadence follow-ups due right now.');
      cadenceDueCache = [];
      renderCadenceQueue();
      setCadenceStatus('No due follow-ups right now.');
      return;
    }

    cadenceDueCache = result.due || [];
    renderCadenceQueue();
    setCadenceStatus(`${result.dueCount} lead(s) due for follow-up.`);

    const first = cadenceDueCache[0];
    selectedLeadId = first.leadId;
    document.getElementById('followup-subject').value = first.suggestion.subject;
    document.getElementById('followup-body').value = first.suggestion.body;
    setFollowUpStatus(`Cadence found ${result.dueCount} due lead(s). Loaded ${first.leadName} first.`);
    await loadDashboard();
  } catch (error) {
    setFollowUpStatus(error.message, true);
  }
});

document.getElementById('load-tone-profile').addEventListener('click', async () => {
  try {
    const data = await authedFetch('/api/ai/tone-profile');
    if (!data) return;
    const style = data.profile?.style || 'unknown';
    const confidence = Math.round((data.profile?.confidence || 0) * 100);
    const hint = data.profile?.rewriteHint || '';
    setToneProfileStatus(`Tone: ${style} (${confidence}% confidence). ${hint}`);
  } catch (error) {
    setToneProfileStatus(error.message, true);
  }
});

document.getElementById('create-tracking-link').addEventListener('click', async () => {
  if (!selectedLeadId) {
    setTrackingStatus('Select a lead first.', true);
    return;
  }

  const destinationUrl = document.getElementById('tracking-destination-url').value.trim();
  if (!destinationUrl) {
    setTrackingStatus('Enter a destination listing URL first.', true);
    return;
  }

  try {
    const data = await authedFetch(`/api/leads/${selectedLeadId}/tracking-links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        destinationUrl,
        channel: 'email'
      })
    });
    if (!data) return;

    setTrackingUrl(data.link?.trackingUrl || '');
    setTrackingStatus('Tracked listing link created.');
  } catch (error) {
    setTrackingStatus(error.message, true);
  }
});

document.getElementById('insert-tracking-link').addEventListener('click', () => {
  if (!lastTrackingUrl) {
    setTrackingStatus('Create a tracked listing link first.', true);
    return;
  }
  const bodyNode = document.getElementById('followup-body');
  const spacer = bodyNode.value.trim().length ? '\n\n' : '';
  bodyNode.value = `${bodyNode.value}${spacer}Property link: ${lastTrackingUrl}`.trim();
  setTrackingStatus('Tracked link inserted into follow-up message.');
});

clearLeadForm();
renderCadenceQueue();
setTrackingUrl('');
loadDashboard();
connectRealtimeStream();
