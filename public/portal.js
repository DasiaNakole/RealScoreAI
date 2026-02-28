const TOKEN_KEY = 'authToken';
const token = localStorage.getItem(TOKEN_KEY);

if (!token) {
  window.location.href = '/login.html';
}

async function loadPortal() {
  const response = await fetch('/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await response.json();
  if (!response.ok) {
    localStorage.removeItem(TOKEN_KEY);
    window.location.href = '/login.html';
    return;
  }

  const firstName = String(data.user?.name || '').split(' ')[0] || 'there';
  document.getElementById('portal-title').textContent = `Welcome, ${firstName}`;
  document.getElementById('admin-card').style.display = data.user?.role === 'admin' ? '' : 'none';
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

loadPortal().catch(() => {
  window.location.href = '/login.html';
});
