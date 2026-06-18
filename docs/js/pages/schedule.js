import { api } from '../api.js';
import { getState } from '../store.js';
import { toast } from '../toast.js';
import { escapeHtml } from '../api.js';
import { openTargetPicker } from '../target-picker.js';
import { getTargetOptions } from '../store.js';

const container = document.getElementById('page-schedule');
let showForm = false;
let formTarget = null;

function formatCountdown(iso) {
  const diff = new Date(iso) - Date.now();
  if (diff <= 0) return 'Due soon';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 24) return `in ${Math.floor(h / 24)}d`;
  if (h > 0) return `in ${h}h ${m}m`;
  return `in ${m}m`;
}

export function renderSchedule() {
  if (!container) return;
  const { schedules } = getState();
  const sorted = [...(schedules || [])].sort((a, b) => new Date(a.runAt) - new Date(b.runAt));

  if (showForm) {
    const label = formTarget?.label || 'Choose target';
    container.innerHTML = `
      <div class="card">
        <h2>New schedule</h2>
        <div class="field">
          <label>Target</label>
          <button type="button" class="list-row" id="sched-target-btn" style="width:100%;border:1px solid var(--color-border);border-radius:var(--radius-sm)">
            <div class="row-main"><div class="row-title">${escapeHtml(label)}</div></div>
            <span class="chevron">›</span>
          </button>
        </div>
        <div class="field">
          <label>Message</label>
          <textarea id="sched-msg" rows="3" placeholder="Message to send"></textarea>
        </div>
        <div class="field">
          <label>When</label>
          <input type="datetime-local" id="sched-when">
        </div>
        <div class="chip-row">
          <button type="button" class="chip" data-chip="9am">9am today</button>
          <button type="button" class="chip" data-chip="Tomorrow 8am">Tomorrow 8am</button>
          <button type="button" class="chip" data-chip="in 1 hour">In 1 hour</button>
        </div>
        <div class="btn-row">
          <button type="button" class="btn secondary" id="sched-cancel">Cancel</button>
          <button type="button" class="btn" id="sched-save">Save</button>
        </div>
      </div>`;

    container.querySelector('#sched-target-btn')?.addEventListener('click', () => {
      openTargetPicker(getTargetOptions().filter((o) => o.type !== 'broadcast'), (t) => {
        formTarget = t;
        renderSchedule();
      });
    });
    container.querySelectorAll('[data-chip]').forEach((chip) => {
      chip.addEventListener('click', () => saveSchedule(chip.dataset.chip, true));
    });
    container.querySelector('#sched-cancel')?.addEventListener('click', () => { showForm = false; renderSchedule(); });
    container.querySelector('#sched-save')?.addEventListener('click', () => saveSchedule(null, false));
    return;
  }

  container.innerHTML = `
    ${sorted.length ? sorted.map((s) => `
      <div class="schedule-item">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:8px">
          <div>
            <div class="sched-time">${escapeHtml(formatCountdown(s.runAt))} · ${escapeHtml(new Date(s.runAt).toLocaleString())}</div>
            <div class="sched-target">→ ${escapeHtml(s.target)}</div>
            <div style="margin-top:4px">${escapeHtml((s.message || '').slice(0, 120))}</div>
          </div>
          <button type="button" class="btn btn-sm danger" data-del="${s.id}">Cancel</button>
        </div>
      </div>`).join('') : '<p class="empty">No scheduled messages. Tap + to create one.</p>'}
    <button type="button" class="fab" id="sched-fab" aria-label="New schedule">+</button>`;

  container.querySelector('#sched-fab')?.addEventListener('click', () => { showForm = true; formTarget = null; renderSchedule(); });
  container.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Cancel this schedule?')) return;
      try {
        await api(`/schedules/${btn.dataset.del}`, { method: 'DELETE' });
        toast('Schedule cancelled', 'ok');
        window.dispatchEvent(new CustomEvent('sandesha:refresh'));
      } catch (err) {
        toast(err.message, 'err');
      }
    });
  });
}

async function saveSchedule(timeStr, useTimeStr) {
  const msg = container.querySelector('#sched-msg')?.value?.trim();
  if (!formTarget) { toast('Choose a target', 'err'); return; }
  if (!msg) { toast('Enter a message', 'err'); return; }

  const body = { message: msg, target: formTarget.value };
  if (useTimeStr && timeStr) body.timeStr = timeStr;
  else {
    const when = container.querySelector('#sched-when')?.value;
    if (!when) { toast('Pick a date and time', 'err'); return; }
    body.runAt = new Date(when).toISOString();
  }

  try {
    await api('/schedules', { method: 'POST', body: JSON.stringify(body) });
    toast('Schedule saved', 'ok');
    showForm = false;
    formTarget = null;
    window.dispatchEvent(new CustomEvent('sandesha:refresh'));
  } catch (err) {
    toast(err.message, 'err');
  }
}

export function openNewSchedule() {
  showForm = true;
  formTarget = null;
  renderSchedule();
}
