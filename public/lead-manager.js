const TOKEN_KEY = 'authToken';
const token = localStorage.getItem(TOKEN_KEY);
if (!token) {
  window.location.href = '/login.html';
}

let allLeadsCache = [];
let leadManagerTab = new URLSearchParams(window.location.search).get('tab') || 'form';
let advancedFieldsVisible = false;
const editLeadId = new URLSearchParams(window.location.search).get('leadId') || '';
const autoDemoLoad = new URLSearchParams(window.location.search).get('demo') === '1';

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

function setLeadManagerStatus(message, isError = false) {
  const node = document.getElementById('lead-manager-status');
  if (!node) return;
  node.textContent = message;
  node.style.color = isError ? '#ff5f7a' : '';
}

function setImportStatus(message, isError = false) {
  const node = document.getElementById('lead-import-status');
  if (!node) return;
  node.textContent = message;
  node.style.color = isError ? '#ff5f7a' : '#9aa8be';
}

function setLeadManagerMode(mode, lead = null) {
  const heading = document.getElementById('lead-manager-heading');
  const subheading = document.getElementById('lead-manager-subheading');
  const saveButton = document.getElementById('lead-save');
  const isEditing = mode === 'edit' && lead;
  if (heading) heading.textContent = isEditing ? 'Update Lead' : 'New Lead';
  if (subheading) {
    subheading.textContent = isEditing
      ? `Editing ${lead.name}. Update details, checklist progress, or follow-up signals.`
      : 'Add a new lead, import your pipeline, or open your full lead library.';
  }
  if (saveButton) saveButton.textContent = isEditing ? 'Update lead' : 'Save lead';
}

function setLeadManagerTab(nextTab) {
  leadManagerTab = nextTab;
  document.querySelectorAll('[data-manager-tab]').forEach((button) => {
    const isActive = button.dataset.managerTab === nextTab;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
  document.querySelectorAll('[data-manager-view]').forEach((section) => {
    section.classList.toggle('active', section.dataset.managerView === nextTab);
  });
}

function updateAdvancedFieldsVisibility() {
  const wrapper = document.getElementById('advanced-fields');
  const toggle = document.getElementById('toggle-advanced-fields');
  if (!wrapper || !toggle) return;
  wrapper.hidden = !advancedFieldsVisible;
  toggle.textContent = advancedFieldsVisible ? 'Hide advanced scoring fields' : 'Show advanced scoring fields';
  toggle.setAttribute('aria-expanded', String(advancedFieldsVisible));
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
  return legacyMap[value] || value || 'consultation';
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
  document.getElementById('lead-follow-through-signal').value = 'none';
  document.getElementById('lead-follow-through').value = '0';
  document.getElementById('lead-touches').value = '0';
  advancedFieldsVisible = false;
  updateAdvancedFieldsVisibility();
  setLeadManagerMode('new');
}

function fillLeadForm(lead) {
  setLeadManagerTab('form');
  advancedFieldsVisible = true;
  updateAdvancedFieldsVisibility();
  setLeadManagerMode('edit', lead);
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

function renderScoreDetails(explanation) {
  const summary = document.getElementById('score-summary');
  const aiMeta = document.getElementById('score-ai-meta');
  const details = document.getElementById('score-details');
  if (!summary || !details) return;
  summary.textContent = explanation.summary || 'No explanation available.';
  if (aiMeta) {
    aiMeta.textContent = explanation.aiEnhanced
      ? `AI intent confidence: ${Math.round((explanation.intentConfidence || 0) * 100)}%`
      : 'Rule-based scoring active.';
  }
  const bullets = [];
  for (const factor of explanation.factors || []) {
    bullets.push(`<li>${factor.label}: ${factor.value > 0 ? '+' : ''}${factor.value}</li>`);
  }
  details.innerHTML = bullets.length ? `<ul class="meta">${bullets.join('')}</ul>` : '<p class="meta">No factor breakdown available.</p>';
}

function renderLeadManagerList(leads) {
  const container = document.getElementById('lead-manager-list');
  if (!container) return;
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
      <span class="meta">${lead.email || 'No email'} | ${lead.stage}</span>
      <span class="meta">Source: ${lead.source || 'n/a'}</span>
      <span class="meta">Score: ${lead.score} | Bucket: ${lead.bucket}</span>
      <div class="hero-actions">
        <button class="btn btn-secondary" data-edit-lead="${lead.id}">Edit</button>
        <button class="btn btn-secondary" data-view-score="${lead.id}">View Score</button>
        <button class="btn btn-secondary" data-delete-lead="${lead.id}">Delete</button>
      </div>
    `;
    container.appendChild(card);
  }
  container.querySelectorAll('[data-edit-lead]').forEach((button) => {
    button.addEventListener('click', () => {
      const lead = allLeadsCache.find((item) => item.id === button.dataset.editLead);
      if (!lead) return;
      fillLeadForm(lead);
      setLeadManagerStatus(`Editing ${lead.name}.`);
      document.getElementById('lead-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      document.getElementById('lead-name')?.focus();
    });
  });
  container.querySelectorAll('[data-view-score]').forEach((button) => {
    button.addEventListener('click', async () => {
      const explanation = await authedFetch(`/api/leads/${button.dataset.viewScore}/explanation`);
      if (!explanation) return;
      renderScoreDetails(explanation);
      document.querySelector('.explanation')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  container.querySelectorAll('[data-delete-lead]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm('Delete this lead?')) return;
      try {
        await authedFetch(`/api/leads/${button.dataset.deleteLead}`, { method: 'DELETE' });
        setLeadManagerStatus('Lead deleted.');
        await loadLeads();
      } catch (error) {
        setLeadManagerStatus(error.message, true);
      }
    });
  });
}

async function loadLeads() {
  const data = await authedFetch('/api/leads');
  if (!data) return;
  allLeadsCache = data.leads || [];
  renderLeadManagerList(allLeadsCache);
  if (editLeadId) {
    const lead = allLeadsCache.find((item) => item.id === editLeadId);
    if (lead) {
      fillLeadForm(lead);
      const explanation = await authedFetch(`/api/leads/${lead.id}/explanation`);
      if (explanation) renderScoreDetails(explanation);
    }
  }
}

function buildSampleCsv() {
  return [
    'name,email,phone,source,notes,stage,last_contacted,response_time_minutes,intent,follow_through_signal,weekly_touches,consultation,exclusive_buyer_agreement,preapproval,home_search,schedule_visits,home_inspection,appraisal,sign_documents,closing,closed',
    'Jane Smith,jane@example.com,555-111-2222,Referral,Looking in Little Rock,consultation,2026-03-10,45,warm,replied,2,true,false,false,false,false,false,false,false,false,false',
    'Marcus Hill,marcus@example.com,555-222-3333,Zillow,Needs lender intro,preapproval,2026-03-08,30,hot,docs_shared,4,true,true,false,false,false,false,false,false,false,false'
  ].join('\\n');
}

async function loadPage() {
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
  await loadLeads();
  setLeadManagerTab(leadManagerTab);
  if (!editLeadId) clearLeadForm();
  if (autoDemoLoad) {
    document.getElementById('load-demo-leads')?.click();
  }
}

document.querySelectorAll('[data-manager-tab]').forEach((button) => {
  button.addEventListener('click', () => setLeadManagerTab(button.dataset.managerTab || 'form'));
});

document.getElementById('toggle-advanced-fields')?.addEventListener('click', () => {
  advancedFieldsVisible = !advancedFieldsVisible;
  updateAdvancedFieldsVisibility();
});

const sampleCsvLink = document.getElementById('download-sample-csv');
if (sampleCsvLink) {
  sampleCsvLink.href = `data:text/csv;charset=utf-8,${encodeURIComponent(buildSampleCsv())}`;
}

document.getElementById('lead-cancel')?.addEventListener('click', () => {
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
    await loadLeads();
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
      body: JSON.stringify({ csvText, updateExisting })
    });
    if (!result) return;
    setImportStatus(`${result.createdCount || 0} created, ${result.updatedCount || 0} updated, ${result.skippedCount || 0} skipped.`);
    fileInput.value = '';
    await loadLeads();
  } catch (error) {
    setImportStatus(error.message, true);
  }
});

document.getElementById('lead-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = document.getElementById('lead-id').value.trim();
  const pipelineProgress = collectPipelineProgressFromForm();
  const stageValue = normalizeLeadStage(document.getElementById('lead-stage').value || inferStageFromPipeline(pipelineProgress));
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
    await loadLeads();
  } catch (error) {
    setLeadManagerStatus(error.message, true);
  }
});

for (const step of PIPELINE_STEPS) {
  document.getElementById(`pipeline-${step}`)?.addEventListener('change', () => {
    document.getElementById('lead-stage').value = inferStageFromPipeline(collectPipelineProgressFromForm());
  });
}

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

updateAdvancedFieldsVisibility();
loadPage().catch((error) => setLeadManagerStatus(error.message, true));
