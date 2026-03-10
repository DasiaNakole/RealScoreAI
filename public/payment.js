const TOKEN_KEY = 'authToken';
const PLAN_KEY = 'selectedPlan';
const PLAN_ALIASES = { core: 'bronze', pro: 'silver', team: 'gold', platinum: 'gold' };

const token = localStorage.getItem(TOKEN_KEY);
if (!token) {
  window.location.href = '/login.html';
}

const selectedPlanRaw = localStorage.getItem(PLAN_KEY) || 'silver';
const selectedPlan = PLAN_ALIASES[selectedPlanRaw] || selectedPlanRaw;
localStorage.setItem(PLAN_KEY, selectedPlan);
document.getElementById('payment-plan').textContent = selectedPlan.charAt(0).toUpperCase() + selectedPlan.slice(1);

function setMessage(msg, isError = false) {
  const node = document.getElementById('payment-message');
  node.textContent = msg;
  node.style.color = isError ? '#9f1239' : '#4d5b6b';
}

document.getElementById('payment-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const cardNumber = String(form.get('cardNumber') || '').replace(/\s+/g, '');

  if (cardNumber.length < 12) {
    setMessage('Enter a valid card number.', true);
    return;
  }

  try {
    const response = await fetch('/api/billing/start-trial', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        planId: selectedPlan,
        cardholderName: form.get('cardholderName'),
        paymentMethodLast4: cardNumber.slice(-4)
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to activate trial');

    window.location.href = '/portal.html';
  } catch (error) {
    setMessage(error.message, true);
  }
});
