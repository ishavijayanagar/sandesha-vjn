import { api } from '../api.js';
import { getState } from '../store.js';
import { navigate } from '../router.js';
import { escapeHtml } from '../api.js';

const container = document.getElementById('page-home');

function formatCountdown(iso) {
  const diff = new Date(iso) - Date.now();
  if (diff <= 0) return 'Due soon';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function renderHome() {
  if (!container) return;
  const { health, schedules, groups } = getState();
  const online = health?.status === 'ok';
  const number = health?.info?.wid?.user || '—';
  const recent = sessionStorage.getItem('sandesha_last_send') || '';

  const upcoming = [...(schedules || [])]
    .filter((s) => new Date(s.runAt) > Date.now())
    .sort((a, b) => new Date(a.runAt) - new Date(b.runAt))
    .slice(0, 3);

  container.innerHTML = `
    <div class="card">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <span class="status-dot ${online ? 'online' : 'offline'}"></span>
        <div>
          <div style="font-weight:600">${online ? 'Connected' : 'Offline'}</div>
          <div class="hint" style="margin:0">${escapeHtml(number)} · ${groups.length} groups</div>
        </div>
      </div>
      ${health?.commandsGroupName ? `<div class="hint">Commands: ${escapeHtml(health.commandsGroupName)}</div>` : ''}
    </div>

    <h2 style="font-size:0.875rem;color:var(--color-text-muted);margin:0 0 8px;text-transform:uppercase;letter-spacing:0.05em">Quick actions</h2>
    <div class="quick-actions">
      <button type="button" class="quick-action" data-action="send-set">
        <span class="qa-icon">📤</span> Send to set
      </button>
      <button type="button" class="quick-action" data-action="schedule">
        <span class="qa-icon">⏰</span> Schedule
      </button>
      <button type="button" class="quick-action" data-action="broadcast">
        <span class="qa-icon">📢</span> Broadcast
      </button>
      <button type="button" class="quick-action" data-action="refresh">
        <span class="qa-icon">🔄</span> Refresh
      </button>
    </div>

    <div class="card">
      <h2>Upcoming schedules</h2>
      ${upcoming.length ? upcoming.map((s) => `
        <div class="schedule-item">
          <div class="sched-time">${escapeHtml(formatCountdown(s.runAt))} · ${escapeHtml(new Date(s.runAt).toLocaleString())}</div>
          <div class="sched-target">→ ${escapeHtml(s.target)}</div>
          <div>${escapeHtml((s.message || '').slice(0, 80))}${(s.message || '').length > 80 ? '…' : ''}</div>
        </div>`).join('') : '<p class="empty" style="padding:12px">No upcoming schedules</p>'}
    </div>

    ${recent ? `<div class="card"><h2>Recent activity</h2><p class="hint">${escapeHtml(recent)}</p></div>` : ''}`;

  container.querySelector('[data-action="send-set"]')?.addEventListener('click', () => navigate('send'));
  container.querySelector('[data-action="schedule"]')?.addEventListener('click', () => navigate('schedule'));
  container.querySelector('[data-action="broadcast"]')?.addEventListener('click', async () => {
    const msg = prompt('Broadcast message to all groups:');
    if (!msg?.trim()) return;
    try {
      const r = await api('/send/broadcast', { method: 'POST', body: JSON.stringify({ message: msg.trim() }) });
      sessionStorage.setItem('sandesha_last_send', `Broadcast sent to ${r.sent}/${r.total} groups`);
      renderHome();
    } catch (err) {
      alert(err.message);
    }
  });
  container.querySelector('[data-action="refresh"]')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('sandesha:refresh'));
  });
}
