import { api } from '../api.js';
import { toast } from '../toast.js';
import { escapeHtml } from '../api.js';
import { pushSub } from '../router.js';

const container = document.getElementById('sub-bulk');

function countNumbers(text) {
  return (text.match(/\+?\d[\d\s\-()]{8,}/g) || []).length;
}

export function renderBulk() {
  if (!container) return;
  container.innerHTML = `
    <div class="card">
      <h2>Bulk send</h2>
      <p class="hint">Paste phone numbers (one per line or comma-separated). Max 100 per send.</p>
      <div class="field">
        <label>Numbers <span class="count-badge" id="bulk-count">0</span></label>
        <textarea id="bulk-numbers" class="mono" rows="8" placeholder="+919876543210&#10;9876543210"></textarea>
      </div>
      <div class="field">
        <label>Message</label>
        <textarea id="bulk-msg" rows="4" placeholder="Message to send"></textarea>
      </div>
      <button type="button" class="btn" id="bulk-send">Send to all numbers</button>
      <div id="bulk-results" style="margin-top:12px"></div>
    </div>`;

  const nums = container.querySelector('#bulk-numbers');
  const countEl = container.querySelector('#bulk-count');
  nums?.addEventListener('input', () => {
    if (countEl) countEl.textContent = String(countNumbers(nums.value));
  });

  container.querySelector('#bulk-send')?.addEventListener('click', async () => {
    const numbers = nums?.value || '';
    const message = container.querySelector('#bulk-msg')?.value?.trim();
    if (!numbers.trim() || !message) { toast('Numbers and message required', 'err'); return; }
    const btn = container.querySelector('#bulk-send');
    if (btn) btn.disabled = true;
    const resultsEl = container.querySelector('#bulk-results');
    if (resultsEl) resultsEl.innerHTML = '<p class="hint">Sending… (this may take a while)</p>';
    try {
      const data = await api('/send/bulk', {
        method: 'POST',
        body: JSON.stringify({ numbers, message }),
      });
      const results = data.results || [];
      const ok = results.filter((r) => r.ok).length;
      if (resultsEl) {
        resultsEl.innerHTML = `<p class="hint">Sent ${ok}/${results.length}</p>
          ${results.filter((r) => !r.ok).slice(0, 10).map((r) =>
            `<p class="hint" style="color:var(--color-danger)">${escapeHtml(r.number)}: ${escapeHtml(r.error || 'failed')}</p>`
          ).join('')}`;
      }
      toast(`Bulk send: ${ok}/${results.length} ok`, ok === results.length ? 'ok' : 'info');
    } catch (err) {
      toast(err.message, 'err');
      if (resultsEl) resultsEl.innerHTML = '';
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

export function openBulk() {
  pushSub('bulk', 'Bulk send');
  renderBulk();
}
