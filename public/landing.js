const PLAN_KEY = 'selectedPlan';

function choosePlan(planId) {
  localStorage.setItem(PLAN_KEY, planId);
  window.location.href = '/signup.html';
}

document.querySelectorAll('[data-select-plan]').forEach((button) => {
  button.addEventListener('click', () => choosePlan(button.dataset.selectPlan));
});
