const TOKEN_KEY = 'authToken';
const token = localStorage.getItem(TOKEN_KEY);

if (!token) {
  window.location.href = '/auth.html';
}

function setMessage(msg, isError = false) {
  const node = document.getElementById('onboarding-message');
  node.textContent = msg;
  node.style.color = isError ? '#9f1239' : '#4d5b6b';
}

document.getElementById('onboarding-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);

  try {
    const response = await fetch('/api/onboarding', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        market: form.get('market'),
        monthlyLeadVolume: Number(form.get('monthlyLeadVolume')),
        goal: form.get('goal')
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Onboarding failed');

    window.location.href = '/payment.html';
  } catch (error) {
    setMessage(error.message, true);
  }
});
