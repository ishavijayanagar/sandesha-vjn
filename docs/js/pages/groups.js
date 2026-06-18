import { api } from '../api.js';
import { getState } from '../store.js';
import { pushSub, popSub, getSubPage } from '../router.js';
import { escapeHtml } from '../api.js';
import { navigate } from '../router.js';
import { prefillTarget } from './send.js';

const container = document.getElementById('page-groups');
const detailContainer = document.getElementById('sub-group-detail');
let filter = 'all';
let searchQ = '';
let findQ = '';
let detailJid = null;

function badgeClass(status) {
  if (status === 'active') return 'active';
  if (status === 'week') return 'week';
  if (status === 'inactive') return 'inactive';
  return 'unknown';
}

export function renderGroups() {
  if (!container) return;
  const { groups } = getState();
  let list = groups;

  if (filter === 'active') list = list.filter((g) => g.status === 'active' || g.status === 'week');
  else if (filter === 'inactive') list = list.filter((g) => g.status === 'inactive' || (g.daysInactive || 0) >= 30);

  if (searchQ) {
    const q = searchQ.toLowerCase();
    list = list.filter((g) => g.name.toLowerCase().includes(q));
  }

  container.innerHTML = `
    <input type="search" id="groups-search" placeholder="Search groups…" value="${escapeHtml(searchQ)}" style="margin-bottom:12px">
    <div class="chip-row">
      <button type="button" class="chip ${filter === 'all' ? 'active' : ''}" data-f="all">All</button>
      <button type="button" class="chip ${filter === 'active' ? 'active' : ''}" data-f="active">Active</button>
      <button type="button" class="chip ${filter === 'inactive' ? 'active' : ''}" data-f="inactive">Inactive 30d+</button>
    </div>
    <div class="field" style="margin-top:12px">
      <label>Find member</label>
      <div style="display:flex;gap:8px">
        <input type="search" id="find-member" placeholder="Name across groups…" value="${escapeHtml(findQ)}">
        <button type="button" class="btn btn-sm secondary" id="find-btn">Find</button>
      </div>
      <div id="find-results"></div>
    </div>
    <div class="list-group" id="groups-list">
      ${list.length ? list.slice(0, 300).map((g) => `
        <div class="list-row" data-jid="${escapeHtml(g.jid)}" data-name="${escapeHtml(g.name)}">
          <div class="row-main">
            <div class="row-title">${escapeHtml(g.name)}</div>
            <div class="row-sub">${g.participants ?? '?'} members · ${escapeHtml(g.lastActive || 'Unknown')}</div>
          </div>
          <span class="badge ${badgeClass(g.status)}">${escapeHtml(g.status || '?')}</span>
          <span class="chevron">›</span>
        </div>`).join('') : '<p class="empty">No groups match</p>'}
    </div>`;

  container.querySelector('#groups-search')?.addEventListener('input', (e) => {
    searchQ = e.target.value;
    renderGroups();
  });
  container.querySelectorAll('[data-f]').forEach((chip) => {
    chip.addEventListener('click', () => { filter = chip.dataset.f; renderGroups(); });
  });
  container.querySelector('#find-btn')?.addEventListener('click', doFindMember);
  container.querySelector('#find-member')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doFindMember();
  });
  container.querySelectorAll('[data-jid]').forEach((row) => {
    row.addEventListener('click', () => openDetail(row.dataset.jid, row.dataset.name));
  });
}

async function doFindMember() {
  findQ = container.querySelector('#find-member')?.value || '';
  const resultsEl = container.querySelector('#find-results');
  if (!findQ.trim()) return;
  if (resultsEl) resultsEl.innerHTML = '<p class="hint">Searching…</p>';
  try {
    const data = await api(`/groups/find-member?q=${encodeURIComponent(findQ.trim())}`);
    const results = data.results || [];
    if (!results.length) {
      resultsEl.innerHTML = '<p class="hint">No members found</p>';
      return;
    }
    resultsEl.innerHTML = `<div class="list-group" style="margin-top:8px">${results.map((r) => `
      <div class="list-row" style="cursor:default">
        <div class="row-main">
          <div class="row-title">${escapeHtml(r.name)}</div>
          <div class="row-sub">${escapeHtml(r.group)}</div>
        </div>
      </div>`).join('')}</div>`;
  } catch (err) {
    if (resultsEl) resultsEl.innerHTML = `<p class="hint" style="color:var(--color-danger)">${escapeHtml(err.message)}</p>`;
  }
}

function openDetail(jid, name) {
  detailJid = jid;
  pushSub('group-detail', name || 'Group');
  renderGroupDetail();
}

export function renderGroupDetail() {
  if (!detailContainer || getSubPage() !== 'group-detail') return;
  detailContainer.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
  loadDetail();
}

async function loadDetail() {
  if (!detailJid || !detailContainer) return;
  try {
    const data = await api(`/groups/${encodeURIComponent(detailJid)}/members`);
    detailContainer.innerHTML = `
      <div class="card">
        <h2>${escapeHtml(data.group || 'Group')}</h2>
        <p class="hint">${data.total ?? data.members?.length ?? 0} members</p>
        <button type="button" class="btn" id="detail-send">Send to this group</button>
      </div>
      <div class="list-group">
        ${(data.members || []).map((m) => `
          <div class="list-row" style="cursor:default">
            <div class="row-main">
              <div class="row-title">${escapeHtml(m.name)}</div>
              <div class="row-sub">${escapeHtml(m.phone || '')}</div>
            </div>
          </div>`).join('') || '<p class="empty">No members loaded</p>'}
      </div>`;
    detailContainer.querySelector('#detail-send')?.addEventListener('click', () => {
      const g = getState().groups.find((x) => x.jid === detailJid);
      prefillTarget({ value: detailJid, type: 'group', label: g?.name || data.group });
      popSub();
      navigate('send');
    });
  } catch (err) {
    detailContainer.innerHTML = `<p class="empty">${escapeHtml(err.message)}</p>`;
  }
}

export function onSubBack(id) {
  if (id === 'group-detail') renderGroupDetail();
}
