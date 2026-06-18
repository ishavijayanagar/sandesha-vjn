import { getState, saveSets, jidToName } from '../store.js';
import { toast } from '../toast.js';
import { escapeHtml, escapeAttr } from '../api.js';
import { pushSub } from '../router.js';

const container = document.getElementById('sub-sets');
let selectedJids = new Set();
let setName = '';

export function renderSets() {
  if (!container) return;
  const { sets, groups } = getState();
  const keys = Object.keys(sets);

  container.innerHTML = `
    ${keys.length ? keys.map((name) => {
      const jids = sets[name] || [];
      return `
        <div class="card">
          <h3>${escapeHtml(name)} <span style="color:var(--color-text-muted);font-weight:400">(${jids.length})</span></h3>
          <ul style="margin:0;padding-left:20px;font-size:0.875rem;color:var(--color-text-muted)">
            ${jids.slice(0, 8).map((j) => `<li>${escapeHtml(jidToName(j))}</li>`).join('')}
            ${jids.length > 8 ? `<li>…and ${jids.length - 8} more</li>` : ''}
          </ul>
          <button type="button" class="btn btn-sm danger" style="margin-top:12px" data-del="${escapeAttr(name)}">Delete set</button>
        </div>`;
    }).join('') : '<p class="empty">No sets yet. Create one below.</p>'}

    <div class="card">
      <h2>Add or update set</h2>
      <div class="field">
        <label>Set name</label>
        <input type="text" id="set-name" placeholder="e.g. family" value="${escapeAttr(setName)}">
      </div>
      <input type="search" id="set-group-search" placeholder="Search groups…" style="margin-bottom:8px">
      <div class="btn-row" style="margin-bottom:8px">
        <button type="button" class="btn btn-sm secondary" id="set-select-all">Select shown</button>
        <button type="button" class="btn btn-sm secondary" id="set-clear">Clear</button>
      </div>
      <div class="list-group" id="set-group-list"></div>
      <button type="button" class="btn" id="set-save" style="margin-top:12px" disabled>Save set</button>
    </div>`;

  renderGroupPicker('');
  container.querySelector('#set-name')?.addEventListener('input', (e) => {
    setName = e.target.value;
    updateSaveBtn();
  });
  container.querySelector('#set-group-search')?.addEventListener('input', (e) => {
    renderGroupPicker(e.target.value);
  });
  container.querySelector('#set-select-all')?.addEventListener('click', () => {
    container.querySelectorAll('#set-group-list input').forEach((cb) => {
      cb.checked = true;
      selectedJids.add(cb.value);
    });
    updateSaveBtn();
  });
  container.querySelector('#set-clear')?.addEventListener('click', () => {
    selectedJids.clear();
    renderGroupPicker(container.querySelector('#set-group-search')?.value || '');
    updateSaveBtn();
  });
  container.querySelector('#set-save')?.addEventListener('click', saveSet);
  container.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.del;
      if (!confirm(`Delete set "${name}"?`)) return;
      const next = { ...getState().sets };
      delete next[name];
      await saveSets(next);
      toast('Set deleted', 'ok');
      renderSets();
    });
  });
}

function renderGroupPicker(filter) {
  const list = document.getElementById('set-group-list');
  if (!list) return;
  const q = filter.trim().toLowerCase();
  const groups = getState().groups.filter((g) => !q || g.name.toLowerCase().includes(q)).slice(0, 200);
  list.innerHTML = groups.map((g) => `
    <label class="group-check">
      <input type="checkbox" value="${escapeAttr(g.jid)}" ${selectedJids.has(g.jid) ? 'checked' : ''}>
      <span>${escapeHtml(g.name)}</span>
    </label>`).join('');
  list.querySelectorAll('input').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) selectedJids.add(cb.value);
      else selectedJids.delete(cb.value);
      updateSaveBtn();
    });
  });
}

function updateSaveBtn() {
  const btn = document.getElementById('set-save');
  if (btn) btn.disabled = !setName.trim() || selectedJids.size === 0;
}

async function saveSet() {
  const name = setName.trim().toLowerCase().replace(/\s+/g, '_');
  if (!name || !/^[a-z0-9_]+$/.test(name)) {
    toast('Set name: letters, numbers, underscores only', 'err');
    return;
  }
  const next = { ...getState().sets };
  const existing = new Set(next[name] || []);
  selectedJids.forEach((j) => existing.add(j));
  next[name] = [...existing];
  await saveSets(next);
  toast(`Saved set "${name}"`, 'ok');
  setName = '';
  selectedJids.clear();
  renderSets();
}

export function openSets() {
  pushSub('sets', 'Sets');
  renderSets();
}
