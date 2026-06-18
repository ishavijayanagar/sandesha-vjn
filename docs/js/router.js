const header = document.getElementById('app-header');
const headerTitle = document.getElementById('header-title');
const backBtn = document.getElementById('header-back');
const bottomNav = document.getElementById('bottom-nav');
const main = document.getElementById('app-main');

const TABS = ['home', 'send', 'schedule', 'groups', 'more'];
let currentTab = 'home';
const subStack = [];
let onTabChange = null;
let onSubPop = null;

export function initRouter({ onTab, onSubBack }) {
  onTabChange = onTab;
  onSubPop = onSubBack;

  bottomNav?.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => navigate(btn.dataset.tab));
  });

  backBtn?.addEventListener('click', popSub);
}

export function getCurrentTab() {
  return currentTab;
}

export function navigate(tab) {
  if (!TABS.includes(tab)) return;
  subStack.length = 0;
  currentTab = tab;
  updateUI();
  if (onTabChange) onTabChange(tab);
}

export function pushSub(id, title) {
  subStack.push({ id, title });
  updateUI();
}

export function popSub() {
  if (subStack.length === 0) return;
  subStack.pop();
  updateUI();
  if (onSubPop) onSubPop(subStack.length ? subStack[subStack.length - 1].id : null);
}

export function getSubPage() {
  return subStack.length ? subStack[subStack.length - 1].id : null;
}

export function isSubPage() {
  return subStack.length > 0;
}

function updateUI() {
  const inSub = subStack.length > 0;
  const sub = inSub ? subStack[subStack.length - 1] : null;

  if (headerTitle) {
    headerTitle.textContent = inSub ? sub.title : tabTitle(currentTab);
  }
  if (backBtn) backBtn.classList.toggle('hidden', !inSub);
  if (bottomNav) bottomNav.classList.toggle('hidden', inSub);

  bottomNav?.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.classList.toggle('active', !inSub && btn.dataset.tab === currentTab);
  });

  document.querySelectorAll('.page-panel').forEach((panel) => {
    const tab = panel.dataset.tab;
    panel.classList.toggle('active', !inSub && tab === currentTab);
  });

  document.querySelectorAll('.sub-page').forEach((page) => {
    page.classList.toggle('active', inSub && page.dataset.sub === sub?.id);
  });
}

function tabTitle(tab) {
  const titles = {
    home: 'Sandesha',
    send: 'Send',
    schedule: 'Schedule',
    groups: 'Groups',
    more: 'More',
  };
  return titles[tab] || 'Sandesha';
}

export function showPanelLoading(container, count = 3) {
  if (!container) return;
  container.innerHTML = Array(count).fill('<div class="skeleton"></div>').join('');
}
