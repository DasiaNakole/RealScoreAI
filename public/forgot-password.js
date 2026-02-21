const messageNode = document.getElementById('forgot-message');

function setMessage(msg, isError = false) {
  messageNode.textContent = msg;
  messageNode.style.color = isError ? '#9f1239' : '#4d5b6b';
}

document.getElementById('forgot-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const email = String(form.get('email') || '').trim();

  try {
    const response = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not send reset link.');
    setMessage(data.message || 'If the email exists, a reset link was sent.');
  } catch (error) {
    setMessage(error.message, true);
  }
});
