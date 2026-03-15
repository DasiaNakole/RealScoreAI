const TOKEN_KEY = 'authToken';
const token = localStorage.getItem(TOKEN_KEY);
if (!token) {
  window.location.href = '/login.html';
}

let allLeadsCache = [];
let leadSearchQuery = '';
let leadSearchStage = '';

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

function nextBestAction(lead) {
  if (!lead.pipelineProgress?.preapproval) return 'Ask about preapproval';
  const stage = normalizeLeadStage(lead.stage);
  if (stage === 'consultation') return 'Book the first consultation';
  if (stage === 'exclusive_buyer_agreement') return 'Secure the buyer agreement';
  if (stage === 'home_search') return 'Send listings and refine search';
  if (stage === 'schedule_visits') return 'Confirm the next home visits';
  if (stage === 'home_inspection') return 'Check inspection follow-up items';
  if (stage === 'appraisal') return 'Monitor appraisal timing';
  if (stage === 'sign_documents') return 'Prep signing and closing details';
  if (stage === 'closing') return 'Keep closing on track';
  return 'Send a check-in follow-up';
}

function buildLeadFollowupReasons(lead) {
  const reasons = [];
  const strongestReason = lead?.whyScore?.strongest?.reason;
  if (strongestReason) reasons.push(strongestReason);
  if (lead?.signals?.messageIntent) reasons.push(`Intent is ${lead.signals.messageIntent}.`);
  if (!lead?.pipelineProgress?.preapproval) reasons.push('Preapproval is still pending.');
  return reasons.slice(0, 3);
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

function matchesLeadSearch(lead) {
  const normalizedQuery = leadSearchQuery.trim().toLowerCase();
  const normalizedStage = normalizeLeadStage(lead.stage);
  if (leadSearchStage && normalizedStage !== leadSearchStage) return false;
  if (!normalizedQuery) return true;
  const haystack = [
    lead.name,
    lead.email,
    lead.phone,
    lead.source,
    lead.notes,
    lead.stage,
    STAGE_LABELS[normalizedStage],
    lead.pipelineProgress?.preapproval ? 'preapproved' : 'preapproval pending'
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(normalizedQuery);
}

function renderLeadSearchResults() {
  const node = document.getElementById('lead-search-results');
  const countNode = document.getElementById('search-results-count');
  if (!node) return;
  node.innerHTML = '';

  const results = allLeadsCache.filter(matchesLeadSearch).slice(0, 20);
  if (countNode) countNode.textContent = `${results.length} result${results.length === 1 ? '' : 's'}`;

  if (!results.length) {
    node.innerHTML = '<p class="meta">No leads match the current search.</p>';
    return;
  }

  results.forEach((lead) => {
    const card = document.createElement('article');
    card.className = 'invite-item search-result-card';
    const stageLabel = lead.checklistStageLabel || STAGE_LABELS[normalizeLeadStage(lead.stage)] || 'Consultation';
    const preapprovalLabel = lead.pipelineProgress?.preapproval ? 'Preapproved' : 'Preapproval pending';
    const reasons = buildLeadFollowupReasons(lead).map((reason) => `<li>${reason}</li>`).join('');
    card.innerHTML = `
      <div class="search-result-topline">
        <strong>${lead.name}</strong>
        <span class="search-result-score">Score ${lead.score}</span>
      </div>
      <div class="search-result-grid">
        <span class="meta"><strong>Stage:</strong> ${stageLabel}</span>
        <span class="meta"><strong>Status:</strong> ${preapprovalLabel}</span>
        <span class="meta"><strong>Contact:</strong> ${lead.email || 'No email'}</span>
        <span class="meta"><strong>Source:</strong> ${lead.source || 'Not set'}</span>
      </div>
      <span class="meta">Next: ${nextBestAction(lead)}</span>
      ${reasons ? `<ul class="meta">${reasons}</ul>` : ''}
      <div class="hero-actions">
        <button class="btn btn-secondary" type="button" data-search-view="${lead.id}">View Score</button>
        <a class="btn btn-secondary" href="lead-manager.html?leadId=${encodeURIComponent(lead.id)}">Edit Lead</a>
      </div>
    `;
    node.appendChild(card);
  });

  node.querySelectorAll('[data-search-view]').forEach((button) => {
    button.addEventListener('click', async () => {
      const explanation = await authedFetch(`/api/leads/${button.dataset.searchView}/explanation`);
      if (!explanation) return;
      renderScoreDetails(explanation);
      document.querySelector('.explanation')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
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
  const data = await authedFetch('/api/leads');
  if (!data) return;
  allLeadsCache = data.leads || [];
  renderLeadSearchResults();
}

document.getElementById('lead-search')?.addEventListener('input', (event) => {
  leadSearchQuery = String(event.target?.value || '');
  renderLeadSearchResults();
});

document.getElementById('lead-search-stage')?.addEventListener('change', (event) => {
  leadSearchStage = String(event.target?.value || '');
  renderLeadSearchResults();
});

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

loadPage().catch((error) => {
  const node = document.getElementById('lead-search-results');
  if (node) node.innerHTML = `<p class="meta" style="color:#ff5f7a;">${error.message}</p>`;
});
