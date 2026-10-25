import { api, showStatus } from './common.js';

const form = document.getElementById('login-form');
const status = document.getElementById('login-status');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = form.username.value.trim();
  const password = form.password.value;
  if (!username || !password) {
    showStatus(status, 'Enter your username and password.', true);
    return;
  }

  const button = form.querySelector('button');
  button.disabled = true;
  try {
    await api('POST', '/api/admin/login', { username, password });
    location.href = '/admin';
  } catch (err) {
    showStatus(status, err.message, true);
    form.password.select();
    button.disabled = false;
  }
});
