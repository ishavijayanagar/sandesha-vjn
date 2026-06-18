import { api, getToken, setToken, getApiBase } from './api.js';
import { toast } from './toast.js';

const loginView = document.getElementById('login-view');
const appView = document.getElementById('app-view');
const loginPassword = document.getElementById('login-password');
const btnLogin = document.getElementById('btn-login');
const loginStatus = document.getElementById('login-status');
const togglePw = document.getElementById('toggle-pw');

let onLoginSuccess = null;

export function setLoginSuccessHandler(fn) {
  onLoginSuccess = fn;
}

export function showLogin() {
  loginView?.classList.remove('hidden');
  appView?.classList.add('hidden');
}

export function showApp() {
  loginView?.classList.add('hidden');
  appView?.classList.remove('hidden');
}

function setLoginStatus(msg, type = 'info') {
  if (!loginStatus) return;
  loginStatus.textContent = msg;
  loginStatus.className = `hint ${type === 'err' ? 'err' : ''}`;
  loginStatus.style.color = type === 'err' ? 'var(--color-danger)' : type === 'ok' ? 'var(--color-success)' : '';
}

export async function doLogin() {
  const password = loginPassword?.value || '';
  if (!password) {
    setLoginStatus('Enter your password.', 'err');
    return;
  }
  if (btnLogin) btnLogin.disabled = true;
  setLoginStatus('Logging in…', 'info');
  try {
    const result = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    setToken(result.token);
    if (loginPassword) loginPassword.value = '';
    showApp();
    if (onLoginSuccess) await onLoginSuccess();
    toast('Logged in', 'ok');
  } catch (err) {
    setLoginStatus(err.message || 'Login failed', 'err');
  } finally {
    if (btnLogin) btnLogin.disabled = false;
  }
}

export async function doLogout() {
  try {
    await api('/auth/logout', { method: 'POST', body: '{}' });
  } catch { /* ignore */ }
  setToken('');
  showLogin();
  setLoginStatus('Logged out.', 'info');
}

export async function tryRestoreSession() {
  try {
    const health = await fetch(`${getApiBase()}/health`).then((r) => r.json());
    if (!health.authRequired) {
      showApp();
      if (onLoginSuccess) await onLoginSuccess();
      return;
    }
  } catch {
    showLogin();
    setLoginStatus(`Cannot reach server at ${getApiBase()}. Check Settings → API URL.`, 'err');
    return;
  }

  if (!getToken()) {
    showLogin();
    setLoginStatus('Log in to connect to your Sandesha server.', 'info');
    return;
  }
  try {
    showApp();
    if (onLoginSuccess) await onLoginSuccess();
  } catch {
    showLogin();
    setLoginStatus('Session expired. Please log in again.', 'err');
  }
}

btnLogin?.addEventListener('click', doLogin);
loginPassword?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doLogin();
});
togglePw?.addEventListener('click', () => {
  if (!loginPassword) return;
  const show = loginPassword.type === 'password';
  loginPassword.type = show ? 'text' : 'password';
  togglePw.textContent = show ? 'Hide' : 'Show';
});

export function handleUnauthorized() {
  showLogin();
  setLoginStatus('Session expired. Please log in again.', 'err');
}
