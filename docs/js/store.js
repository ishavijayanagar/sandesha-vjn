import { api } from './api.js';

const state = {
  health: null,
  groups: [],
  sets: {},
  contacts: {},
  schedules: [],
  aiAvailable: false,
};

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  listeners.forEach((fn) => fn(state));
}

export function getState() {
  return state;
}

export async function refreshCore(forceGroups = false) {
  const [health, groups, setsData, contactsData, schedulesData] = await Promise.all([
    api('/health'),
    api(`/groups${forceGroups ? '?refresh=1' : ''}`),
    api('/sets'),
    api('/contacts'),
    api('/schedules'),
  ]);
  state.health = health;
  state.groups = (Array.isArray(groups) ? groups : []).sort((a, b) => a.name.localeCompare(b.name));
  state.sets = setsData.sets || setsData || {};
  state.contacts = contactsData.contacts || contactsData || {};
  state.schedules = schedulesData.schedules || schedulesData || [];
  notify();
  return state;
}

export async function refreshAiStatus() {
  try {
    const status = await api('/ai/status');
    state.aiAvailable = !!status.available;
  } catch {
    state.aiAvailable = false;
  }
  notify();
  return state.aiAvailable;
}

export async function saveSets(sets) {
  await api('/sets', { method: 'POST', body: JSON.stringify({ sets }) });
  state.sets = sets;
  notify();
}

export function jidToName(jid) {
  const g = state.groups.find((x) => x.jid === jid);
  return g?.name || jid;
}

export function getTargetOptions() {
  const options = [];
  Object.keys(state.sets).forEach((name) => {
    options.push({ type: 'set', label: name, value: name, sub: `${(state.sets[name] || []).length} groups` });
  });
  state.groups.forEach((g) => {
    options.push({ type: 'group', label: g.name, value: g.jid, sub: `${g.participants ?? '?'} members` });
  });
  Object.entries(state.contacts).forEach(([name, number]) => {
    options.push({ type: 'contact', label: name, value: name, sub: number });
  });
  options.push({ type: 'broadcast', label: 'All groups', value: '__broadcast__', sub: `${state.groups.length} groups` });
  return options;
}
