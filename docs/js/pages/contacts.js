import { api } from '../api.js';
import { getState } from '../store.js';
import { toast } from '../toast.js';
import { escapeHtml, escapeAttr } from '../api.js';
import { pushSub } from '../router.js';

const container = document.getElementById('sub-contacts');
let showAdd = false;

export function renderContacts() {
  if (!container) return;
  const contacts = getState().contacts || {};
  const entries = Object.entries(contacts).sort(([a], [b]) => a.localeCompare(b));

  if (showAdd) {
    container.innerHTML = `
      <div class="card">
        <h2>Add contact</h2>
        <div class="field"><label>Name</label><input type="text" id="ct-name" placeholder="Display name"></div>
        <div class="field"><label>Number</label><input type="tel" id="ct-number" placeholder="+91…"></div>
        <div class="btn-row">
          <button type="button" class="btn secondary" id="ct-cancel">Cancel</button>
          <button type="button" class="btn" id="ct-save">Save</button>
        </div>
      </div>`;
    container.querySelector('#ct-cancel')?.addEventListener('click', () => { showAdd = false; renderContacts(); });
    container.querySelector('#ct-save')?.addEventListener('click', saveContact);
    return;
  }

  container.innerHTML = `
    ${entries.length ? `<div class="list-group">${entries.map(([name, number]) => `
      <div class="list-row" style="cursor:default">
        <div class="row-main">
          <div class="row-title">${escapeHtml(name)}</div>
          <div class="row-sub">${escapeHtml(number)}</div>
        </div>
        <button type="button" class="btn btn-sm danger" data-del="${escapeAttr(name)}">Delete</button>
      </div>`).join('')}</div>` : '<p class="empty">No contacts yet</p>'}
    <button type="button" class="fab" id="ct-fab">+</button>`;

  container.querySelector('#ct-fab')?.addEventListener('click', () => { showAdd = true; renderContacts(); });
  container.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Delete contact "${btn.dataset.del}"?`)) return;
      try {
        await api(`/contacts/${encodeURIComponent(btn.dataset.del)}`, { method: 'DELETE' });
        toast('Contact deleted', 'ok');
        window.dispatchEvent(new CustomEvent('sandesha:refresh'));
      } catch (err) {
        toast(err.message, 'err');
      }
    });
  });
}

async function saveContact() {
  const name = container.querySelector('#ct-name')?.value?.trim();
  const number = container.querySelector('#ct-number')?.value?.trim();
  if (!name || !number) { toast('Name and number required', 'err'); return; }
  try {
    await api('/contacts', { method: 'POST', body: JSON.stringify({ name, number }) });
    toast('Contact saved', 'ok');
    showAdd = false;
    window.dispatchEvent(new CustomEvent('sandesha:refresh'));
  } catch (err) {
    toast(err.message, 'err');
  }
}

export function openContacts() {
  pushSub('contacts', 'Contacts');
  showAdd = false;
  renderContacts();
}
