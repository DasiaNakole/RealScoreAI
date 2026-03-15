const THEME_KEY = 'realscoreai-theme';
const DEFAULT_THEME = 'dark';

function getStoredTheme() {
  const storedTheme = window.localStorage.getItem(THEME_KEY);
  return storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : DEFAULT_THEME;
}

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  const toggle = document.getElementById('theme-toggle');
  if (toggle) {
    const nextLabel = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    toggle.textContent = nextLabel;
    toggle.setAttribute('aria-label', nextLabel);
  }
}

function toggleTheme() {
  const nextTheme = document.body.dataset.theme === 'light' ? 'dark' : 'light';
  window.localStorage.setItem(THEME_KEY, nextTheme);
  applyTheme(nextTheme);
}

function mountThemeToggle() {
  if (document.getElementById('theme-toggle')) {
    return;
  }

  const toggle = document.createElement('button');
  toggle.id = 'theme-toggle';
  toggle.className = 'theme-toggle';
  toggle.type = 'button';
  toggle.addEventListener('click', toggleTheme);
  document.body.appendChild(toggle);
  applyTheme(getStoredTheme());
}

document.addEventListener('DOMContentLoaded', () => {
  applyTheme(getStoredTheme());
  mountThemeToggle();
});
