const PLAN_KEY = 'selectedPlan';

function choosePlan(planId) {
  localStorage.setItem(PLAN_KEY, planId);
  window.location.href = '/auth.html';
}

document.querySelectorAll('[data-select-plan]').forEach((button) => {
  button.addEventListener('click', () => choosePlan(button.dataset.selectPlan));
});
