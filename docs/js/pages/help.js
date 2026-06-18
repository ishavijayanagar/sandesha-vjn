import { pushSub } from '../router.js';
import { escapeHtml } from '../api.js';

const container = document.getElementById('sub-help');

const COMMANDS = [
  ['!send &lt;target&gt; &lt;msg&gt;', 'Send to set, group, or contact'],
  ['!schedule &lt;time&gt; &lt;target&gt; &lt;msg&gt;', 'Schedule a message'],
  ['!sets', 'List your group sets'],
  ['!groups', 'List groups with activity'],
  ['!bulk', 'Bulk send wizard'],
  ['!settings', 'Manage sets via WhatsApp'],
  ['!ai &lt;question&gt;', 'Ask ZeroClaw (if running)'],
];

export function renderHelp() {
  if (!container) return;
  container.innerHTML = `
    <div class="card">
      <h2>WhatsApp commands</h2>
      <p class="hint">Some features (quoted forward, track/seen) are WhatsApp-only.</p>
      ${COMMANDS.map(([cmd, desc]) => `
        <div style="margin-bottom:12px">
          <div class="help-cmd">${cmd}</div>
          <div class="hint" style="margin-top:4px">${escapeHtml(desc)}</div>
        </div>`).join('')}
    </div>`;
}

export function openHelp() {
  pushSub('help', 'Help');
  renderHelp();
}
