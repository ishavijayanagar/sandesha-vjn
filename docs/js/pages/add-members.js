import { api } from '../api.js';
import { getState } from '../store.js';
import { toast } from '../toast.js';
import { escapeHtml, escapeAttr } from '../api.js';
import { pushSub } from '../router.js';

const container = document.getElementById('sub-add-members');
let pollTimer = null;

export function renderAddMembers() {
  if (!container) return;
  const { groups } = getState();

  container.innerHTML = `
    <div class="card">
      <h2>Add members to group</h2>
      <p class="hint">Adds one number at a time (~90s delay). Max 50 per job.</p>
      <div class="field">
        <label>Group</label>
        <select id="am-group">
          <option value="">Choose group…</option>
          ${groups.map((g) => `<option value="${escapeAttr(g.jid)}">${escapeHtml(g.name)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Phone numbers</label>
        <textarea id="am-numbers" class="mono" rows="6" placeholder="One per line"></textarea>
      </div>
      <button type="button" class="btn" id="am-start">Start job</button>
      <div id="am-status" class="job-status"></div>
      <div id="am-errors"></div>
    </div>`;

  container.querySelector('#am-start')?.addEventListener('click', startJob);
}

async function startJob() {
  const groupJid = container.querySelector('#am-group')?.value;
  const numbers = container.querySelector('#am-numbers')?.value || '';
  if (!groupJid || !numbers.trim()) { toast('Select group and enter numbers', 'err'); return; }

  if (pollTimer) clearInterval(pollTimer);
  const statusEl = container.querySelector('#am-status');
  const errorsEl = container.querySelector('#am-errors');
  const btn = container.querySelector('#am-start');
  if (btn) btn.disabled = true;

  try {
    const { jobId } = await api('/jobs/add-members', {
      method: 'POST',
      body: JSON.stringify({ groupJid, numbers }),
    });
    toast('Job started', 'ok');
    pollTimer = setInterval(async () => {
      try {
        const job = await api(`/jobs/${jobId}`);
        if (statusEl) {
          statusEl.textContent = `${job.status}: ${job.done}/${job.total}`;
        }
        if (errorsEl && job.errors?.length) {
          errorsEl.innerHTML = job.errors.map((e) =>
            `<p class="hint" style="color:var(--color-danger)">${escapeHtml(e)}</p>`
          ).join('');
        }
        if (job.status === 'done' || job.status === 'cancelled') {
          clearInterval(pollTimer);
          pollTimer = null;
          if (btn) btn.disabled = false;
          toast('Job finished', 'ok');
        }
      } catch {
        clearInterval(pollTimer);
        if (btn) btn.disabled = false;
      }
    }, 3000);
  } catch (err) {
    toast(err.message, 'err');
    if (btn) btn.disabled = false;
  }
}

export function openAddMembers() {
  pushSub('add-members', 'Add members');
  renderAddMembers();
}
