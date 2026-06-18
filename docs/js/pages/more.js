import { getState } from '../store.js';
import { escapeHtml } from '../api.js';
import { openSets } from './sets.js';
import { openContacts } from './contacts.js';
import { openBulk } from './bulk.js';
import { openAddMembers } from './add-members.js';
import { openAi } from './ai.js';
import { openSettings } from './settings.js';
import { openHelp } from './help.js';

const container = document.getElementById('page-more');

export function renderMore() {
  if (!container) return;
  const { aiAvailable } = getState();

  const items = [
    { id: 'sets', icon: '📁', label: 'Sets', sub: 'Group collections for bulk send' },
    { id: 'contacts', icon: '👤', label: 'Contacts', sub: 'Saved phone numbers' },
    { id: 'bulk', icon: '📋', label: 'Bulk send', sub: 'Message many numbers' },
    { id: 'add-members', icon: '➕', label: 'Add members', sub: 'Add numbers to a group' },
    ...(aiAvailable ? [{ id: 'ai', icon: '🤖', label: 'AI chat', sub: 'ZeroClaw assistant' }] : []),
    { id: 'settings', icon: '⚙️', label: 'Settings', sub: 'API URL, logout' },
    { id: 'help', icon: '❓', label: 'Help', sub: 'Command reference' },
  ];

  container.innerHTML = `
    <div class="list-group">
      ${items.map((item) => `
        <div class="list-row" data-item="${escapeHtml(item.id)}">
          <span style="font-size:1.25rem">${item.icon}</span>
          <div class="row-main">
            <div class="row-title">${escapeHtml(item.label)}</div>
            <div class="row-sub">${escapeHtml(item.sub)}</div>
          </div>
          <span class="chevron">›</span>
        </div>`).join('')}
    </div>`;

  const handlers = {
    sets: openSets,
    contacts: openContacts,
    bulk: openBulk,
    'add-members': openAddMembers,
    ai: openAi,
    settings: openSettings,
    help: openHelp,
  };

  container.querySelectorAll('[data-item]').forEach((row) => {
    row.addEventListener('click', () => {
      const fn = handlers[row.dataset.item];
      if (fn) fn();
    });
  });
}
