// Modal / toast / confirm primitives.
import { esc } from './util.js';
import { emit } from './store.js';

let toastTimer = null;

export function toast(msg, ms = 2200) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

let onClose = null;

export function closeModal() {
  const root = document.getElementById('modalRoot');
  root.hidden = true;
  root.innerHTML = '';
  const cb = onClose; onClose = null;
  if (cb) cb();
  // A modal submit may have changed the tab or the data; repaint the view behind it.
  emit();
}

/**
 * openModal({ title, bodyHtml, okText, cancelText, onSubmit, danger })
 * onSubmit(values, modalEl) -> falsy keeps the modal open (so you can validate).
 * Values are read from every [name] input inside the modal.
 */
export function openModal({
  title, bodyHtml, okText = 'Save', cancelText = 'Cancel',
  onSubmit = null, danger = false, wide = false,
}) {
  const root = document.getElementById('modalRoot');
  root.hidden = false;
  root.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <h3>${esc(title)}</h3>
      <form id="modalForm" novalidate>
        <div class="modal-body">${bodyHtml}</div>
        <div class="modal-foot">
          <button type="button" class="btn ghost" data-mclose>${esc(cancelText)}</button>
          ${onSubmit ? `<button type="submit" class="btn ${danger ? 'danger' : 'primary'}">${esc(okText)}</button>` : ''}
        </div>
      </form>
    </div>`;
  const modal = root.querySelector('.modal');
  if (wide) modal.style.maxWidth = '720px';

  root.querySelector('[data-mclose]').onclick = closeModal;
  root.onclick = (e) => { if (e.target === root) closeModal(); };

  const form = root.querySelector('#modalForm');
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!onSubmit) return closeModal();
    const values = {};
    form.querySelectorAll('[name]').forEach((f) => {
      values[f.name] = f.type === 'checkbox' ? f.checked : f.value;
    });
    const ok = await onSubmit(values, modal);
    if (ok !== false) closeModal();
  };

  const first = form.querySelector('input,select,textarea');
  if (first && !first.dataset.nofocus) setTimeout(() => first.focus(), 60);
  return modal;
}

export function confirmDialog(message, { okText = 'Delete', danger = true, title = 'Are you sure?' } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    onClose = () => { if (!settled) { settled = true; resolve(false); } };
    openModal({
      title,
      bodyHtml: `<p class="muted" style="margin:0 0 4px">${esc(message)}</p>`,
      okText,
      danger,
      onSubmit: () => { settled = true; resolve(true); return true; },
    });
  });
}
