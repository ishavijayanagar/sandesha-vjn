import { escapeHtml, escapeAttr } from './api.js';

export function openTargetPicker(options, onSelect) {
  const overlay = document.createElement('div');
  overlay.className = 'sheet-overlay';
  overlay.innerHTML = `
    <div class="sheet" role="dialog">
      <div class="sheet-handle"></div>
      <h3 style="margin:0 0 12px">Choose target</h3>
      <input type="search" class="sheet-search" placeholder="Search sets, groups, contacts…" autofocus>
      <div class="sheet-list"></div>
    </div>`;

  const list = overlay.querySelector('.sheet-list');
  const search = overlay.querySelector('.sheet-search');

  function render(filter = '') {
    const q = filter.trim().toLowerCase();
    const filtered = q
      ? options.filter((o) => o.label.toLowerCase().includes(q) || (o.sub || '').toLowerCase().includes(q))
      : options;
    if (!filtered.length) {
      list.innerHTML = '<p class="empty">No matches</p>';
      return;
    }
    list.innerHTML = filtered.slice(0, 100).map((o) => `
      <div class="sheet-item" data-value="${escapeAttr(o.value)}" data-type="${escapeAttr(o.type)}">
        <div class="row-main">
          <div class="row-title">${escapeHtml(o.label)}</div>
          <div class="row-sub">${escapeHtml(o.type)} · ${escapeHtml(o.sub || '')}</div>
        </div>
      </div>`).join('');
    list.querySelectorAll('.sheet-item').forEach((el) => {
      el.addEventListener('click', () => {
        close();
        onSelect({ value: el.dataset.value, type: el.dataset.type, label: el.querySelector('.row-title')?.textContent });
      });
    });
  }

  function close() {
    overlay.remove();
  }

  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  search.addEventListener('input', () => render(search.value));
  render();
  document.body.appendChild(overlay);
  search.focus();
}
