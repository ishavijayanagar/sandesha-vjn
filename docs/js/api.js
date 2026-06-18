const DEFAULT_API = 'http://127.0.0.1:42620';
const TOKEN_KEY = 'sandesha_token';

const configApi = (typeof window !== 'undefined' && window.SANDESHA_CONFIG?.apiUrl) || null;

let apiBase = localStorage.getItem('sandesha_api') || configApi || DEFAULT_API;
let onUnauthorized = null;

export function getApiBase() {
  return apiBase;
}

export function setApiBase(url) {
  apiBase = (url || DEFAULT_API).replace(/\/$/, '');
  localStorage.setItem('sandesha_api', apiBase);
}

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(value) {
  if (value) sessionStorage.setItem(TOKEN_KEY, value);
  else sessionStorage.removeItem(TOKEN_KEY);
}

export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

export async function api(path, options = {}) {
  const url = `${apiBase}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = { ...(options.headers || {}) };
  const isForm = options.body instanceof FormData;
  if (!isForm && options.body && typeof options.body !== 'string') {
    headers['Content-Type'] = 'application/json';
  } else if (!isForm && options.method && options.method !== 'GET') {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;

  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text || res.statusText }; }

  if (res.status === 401) {
    setToken('');
    if (onUnauthorized) onUnauthorized();
    throw new Error(data.error || 'Unauthorized');
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function uploadFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  return api('/upload', { method: 'POST', body: fd });
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escapeAttr(s) {
  return escapeHtml(s);
}
