const TOKEN_KEY = 'authToken';
const token = localStorage.getItem(TOKEN_KEY);
const messageNode = document.getElementById('admin-message');
const inviteListNode = document.getElementById('invite-list');
const userListNode = document.getElementById('user-list');
const templateKeyNode = document.getElementById('template-key');
const templatePlanScopeNode = document.getElementById('template-plan-scope');
const templateSubjectNode = document.getElementById('template-subject');
const templateBodyNode = document.getElementById('template-body');

let templateMap = new Map();

function setMessage(message, isError = false) {
  messageNode.textContent = message;
  messageNode.style.color = isError ? '#ff5f7a' : '#9aa8be';
}

async function adminFetch(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
    }
  });

  if (response.headers.get('content-type')?.includes('text/csv')) {
    if (!response.ok) throw new Error('Failed CSV export');
    return response.text();
  }

  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    const isHtml = raw?.trim().toLowerCase().startsWith('<!doctype') || raw?.trim().startsWith('<html');
    if (isHtml) {
      data = { error: `Server error (${response.status}). Backend unavailable or crashed. Check Render logs.` };
    } else {
      data = { error: raw?.slice(0, 160) || 'Non-JSON response received.' };
    }
  }

  if (response.status === 401 || response.status === 403) {
    localStorage.removeItem(TOKEN_KEY);
    window.location.href = '/login.html';
    return null;
  }

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status}).`);
  }

  return data;
}

function renderInvites(invites) {
  inviteListNode.innerHTML = '';

  if (!invites.length) {
    inviteListNode.innerHTML = '<p class="meta">No invites yet.</p>';
    return;
  }

  invites.forEach((invite) => {
    const card = document.createElement('article');
    card.className = 'invite-item';

    const name = invite.name || 'No name';
    const sentAt = invite.sentAt ? `Sent: ${new Date(invite.sentAt).toLocaleString()}` : 'Not sent';

    card.innerHTML = `
      <strong>${name}</strong>
      <span class="meta">${invite.email}</span>
      <span class="meta">Status: ${invite.status}</span>
      <span class="meta">${sentAt}</span>
      <a class="meta" href="${invite.inviteUrl}" target="_blank" rel="noreferrer">Open invite link</a>
      <button class="btn btn-secondary" data-send-id="${invite.id}">Send invite email</button>
    `;

    inviteListNode.appendChild(card);
  });

  document.querySelectorAll('[data-send-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        const result = await adminFetch(`/api/admin/invites/${button.dataset.sendId}/send`, { method: 'POST' });
        if (!result) return;
        await loadInvites();
        setMessage('Invite email sent.');
      } catch (error) {
        setMessage(error.message, true);
      }
    });
  });
}

function renderUsers(users) {
  userListNode.innerHTML = '';

  if (!users.length) {
    userListNode.innerHTML = '<p class="meta">No profiles found.</p>';
    return;
  }

  users.forEach((user) => {
    const card = document.createElement('article');
    card.className = 'invite-item';
    const createdAt = user.created_at ? new Date(user.created_at).toLocaleString() : 'n/a';
    const lastActive = user.last_active_at ? new Date(user.last_active_at).toLocaleString() : 'n/a';
    const role = String(user.role || '').toLowerCase();
    const canDelete = role !== 'admin';
    const currentPlan = String(user.plan || 'none').toLowerCase();
    const subscriptionStatus = user.subscription_status || 'none';
    const trialEndsLabel = user.trial_ends_at ? new Date(user.trial_ends_at).toLocaleDateString() : 'n/a';

    card.innerHTML = `
      <strong>${user.name || 'Unnamed user'}</strong>
      <span class="meta">${user.email}</span>
      <span class="meta">Role: ${user.role} | Beta: ${user.beta_flag ? 'yes' : 'no'}</span>
      <span class="meta">Plan: ${currentPlan} | Subscription: ${subscriptionStatus} | Trial ends: ${trialEndsLabel}</span>
      <span class="meta">Created: ${createdAt} | Last active: ${lastActive}</span>
      ${role !== 'admin' ? `
        <div class="hero-actions">
          <select data-plan-user-id="${user.id}">
            <option value="bronze" ${currentPlan === 'bronze' ? 'selected' : ''}>bronze</option>
            <option value="silver" ${currentPlan === 'silver' ? 'selected' : ''}>silver</option>
            <option value="gold" ${currentPlan === 'gold' ? 'selected' : ''}>gold</option>
          </select>
          <button class="btn btn-secondary" data-update-user-plan-id="${user.id}">Update plan</button>
        </div>
      ` : ''}
      ${canDelete
        ? `<button class="btn btn-secondary" data-delete-user-id="${user.id}" data-delete-user-email="${user.email}">Delete profile</button>`
        : '<span class="meta">Admin profile protected</span>'}
    `;

    userListNode.appendChild(card);
  });

  document.querySelectorAll('[data-delete-user-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      const userId = button.dataset.deleteUserId;
      const email = button.dataset.deleteUserEmail;
      const confirmed = confirm(`Delete profile for ${email}? This also deletes their leads/events/subscription.`);
      if (!confirmed) return;

      try {
        const result = await adminFetch(`/api/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
        if (!result) return;
        await loadUsers();
        setMessage(`Deleted profile: ${result.user?.email || email}`);
      } catch (error) {
        setMessage(error.message, true);
      }
    });
  });

  document.querySelectorAll('[data-update-user-plan-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      const userId = button.dataset.updateUserPlanId;
      const select = document.querySelector(`[data-plan-user-id="${userId}"]`);
      const plan = select?.value;
      if (!plan) {
        setMessage('Select a valid plan first.', true);
        return;
      }

      try {
        const result = await adminFetch(`/api/admin/users/${encodeURIComponent(userId)}/plan`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan })
        });
        if (!result) return;

        await loadUsers();
        setMessage(`Updated ${result.user?.email || userId} to ${result.subscription?.planId || plan}.`);
      } catch (error) {
        setMessage(error.message, true);
      }
    });
  });
}

async function loadUsers() {
  const data = await adminFetch('/api/admin/users');
  renderUsers(data.users || []);
}

async function loadInvites() {
  const data = await adminFetch('/api/admin/invites');
  renderInvites(data.invites || []);
}

async function loadTemplates() {
  const data = await adminFetch('/api/admin/templates');
  templateMap = new Map((data.templates || []).map((tpl) => [tpl.key, tpl]));
  syncTemplateForm();
}

function syncTemplateForm() {
  const key = templateKeyNode.value;
  const scope = templatePlanScopeNode.value;
  const mapKey = scope === 'all' ? key : `${key}__${scope}`;
  const tpl = templateMap.get(mapKey);
  if (tpl) {
    templateSubjectNode.value = tpl.subject;
    templateBodyNode.value = tpl.body;
    return;
  }

  const defaults = {
    followup_hot: {
      subject: 'Next steps on your home search, {{firstName}}',
      body: 'Hi {{firstName}},\\n\\nGreat connecting with you. I lined up 3 options that match what you asked for. Would you like a quick 10-minute call today to pick the best one and schedule tours?\\n\\n- {{agentName}}'
    },
    followup_default: {
      subject: 'Quick follow-up on your search goals, {{firstName}}',
      body: 'Hi {{firstName}},\\n\\nI wanted to quickly check in. If your timeline is still active, I can send a tighter shortlist based on your must-haves. Reply with your top priorities and target move date.\\n\\n- {{agentName}}'
    },
    nurture_monthly: {
      subject: 'Still searching, {{firstName}}?',
      body: 'Hi {{leadName}},\\n\\nJust checking in with a light monthly update. If your home search is active again, reply with your top 2 priorities and we will line up options fast.\\n\\nNo rush at all. When timing is right, we are ready.\\n\\n- {{agentName}}'
    },
    digest_daily: {
      subject: "Today's Top 5 Leads",
      body: 'Hi {{firstName}},\\n\\nToday focus on these leads:\\n{{leadList}}\\n\\nOpen your dashboard for action recommendations.'
    },
    beta_ending: {
      subject: 'RealScoreAI beta ends in {{daysLeft}} days',
      body: 'Hi {{firstName}},\\n\\nYour RealScoreAI {{plan}} beta access ends in {{daysLeft}} days.\\n\\nIf you want to keep your lead scores, history, and workflow active with no data loss, move to early adopter pricing before beta ends.\\n\\n- RealScoreAI Team'
    }
  };

  const fallback = defaults[key] || { subject: '', body: '' };
  templateSubjectNode.value = fallback.subject;
  templateBodyNode.value = fallback.body;
}

function downloadCsv(filename, content) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

document.getElementById('refresh-invites').addEventListener('click', async () => {
  try {
    await loadInvites();
    await loadUsers();
    await loadTemplates();
    setMessage('Admin data refreshed.');
  } catch (error) {
    setMessage(error.message, true);
  }
});

document.getElementById('run-beta-reminders').addEventListener('click', async () => {
  try {
    const result = await adminFetch('/api/admin/automation/beta-ending-reminders', { method: 'POST' });
    if (!result) return;
    setMessage(`Beta reminders run: sent ${result.sentCount}, skipped ${result.skippedCount}.`);
  } catch (error) {
    setMessage(error.message, true);
  }
});

document.getElementById('invite-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formEl = event.currentTarget;
  const form = new FormData(formEl);

  try {
    const result = await adminFetch('/api/admin/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.get('name'),
        email: form.get('email')
      })
    });
    if (!result) return;

    formEl.reset();
    await loadInvites();
    if (result.emailSent) {
      setMessage('Invite created and email sent.');
    } else {
      setMessage(`Invite created, but email did not send: ${result.warning || 'unknown error'}`, true);
    }
  } catch (error) {
    setMessage(error.message, true);
  }
});

document.getElementById('demo-account-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formEl = event.currentTarget;
  const form = new FormData(formEl);

  try {
    const result = await adminFetch('/api/admin/demo-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.get('name'),
        email: form.get('email'),
        plan: form.get('plan'),
        trialDays: Number(form.get('trialDays') || 30)
      })
    });
    if (!result) return;

    formEl.reset();
    setMessage(`Demo account created for ${result.demoAccount.email}. Assigned plan: ${result.demoAccount.plan}. Setup email sent.`);
  } catch (error) {
    setMessage(error.message, true);
  }
});

templateKeyNode.addEventListener('change', syncTemplateForm);
templatePlanScopeNode.addEventListener('change', syncTemplateForm);

document.getElementById('template-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
      const key = templateKeyNode.value;
      const result = await adminFetch(`/api/admin/templates/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planScope: templatePlanScopeNode.value,
          subject: templateSubjectNode.value,
          body: templateBodyNode.value
        })
      });
      if (!result) return;

    await loadTemplates();
    setMessage(`Template ${key} saved for ${templatePlanScopeNode.value}.`);
  } catch (error) {
    setMessage(error.message, true);
  }
});

document.getElementById('export-usage').addEventListener('click', async () => {
  try {
    const csv = await adminFetch('/api/admin/export/usage.csv');
    if (!csv) return;
    downloadCsv('usage-export.csv', csv);
    setMessage('Usage CSV downloaded.');
  } catch (error) {
    setMessage(error.message, true);
  }
});

document.getElementById('export-leads').addEventListener('click', async () => {
  try {
    const csv = await adminFetch('/api/admin/export/leads.csv');
    if (!csv) return;
    downloadCsv('leads-export.csv', csv);
    setMessage('Leads CSV downloaded.');
  } catch (error) {
    setMessage(error.message, true);
  }
});

document.getElementById('check-email-status').addEventListener('click', async () => {
  try {
    const data = await adminFetch('/api/admin/email/status');
    if (!data) return;
    const smtp = data.smtp || {};
    setMessage(`SMTP mode: ${smtp.mode}. Host: ${smtp.host || 'n/a'}. From: ${smtp.from || 'n/a'}.`);
  } catch (error) {
    setMessage(error.message, true);
  }
});

document.getElementById('email-test-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const to = document.getElementById('email-test-to').value.trim();
    const result = await adminFetch('/api/admin/email/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to })
    });
    if (!result) return;
    setMessage(`Test email sent in ${result.delivery.mode} mode. Message ID: ${result.delivery.messageId || 'n/a'}`);
  } catch (error) {
    setMessage(error.message, true);
  }
});

async function init() {
  try {
    if (!token) {
      window.location.href = '/login.html';
      return;
    }
    const meResponse = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const meRaw = await meResponse.text();
    let me = {};
    try {
      me = meRaw ? JSON.parse(meRaw) : {};
    } catch {
      throw new Error(`Server error (${meResponse.status}). Check Render logs.`);
    }
    if (!meResponse.ok || me.user?.role !== 'admin') {
      localStorage.removeItem(TOKEN_KEY);
      window.location.href = '/login.html';
      return;
    }
    await loadInvites();
    await loadUsers();
    await loadTemplates();
    setMessage('Admin ready.');
  } catch (error) {
    setMessage(error.message, true);
  }
}

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

init();
