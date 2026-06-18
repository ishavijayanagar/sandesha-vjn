const DEFAULT_API = 'http://127.0.0.1:42620';
const TOKEN_KEY = 'sandesha_token';

const configApi = (typeof window !== 'undefined' && window.SANDESHA_CONFIG?.apiUrl) || null;

const loginSection = document.getElementById('login-section');
const appSection = document.getElementById('app-section');
const loginPassword = document.getElementById('login-password');
const btnLogin = document.getElementById('btn-login');
const loginStatus = document.getElementById('login-status');
const btnLogout = document.getElementById('btn-logout');
const statusBar = document.getElementById('status-bar');
const statusDetails = document.getElementById('status-details');
const apiInput = document.getElementById('api-url');
const btnSaveApi = document.getElementById('btn-save-api');

const setsList = document.getElementById('sets-list');
const groupSearch = document.getElementById('group-search');
const groupList = document.getElementById('group-list');
const setNameInput = document.getElementById('set-name');
const btnSaveSet = document.getElementById('btn-save-set');
const btnSelectAll = document.getElementById('btn-select-all');
const btnClearSel = document.getElementById('btn-clear-sel');

const groupsSearch = document.getElementById('groups-search');
const groupsList = document.getElementById('groups-list');

const sendTarget = document.getElementById('send-target');
const sendMessage = document.getElementById('send-message');
const btnSend = document.getElementById('btn-send');
const sendStatus = document.getElementById('send-status');

let apiBase = localStorage.getItem('sandesha_api') || configApi || DEFAULT_API;
let token = sessionStorage.getItem(TOKEN_KEY) || '';
let allGroups = [];
let sets = {};
let selectedJids = new Set();

apiInput.value = apiBase;

function getToken() {
  return sessionStorage.getItem(TOKEN_KEY) || '';
}

function setToken(value) {
  token = value || '';
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

function showLogin() {
  loginSection.classList.remove('hidden');
  appSection.classList.add('hidden');
}

function showApp() {
  loginSection.classList.add('hidden');
  appSection.classList.remove('hidden');
}

function setBar(msg, type = 'info') {
  statusBar.textContent = msg;
  statusBar.className = `status ${type}`;
}

function setLoginStatus(msg, type = 'info') {
  loginStatus.textContent = msg;
  loginStatus.className = `status ${type}`;
}

async function api(path, options = {}) {
  const url = `${apiBase.replace(/\/$/, '')}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;

  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text }; }

  if (res.status === 401) {
    setToken('');
    showLogin();
    setLoginStatus('Session expired. Please log in again.', 'err');
    throw new Error(data.error || 'Unauthorized');
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escapeAttr(s) { return escapeHtml(s); }

function switchTab(name) {
  document.querySelectorAll('.tab:not(.tab-logout)').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === name);
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.add('hidden');
  });
  const panel = document.getElementById(`panel-${name}`);
  if (panel) panel.classList.remove('hidden');
}

document.querySelectorAll('.tab:not(.tab-logout)').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function renderStatus(health) {
  const rows = [
    ['Status', health.status || 'unknown'],
    ['Auth required', health.authRequired ? 'Yes' : 'No'],
    ['Commands group', health.commandsGroupName || '—'],
  ];
  if (health.info?.wid?.user) {
    rows.push(['WhatsApp number', health.info.wid.user]);
  }
  if (health.commandsGroup) {
    rows.push(['Commands JID', health.commandsGroup]);
  }
  statusDetails.innerHTML = rows.map(([k, v]) =>
    `<div class="status-row"><span class="status-label">${escapeHtml(k)}</span><span>${escapeHtml(String(v))}</span></div>`
  ).join('');
}

function renderSets() {
  const keys = Object.keys(sets);
  if (keys.length === 0) {
    setsList.innerHTML = '<p class="empty">No sets yet. Create one below.</p>';
    return;
  }

  const jidToName = Object.fromEntries(allGroups.map((g) => [g.jid, g.name]));
  setsList.innerHTML = keys.map((name) => {
    const jids = sets[name] || [];
    const groups = jids.map((j) => `<li>${escapeHtml(jidToName[j] || j)}</li>`).join('');
    return `
      <div class="set-item">
        <h3>${escapeHtml(name)} <span style="color:#888;font-weight:normal">(${jids.length})</span></h3>
        <ul class="set-groups">${groups || '<li class="empty">No groups</li>'}</ul>
        <div class="row" style="margin-top:8px">
          <button class="danger" data-delete="${escapeHtml(name)}">Delete set</button>
        </div>
      </div>`;
  }).join('');

  setsList.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const name = btn.getAttribute('data-delete');
      if (!confirm(`Delete set "${name}"?`)) return;
      delete sets[name];
      await api('/sets', { method: 'POST', body: JSON.stringify({ sets }) });
      setBar(`Deleted set "${name}"`, 'ok');
      renderSets();
    });
  });
}

function renderGroupsPicker(filter = '') {
  const q = filter.trim().toLowerCase();
  const filtered = q
    ? allGroups.filter((g) => g.name.toLowerCase().includes(q))
    : allGroups;

  if (filtered.length === 0) {
    groupList.innerHTML = '<p class="empty">No groups match.</p>';
    return;
  }

  groupList.innerHTML = filtered.slice(0, 200).map((g) => `
    <label class="group-row">
      <input type="checkbox" value="${escapeAttr(g.jid)}" ${selectedJids.has(g.jid) ? 'checked' : ''}>
      <span>${escapeHtml(g.name)}</span>
    </label>
  `).join('');

  groupList.querySelectorAll('input[type=checkbox]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) selectedJids.add(cb.value);
      else selectedJids.delete(cb.value);
      updateSaveButton();
    });
  });
}

function renderGroupsBrowse(filter = '') {
  const q = filter.trim().toLowerCase();
  const filtered = q
    ? allGroups.filter((g) => g.name.toLowerCase().includes(q))
    : allGroups;

  if (filtered.length === 0) {
    groupsList.innerHTML = '<p class="empty">No groups match.</p>';
    return;
  }

  groupsList.innerHTML = filtered.slice(0, 300).map((g) => `
    <div class="group-row browse">
      <span class="group-name">${escapeHtml(g.name)}</span>
      <span class="group-meta">${g.participants ?? '?'} members · ${escapeHtml(g.type || 'group')}</span>
    </div>
  `).join('');
}

function updateSaveButton() {
  btnSaveSet.disabled = !setNameInput.value.trim() || selectedJids.size === 0;
}

async function loadData() {
  const [health, groups, setsData] = await Promise.all([
    api('/health'),
    api('/groups'),
    api('/sets'),
  ]);
  allGroups = groups.sort((a, b) => a.name.localeCompare(b.name));
  sets = setsData.sets || setsData || {};
  renderStatus(health);
  renderSets();
  renderGroupsPicker();
  renderGroupsBrowse();
  setBar(`Connected — ${allGroups.length} groups, ${Object.keys(sets).length} sets`, 'ok');
}

async function tryRestoreSession() {
  try {
    const health = await fetch(`${apiBase.replace(/\/$/, '')}/health`).then((r) => r.json());
    if (!health.authRequired) {
      showApp();
      await loadData();
      return;
    }
  } catch {
    showLogin();
    setLoginStatus(`Cannot reach server at ${apiBase}. Check config.js or Advanced API URL.`, 'err');
    return;
  }

  if (!getToken()) {
    showLogin();
    setLoginStatus('Log in to connect to your Sandesha server.', 'info');
    return;
  }
  try {
    showApp();
    await loadData();
  } catch {
    showLogin();
  }
}

async function doLogin() {
  const password = loginPassword.value;
  if (!password) {
    setLoginStatus('Enter your password.', 'err');
    return;
  }
  btnLogin.disabled = true;
  setLoginStatus('Logging in…', 'info');
  try {
    const result = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    setToken(result.token);
    loginPassword.value = '';
    showApp();
    await loadData();
  } catch (err) {
    setLoginStatus(err.message || 'Login failed', 'err');
  } finally {
    btnLogin.disabled = false;
  }
}

btnLogin.addEventListener('click', doLogin);
loginPassword.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doLogin();
});

btnLogout.addEventListener('click', async () => {
  try {
    await api('/auth/logout', { method: 'POST', body: '{}' });
  } catch {
    // ignore
  }
  setToken('');
  showLogin();
  setLoginStatus('Logged out.', 'info');
});

btnSaveApi.addEventListener('click', () => {
  apiBase = apiInput.value.trim() || DEFAULT_API;
  localStorage.setItem('sandesha_api', apiBase);
  setLoginStatus(`API URL saved: ${apiBase}`, 'ok');
});

groupSearch.addEventListener('input', () => renderGroupsPicker(groupSearch.value));
groupsSearch.addEventListener('input', () => renderGroupsBrowse(groupsSearch.value));
setNameInput.addEventListener('input', updateSaveButton);

btnSelectAll.addEventListener('click', () => {
  groupList.querySelectorAll('input[type=checkbox]').forEach((cb) => {
    cb.checked = true;
    selectedJids.add(cb.value);
  });
  updateSaveButton();
});

btnClearSel.addEventListener('click', () => {
  selectedJids.clear();
  renderGroupsPicker(groupSearch.value);
  updateSaveButton();
});

btnSaveSet.addEventListener('click', async () => {
  const name = setNameInput.value.trim().toLowerCase().replace(/\s+/g, '_');
  if (!name || !/^[a-z0-9_]+$/.test(name)) {
    setBar('Set name: letters, numbers, underscores only', 'err');
    return;
  }
  if (selectedJids.size === 0) {
    setBar('Select at least one group', 'err');
    return;
  }

  const existing = new Set(sets[name] || []);
  selectedJids.forEach((j) => existing.add(j));
  sets[name] = [...existing];

  try {
    await api('/sets', { method: 'POST', body: JSON.stringify({ sets }) });
    setBar(`Saved set "${name}" (${sets[name].length} groups)`, 'ok');
    setNameInput.value = '';
    selectedJids.clear();
    renderSets();
    renderGroupsPicker(groupSearch.value);
    updateSaveButton();
  } catch (err) {
    setBar(`Save failed: ${err.message}`, 'err');
  }
});

btnSend.addEventListener('click', async () => {
  const target = sendTarget.value.trim();
  const message = sendMessage.value.trim();
  if (!target || !message) {
    sendStatus.classList.remove('hidden');
    sendStatus.textContent = 'Enter target and message.';
    sendStatus.className = 'status err';
    return;
  }
  btnSend.disabled = true;
  sendStatus.classList.remove('hidden');
  sendStatus.textContent = 'Sending…';
  sendStatus.className = 'status info';
  try {
    await api('/send', {
      method: 'POST',
      body: JSON.stringify({ recipient: target, message }),
    });
    sendStatus.textContent = `Sent to "${target}"`;
    sendStatus.className = 'status ok';
    sendMessage.value = '';
  } catch (err) {
    sendStatus.textContent = err.message || 'Send failed';
    sendStatus.className = 'status err';
  } finally {
    btnSend.disabled = false;
  }
});

tryRestoreSession();
