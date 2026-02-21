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
}

loadPortal().catch(() => {
  window.location.href = '/login.html';
});
