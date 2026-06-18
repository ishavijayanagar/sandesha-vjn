const container = document.getElementById('toast-container');

export function toast(msg, type = 'info', duration = 3000) {
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast${type === 'ok' ? ' ok' : ''}${type === 'err' ? ' err' : ''}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.2s';
    setTimeout(() => el.remove(), 200);
  }, duration);
}
