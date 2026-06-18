import { api, uploadFile } from '../api.js';
import { getState, getTargetOptions } from '../store.js';
import { openTargetPicker } from '../target-picker.js';
import { toast } from '../toast.js';
import { escapeHtml } from '../api.js';

const container = document.getElementById('page-send');
let selectedTarget = null;
let pendingFile = null;

export function renderSend() {
  if (!container) return;
  const label = selectedTarget?.label || 'Tap to choose target';

  container.innerHTML = `
    <div class="field">
      <label>Target</label>
      <button type="button" class="list-row" id="send-target-btn" style="width:100%;border-radius:var(--radius-sm);border:1px solid var(--color-border)">
        <div class="row-main">
          <div class="row-title">${escapeHtml(label)}</div>
          <div class="row-sub">${selectedTarget ? selectedTarget.type : 'Sets, groups, contacts, or all groups'}</div>
        </div>
        <span class="chevron">›</span>
      </button>
    </div>
    <div class="field">
      <label>Message</label>
      <textarea id="send-msg" rows="4" placeholder="Type your message…"></textarea>
    </div>
    <div class="field">
      <label>Media (optional)</label>
      <input type="file" id="send-media" accept="image/*,video/*">
      <p class="hint" id="send-media-name">${pendingFile ? escapeHtml(pendingFile.name) : 'Attach from gallery or camera'}</p>
    </div>
    <div id="send-progress" class="hidden">
      <div class="progress-bar"><div class="progress-bar-fill" id="send-progress-fill" style="width:0%"></div></div>
      <p class="hint" id="send-progress-text"></p>
    </div>
    <div class="sticky-compose">
      <button type="button" class="btn" id="send-btn">Send</button>
    </div>`;

  container.querySelector('#send-target-btn')?.addEventListener('click', () => {
    openTargetPicker(getTargetOptions(), (t) => { selectedTarget = t; renderSend(); });
  });

  container.querySelector('#send-media')?.addEventListener('change', (e) => {
    pendingFile = e.target.files?.[0] || null;
    const hint = container.querySelector('#send-media-name');
    if (hint) hint.textContent = pendingFile ? pendingFile.name : 'Attach from gallery or camera';
  });

  container.querySelector('#send-btn')?.addEventListener('click', doSend);
}

async function doSend() {
  const msg = container.querySelector('#send-msg')?.value?.trim();
  if (!selectedTarget) { toast('Choose a target first', 'err'); return; }
  if (!msg && !pendingFile) { toast('Enter a message or attach media', 'err'); return; }

  const btn = container.querySelector('#send-btn');
  if (btn) btn.disabled = true;

  try {
    if (selectedTarget.type === 'broadcast' || selectedTarget.value === '__broadcast__') {
      await api('/send/broadcast', { method: 'POST', body: JSON.stringify({ message: msg }) });
      sessionStorage.setItem('sandesha_last_send', `Broadcast sent`);
      toast('Broadcast sent', 'ok');
      return;
    }

    const { sets } = getState();
    const setGroups = sets[selectedTarget.value.toLowerCase()];
    const targets = setGroups || [selectedTarget.value];

    const progressEl = container.querySelector('#send-progress');
    const progressFill = container.querySelector('#send-progress-fill');
    const progressText = container.querySelector('#send-progress-text');
    if (setGroups?.length > 1) progressEl?.classList.remove('hidden');

    let filePath = null;
    if (pendingFile) {
      const up = await uploadFile(pendingFile);
      filePath = up.filePath;
    }

    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (setGroups?.length > 1) {
        const pct = Math.round(((i + 1) / targets.length) * 100);
        if (progressFill) progressFill.style.width = `${pct}%`;
        if (progressText) progressText.textContent = `Sending ${i + 1} of ${targets.length}…`;
      }
      if (filePath) {
        await api('/send-media', {
          method: 'POST',
          body: JSON.stringify({ recipient: t, filePath, caption: msg || '' }),
        });
      } else {
        await api('/send', {
          method: 'POST',
          body: JSON.stringify({ recipient: t, message: msg }),
        });
      }
      if (targets.length > 1 && i < targets.length - 1) {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }

    const label = selectedTarget.label || selectedTarget.value;
    sessionStorage.setItem('sandesha_last_send', `Sent to ${label}${setGroups ? ` (${setGroups.length} groups)` : ''}`);
    toast('Message sent', 'ok');
    container.querySelector('#send-msg').value = '';
    pendingFile = null;
    renderSend();
  } catch (err) {
    toast(err.message || 'Send failed', 'err');
  } finally {
    if (btn) btn.disabled = false;
    container.querySelector('#send-progress')?.classList.add('hidden');
  }
}

export function prefillTarget(target) {
  selectedTarget = target;
}
