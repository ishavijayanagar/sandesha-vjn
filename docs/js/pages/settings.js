import { getApiBase, setApiBase } from '../api.js';
import { doLogout } from '../auth.js';
import { toast } from '../toast.js';
import { pushSub } from '../router.js';

const container = document.getElementById('sub-settings');

export function renderSettings() {
  if (!container) return;
  container.innerHTML = `
    <div class="card">
      <h2>API URL</h2>
      <p class="hint">Cloudflare Quick Tunnel URL from your Pi/laptop. Update when tunnel restarts.</p>
      <div class="field">
        <input type="text" id="settings-api" value="${getApiBase()}">
      </div>
      <button type="button" class="btn" id="settings-save-api">Save URL</button>
    </div>
    <div class="card">
      <h2>Account</h2>
      <button type="button" class="btn danger" id="settings-logout">Logout</button>
    </div>
    <div class="card">
      <h2>Tunnel hint</h2>
      <p class="hint">Run: <code style="font-size:0.75rem">cloudflared tunnel --config scripts/sandesha-tunnel.yml --url http://127.0.0.1:42620</code></p>
    </div>`;

  container.querySelector('#settings-save-api')?.addEventListener('click', () => {
    const url = container.querySelector('#settings-api')?.value?.trim();
    if (!url) { toast('Enter a URL', 'err'); return; }
    setApiBase(url);
    toast('API URL saved', 'ok');
  });
  container.querySelector('#settings-logout')?.addEventListener('click', () => doLogout());
}

export function openSettings() {
  pushSub('settings', 'Settings');
  renderSettings();
}
