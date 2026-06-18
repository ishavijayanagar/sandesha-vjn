import { api } from '../api.js';
import { toast } from '../toast.js';
import { escapeHtml } from '../api.js';
import { pushSub } from '../router.js';

const container = document.getElementById('sub-ai');
const history = [];

export function renderAi() {
  if (!container) return;
  container.innerHTML = `
    <div class="ai-messages" id="ai-msgs">
      ${history.map((m) => `<div class="ai-bubble ${m.role}">${escapeHtml(m.text)}</div>`).join('')}
    </div>
    <div class="field">
      <textarea id="ai-input" rows="2" placeholder="Ask ZeroClaw…"></textarea>
    </div>
    <button type="button" class="btn" id="ai-send">Send</button>`;

  container.querySelector('#ai-send')?.addEventListener('click', sendChat);
  container.querySelector('#ai-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
}

async function sendChat() {
  const input = container.querySelector('#ai-input');
  const text = input?.value?.trim();
  if (!text) return;
  history.push({ role: 'user', text });
  renderAi();
  input.value = '';
  const btn = container.querySelector('#ai-send');
  if (btn) btn.disabled = true;
  try {
    const data = await api('/ai/chat', { method: 'POST', body: JSON.stringify({ message: text }) });
    history.push({ role: 'bot', text: data.response || 'No response' });
    renderAi();
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    if (btn) btn.disabled = false;
  }
}

export function openAi() {
  pushSub('ai', 'AI chat');
  renderAi();
}
