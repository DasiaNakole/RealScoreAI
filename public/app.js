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
let currentAccount = null;

const FOLLOW_THROUGH_SIGNAL_TO_RATE = {
  none: 0.1,
  replied: 0.35,
  docs_shared: 0.55,
  tour_booked: 0.75,
  multiple_tours: 0.88,
  offer_submitted: 0.97
};

const PIPELINE_STEPS = [
  'consultation',
  'exclusive_buyer_agreement',
  'preapproval',
  'home_search',
  'schedule_visits',
  'home_inspection',
  'appraisal',
  'sign_documents',
  'closing',
  'closed'
];

const STAGE_LABELS = {
  consultation: 'Consultation',
  exclusive_buyer_agreement: 'Exclusive Buyer Agreement (EBA)',
  preapproval: 'Preapproval',
  home_search: 'Home Search',
  schedule_visits: 'Schedule Visits',
  home_inspection: 'Home Inspection',
  appraisal: 'Appraisal',
  sign_documents: 'Sign Documents',
  closing: 'Closing',
  closed: 'Closed',
  nurture: 'Nurture',
  new: 'Consultation',
  qualified: 'Exclusive Buyer Agreement (EBA)',
  touring: 'Schedule Visits'
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

function collectPipelineProgressFromForm() {
  const progress = {};
  for (const step of PIPELINE_STEPS) {
    progress[step] = Boolean(document.getElementById(`pipeline-${step}`)?.checked);
  }
  return progress;
}

function applyPipelineProgressToForm(progress = {}) {
  for (const step of PIPELINE_STEPS) {
    const node = document.getElementById(`pipeline-${step}`);
    if (node) node.checked = Boolean(progress[step]);
  }
}

function inferStageFromPipeline(progress = {}) {
  let current = 'consultation';
  for (const step of PIPELINE_STEPS) {
    if (progress[step]) current = step;
  }
  return current;
}

function normalizeLeadStage(stage) {
  const value = String(stage || '').trim().toLowerCase();
  const legacyMap = {
    new: 'consultation',
    qualified: 'exclusive_buyer_agreement',
    touring: 'schedule_visits',
    closed: 'closing'
  };
  if (legacyMap[value]) return legacyMap[value];
  return value || 'consultation';
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
  if (!node) return;
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

function setFeedbackStatus(message, isError = false) {
  const node = document.getElementById('feedback-status');
  if (!node) return;
  node.textContent = message;
  node.style.color = isError ? '#ff5f7a' : '#9aa8be';
}

function setTrackingStatus(message, isError = false) {
  const node = document.getElementById('tracking-status');
  if (!node) return;
  node.textContent = message;
  node.style.color = isError ? '#ff5f7a' : '#9aa8be';
}

function setImportStatus(message, isError = false) {
  const node = document.getElementById('lead-import-status');
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

function daysSinceIso(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.floor((Date.now() - ms) / (24 * 60 * 60 * 1000));
}

function buildLeadFollowupReasons(lead) {
  const reasons = [];
  const days = daysSinceIso(lead.lastContactedAt || lead.lastActivityAt || lead.updatedAt || lead.createdAt);
  if (days !== null) reasons.push(`Last contact was ${days} day(s) ago.`);
  if (lead?.signals?.messageIntent) reasons.push(`Intent is ${lead.signals.messageIntent}.`);
  const strongestReason = lead?.whyScore?.strongest?.reason;
  if (strongestReason) reasons.push(strongestReason);
  return reasons.slice(0, 3);
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
  const subjectNode = document.getElementById('followup-subject');
  const bodyNode = document.getElementById('followup-body');
  if (!subjectNode || !bodyNode) return;

  const data = await authedFetch(`/api/leads/${leadId}/suggested-follow-up`);
  if (!data) return;

  subjectNode.value = data.suggestion.subject;
  bodyNode.value = data.suggestion.body;
  setFollowUpStatus(data.isHighPriority
    ? `High-priority lead (score ${data.score}). Review and send.`
    : `Lead score is ${data.score}. You can still send this suggestion if needed.`);
}

function renderCadenceQueue() {
  const node = document.getElementById('cadence-queue');
  node.innerHTML = '';

  if (!cadenceDueCache.length) {
    node.innerHTML = '<p class="meta">No leads currently due for a follow up.</p>';
    return;
  }

  cadenceDueCache.forEach((item) => {
    const card = document.createElement('article');
    card.className = 'invite-item';
    const stageLabel = item.checklistStageLabel || STAGE_LABELS[normalizeLeadStage(item.checklistStage)] || 'Consultation';
    card.innerHTML = `
      <strong>${item.leadName}</strong>
      <span class="meta">Score ${item.score} | cadence ${item.cadence}</span>
      <span class="meta">Checklist stage: ${stageLabel}</span>
    `;
    node.appendChild(card);
  });
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = String(value);
}

function renderDashboardStats(data = {}) {
  const totalLeads = allLeadsCache.length;
  const priorityToday = cadenceDueCache.length || (data.pickupSummary?.leads || []).length;
  const closingTrack = allLeadsCache.filter((lead) => {
    const stage = normalizeLeadStage(lead.stage);
    return ['schedule_visits', 'home_inspection', 'appraisal', 'sign_documents', 'closing', 'closed'].includes(stage);
  }).length;
  const preapprovalPending = allLeadsCache.filter((lead) => !Boolean(lead.pipelineProgress?.preapproval)).length;

  setText('stat-total-leads', totalLeads);
  setText('stat-priority-today', priorityToday);
  setText('stat-closing-track', closingTrack);
  setText('stat-preapproval-pending', preapprovalPending);
}

function renderPickupSummary(summary) {
  const messageNode = document.getElementById('pickup-summary-message');
  const listNode = document.getElementById('pickup-summary-list');
  if (!messageNode || !listNode) return;

  const detail = summary?.message || 'No urgent follow-ups right now.';
  messageNode.textContent = `Welcome back - here's what happened while you were away. ${detail}`;
  listNode.innerHTML = '';

  const leads = summary?.leads || [];
  if (!leads.length) {
    listNode.innerHTML = '<p class="meta">No leads need immediate attention.</p>';
    return;
  }

  leads.forEach((lead) => {
    const card = document.createElement('article');
    card.className = 'invite-item';
    card.innerHTML = `
      <strong>${lead.name}</strong>
      <span class="meta">Last contact: ${lead.lastActivityLabel || 'No activity recorded'}</span>
      <span class="meta">Suggested action: ${lead.suggestedAction || 'Follow up'}</span>
      <span class="meta">Score ${lead.score}</span>
    `;
    card.addEventListener('click', async () => {
      selectedLeadId = lead.id;
      const explanation = await authedFetch(`/api/leads/${lead.id}/explanation`);
      if (!explanation) return;
      renderScoreDetails(explanation);
    });
    listNode.appendChild(card);
  });
}

function leadItem(lead) {
  const li = document.createElement('li');
  li.className = `lead-item ${lead.score < 50 ? 'low' : ''}`;
  const checklistStage = lead.checklistStageLabel || STAGE_LABELS[normalizeLeadStage(lead.stage)] || 'Consultation';
  const reasons = buildLeadFollowupReasons(lead)
    .map((reason) => `<li>${reason}</li>`)
    .join('');
  li.innerHTML = `
    <strong>${lead.name}</strong>
    <span class="meta">${lead.stage} | trend: ${lead.behaviorTrend}</span>
    <span class="score">Score: ${lead.score} | confidence: ${lead.confidenceScore}%</span>
    <span class="meta">Checklist stage: ${checklistStage}</span>
    <span class="meta">Why this lead needs follow-up:</span>
    <ul class="meta">${reasons}</ul>
    <div class="hero-actions">
      <button class="btn btn-secondary" data-followup-lead="${lead.id}">Send Follow-Up</button>
    </div>
  `;

  li.addEventListener('click', async () => {
    selectedLeadId = lead.id;
    const explanation = await authedFetch(`/api/leads/${lead.id}/explanation`);
    if (!explanation) return;
    renderScoreDetails(explanation);
  });

  li.querySelector('[data-followup-lead]')?.addEventListener('click', (event) => {
    event.stopPropagation();
    window.location.href = `/followups.html?leadId=${encodeURIComponent(lead.id)}`;
  });

  return li;
}

function clearLeadForm() {
  document.getElementById('lead-id').value = '';
  document.getElementById('lead-name').value = '';
  document.getElementById('lead-email').value = '';
  document.getElementById('lead-phone').value = '';
  document.getElementById('lead-source').value = '';
  document.getElementById('lead-notes').value = '';
  document.getElementById('lead-last-contacted').value = '';
  document.getElementById('lead-stage').value = 'consultation';
  applyPipelineProgressToForm({});
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
  document.getElementById('lead-source').value = lead.source || '';
  document.getElementById('lead-notes').value = lead.notes || '';
  document.getElementById('lead-last-contacted').value = lead.lastContactedAt
    ? new Date(lead.lastContactedAt).toISOString().slice(0, 10)
    : '';
  document.getElementById('lead-stage').value = normalizeLeadStage(lead.stage);
  applyPipelineProgressToForm(lead.pipelineProgress || {});
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
    const preapproved = Boolean(lead.pipelineProgress?.preapproval);
    const card = document.createElement('article');
    card.className = 'invite-item';
    card.innerHTML = `
      <strong>${lead.name}</strong>
      <span class="meta">${lead.email} | ${lead.stage}</span>
      <span class="meta">Source: ${lead.source || 'n/a'}</span>
      <span class="meta">Score: ${lead.score} | Bucket: ${lead.bucket}</span>
      <span class="meta">Preapproval: ${preapproved ? 'Complete' : 'Pending'}</span>
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
      const formNode = document.getElementById('lead-form');
      if (formNode) {
        formNode.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      const nameField = document.getElementById('lead-name');
      nameField?.focus();
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
  currentAccount = me;

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
  cadenceDueCache = [];
  renderCadenceQueue();
  setCadenceStatus('Use the Follow-Ups page for manual sends. Silver and Gold users can run auto follow ups there.');

  const data = await authedFetch('/api/dashboard');
  if (!data) return;
  renderPickupSummary(data.pickupSummary);

  const mappings = [
    ['top5-clients', data.top5 || []],
    ['on-deck-clients', data.onDeck || []],
    ['potentials-clients', data.potentials || []]
  ];

  for (const [id, leads] of mappings) {
    const target = document.getElementById(id);
    target.innerHTML = '';
    for (const lead of leads) {
      target.appendChild(leadItem(lead));
    }
  }

  await loadLeadManager();
  renderDashboardStats(data);
  if (!allLeadsCache.length) {
    setLeadManagerStatus('Welcome to RealScoreAI beta -- add your first lead to start tracking follow-ups.');
  }
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
    setCadenceStatus('Live updates connected.');
  });

  stream.addEventListener('lead.updated', () => {
    scheduleDashboardRefresh();
  });

  stream.addEventListener('dashboard.refresh', () => {
    scheduleDashboardRefresh();
  });

  stream.onerror = () => {
    setCadenceStatus('Live updates reconnecting...');
  };
}

document.getElementById('lead-cancel').addEventListener('click', () => {
  clearLeadForm();
  setLeadManagerStatus('Lead form cleared.');
});

document.getElementById('load-demo-leads')?.addEventListener('click', async () => {
  const force = confirm('Load demo leads now? Click OK to replace existing leads, or Cancel to add only if account is empty.');
  try {
    const result = await authedFetch('/api/leads/load-demo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force })
    });
    if (!result) return;

    setLeadManagerStatus(result.message || `Loaded ${result.createdCount || 0} demo leads.`);
    clearLeadForm();
    await loadDashboard();
  } catch (error) {
    setLeadManagerStatus(error.message, true);
  }
});

document.getElementById('lead-csv-import')?.addEventListener('click', async () => {
  const fileInput = document.getElementById('lead-csv-file');
  const updateExisting = document.getElementById('lead-csv-update-existing')?.checked !== false;
  const file = fileInput?.files?.[0];

  if (!file) {
    setImportStatus('Choose a CSV file first.', true);
    return;
  }

  try {
    const csvText = await file.text();
    if (!csvText.trim()) {
      setImportStatus('The selected CSV file is empty.', true);
      return;
    }

    setImportStatus('Importing leads...');
    const result = await authedFetch('/api/leads/import-csv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        csvText,
        updateExisting
      })
    });
    if (!result) return;

    const summary = `${result.createdCount || 0} created, ${result.updatedCount || 0} updated, ${result.skippedCount || 0} skipped.`;
    setImportStatus(summary);
    fileInput.value = '';
    await loadDashboard();
  } catch (error) {
    setImportStatus(error.message, true);
  }
});

document.getElementById('lead-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const id = document.getElementById('lead-id').value.trim();
  const pipelineProgress = collectPipelineProgressFromForm();
  const inferredStage = inferStageFromPipeline(pipelineProgress);
  const stageValue = normalizeLeadStage(document.getElementById('lead-stage').value || inferredStage);
  const payload = {
    name: document.getElementById('lead-name').value.trim(),
    email: document.getElementById('lead-email').value.trim(),
    phone: document.getElementById('lead-phone').value.trim(),
    source: document.getElementById('lead-source').value.trim(),
    notes: document.getElementById('lead-notes').value.trim(),
    lastContactedAt: document.getElementById('lead-last-contacted').value
      ? new Date(`${document.getElementById('lead-last-contacted').value}T00:00:00Z`).toISOString()
      : null,
    stage: stageValue,
    pipelineProgress,
    responseTimeMinutes: Number(document.getElementById('lead-response-time').value || 0),
    messageIntent: document.getElementById('lead-intent').value,
    followThroughSignal: document.getElementById('lead-follow-through-signal').value,
    followThroughRate: rateFromSignal(document.getElementById('lead-follow-through-signal').value),
    weeklyEngagementTouches: Number(document.getElementById('lead-touches').value || 0)
  };

  const stagePastPreapproval = PIPELINE_STEPS.indexOf(stageValue) > PIPELINE_STEPS.indexOf('preapproval');
  if (stagePastPreapproval && !pipelineProgress.preapproval) {
    const proceed = confirm('Preapproval is not checked, but lead stage is beyond preapproval. Continue anyway?');
    if (!proceed) {
      setLeadManagerStatus('Save canceled. Mark preapproval or choose an earlier stage.', true);
      return;
    }
  }

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

document.getElementById('send-followup')?.addEventListener('click', async () => {
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

document.getElementById('create-tracking-link')?.addEventListener('click', async () => {
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

document.getElementById('insert-tracking-link')?.addEventListener('click', () => {
  if (!lastTrackingUrl) {
    setTrackingStatus('Create a tracked listing link first.', true);
    return;
  }
  const bodyNode = document.getElementById('followup-body');
  const spacer = bodyNode.value.trim().length ? '\n\n' : '';
  bodyNode.value = `${bodyNode.value}${spacer}Property link: ${lastTrackingUrl}`.trim();
  setTrackingStatus('Tracked link inserted into follow-up message.');
});

document.getElementById('feedback-button')?.addEventListener('click', () => {
  const modal = document.getElementById('feedback-modal');
  const input = document.getElementById('feedback-message');
  if (!modal || !input) return;
  modal.style.display = '';
  input.focus();
  setFeedbackStatus('');
});

document.getElementById('feedback-cancel')?.addEventListener('click', () => {
  const modal = document.getElementById('feedback-modal');
  if (modal) modal.style.display = 'none';
});

document.getElementById('feedback-submit')?.addEventListener('click', async () => {
  const modal = document.getElementById('feedback-modal');
  const input = document.getElementById('feedback-message');
  const message = String(input?.value || '').trim();
  if (!message) {
    setFeedbackStatus('Enter feedback first.', true);
    return;
  }

  try {
    await authedFetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        page: 'dashboard',
        message
      })
    });
    input.value = '';
    setFeedbackStatus('Feedback submitted. Thank you.');
    setLeadManagerStatus('Thanks - feedback submitted.');
    if (modal) modal.style.display = 'none';
  } catch (error) {
    setFeedbackStatus(error.message, true);
  }
});

for (const step of PIPELINE_STEPS) {
  const node = document.getElementById(`pipeline-${step}`);
  node?.addEventListener('change', () => {
    const progress = collectPipelineProgressFromForm();
    document.getElementById('lead-stage').value = inferStageFromPipeline(progress);
  });
}

clearLeadForm();
renderCadenceQueue();
setTrackingUrl('');
document.getElementById('logout-button')?.addEventListener('click', async () => {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
  } catch {}
  localStorage.removeItem(TOKEN_KEY);
  window.location.href = '/login.html';
});
loadDashboard();
connectRealtimeStream();
