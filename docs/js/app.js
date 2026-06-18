import { setUnauthorizedHandler, getApiBase } from './api.js';
import { tryRestoreSession, setLoginSuccessHandler, handleUnauthorized } from './auth.js';
import { initRouter, getCurrentTab, getSubPage } from './router.js';
import { refreshCore, refreshAiStatus, subscribe } from './store.js';
import { toast } from './toast.js';
import { renderHome } from './pages/home.js';
import { renderSend } from './pages/send.js';
import { renderSchedule } from './pages/schedule.js';
import { renderGroups, renderGroupDetail, onSubBack } from './pages/groups.js';
import { renderMore } from './pages/more.js';
import { renderSets } from './pages/sets.js';
import { renderContacts } from './pages/contacts.js';
import { renderBulk } from './pages/bulk.js';
import { renderAddMembers } from './pages/add-members.js';
import { renderAi } from './pages/ai.js';
import { renderSettings } from './pages/settings.js';
import { renderHelp } from './pages/help.js';

const offlineBanner = document.getElementById('offline-banner');

function renderTab(tab) {
  switch (tab) {
    case 'home': renderHome(); break;
    case 'send': renderSend(); break;
    case 'schedule': renderSchedule(); break;
    case 'groups': renderGroups(); break;
    case 'more': renderMore(); break;
    default: break;
  }
}

function renderSub(id) {
  switch (id) {
    case 'group-detail': renderGroupDetail(); break;
    case 'sets': renderSets(); break;
    case 'contacts': renderContacts(); break;
    case 'bulk': renderBulk(); break;
    case 'add-members': renderAddMembers(); break;
    case 'ai': renderAi(); break;
    case 'settings': renderSettings(); break;
    case 'help': renderHelp(); break;
    default: break;
  }
}

async function loadApp(forceGroups = false) {
  try {
    await refreshCore(forceGroups);
    await refreshAiStatus();
    offlineBanner?.classList.add('hidden');
    renderTab(getCurrentTab());
    const sub = getSubPage();
    if (sub) renderSub(sub);
  } catch (err) {
    offlineBanner?.classList.remove('hidden');
    toast(err.message || 'Failed to load', 'err');
  }
}

setUnauthorizedHandler(handleUnauthorized);
setLoginSuccessHandler(() => loadApp());

initRouter({
  onTab: (tab) => renderTab(tab),
  onSubBack: (id) => {
    if (id) renderSub(id);
    else onSubBack(id);
    if (!id) renderTab(getCurrentTab());
  },
});

subscribe(() => {
  renderTab(getCurrentTab());
  const sub = getSubPage();
  if (sub) renderSub(sub);
});

window.addEventListener('sandesha:refresh', () => loadApp(true));

async function checkHealth() {
  try {
    const r = await fetch(`${getApiBase()}/health`);
    if (r.ok) offlineBanner?.classList.add('hidden');
    else offlineBanner?.classList.remove('hidden');
  } catch {
    offlineBanner?.classList.remove('hidden');
  }
}

setInterval(checkHealth, 60000);

tryRestoreSession();
