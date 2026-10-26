// Tiny DOM helpers — no framework needed for a handful of controls.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sv === undefined || sv === null) continue;
        if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function icon(svg, cls = 'ico') {
  const s = h('span', { class: cls, 'aria-hidden': 'true', html: svg });
  return s;
}

export function button({ label, icon: ic, title, onClick, cls = '', kbd }) {
  return h('button', { class: `btn ${cls}`, type: 'button', title: title || label, onclick: onClick },
    ic ? icon(ic) : null, label ? h('span', { class: 'lbl' }, label) : null, kbd ? h('kbd', {}, kbd) : null);
}

/** Segmented control. options: [{ value, label, icon, title }] */
export function segmented(options, value, onChange, cls = '') {
  const wrap = h('div', { class: `seg ${cls}`, role: 'radiogroup' });
  const btns = options.map((o) => {
    const b = h('button', { type: 'button', role: 'radio', title: o.title || o.label, 'data-value': o.value,
      onclick: () => { set(o.value); onChange(o.value); } },
    o.icon ? icon(o.icon) : null, o.label ? h('span', { class: 'lbl' }, o.label) : null);
    return b;
  });
  wrap.append(...btns);
  function set(v) {
    btns.forEach((b) => {
      const on = b.dataset.value === String(v);
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on);
    });
  }
  set(value);
  wrap.set = set;
  return wrap;
}

export function slider({ label, min, max, step, value, onInput, format = (v) => v, cls = '' }) {
  const out = h('output', {}, format(value));
  const input = h('input', { type: 'range', min, max, step, value });
  const fill = () => input.style.setProperty('--p', `${((input.value - min) / (max - min)) * 100}%`);
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    out.textContent = format(v);
    fill();
    onInput(v);
  });
  fill();
  const el = h('label', { class: `slider ${cls}` }, h('span', { class: 'slider-head' }, h('span', {}, label), out), input);
  el.set = (v) => { input.value = v; out.textContent = format(v); fill(); };
  return el;
}

/**
 * A button that toggles a floating panel above it. The panel lives at the #ui root
 * so the dock's blur/overflow can't clip it.
 */
export function popover(trigger, content, { onOpen } = {}) {
  const pop = h('div', { class: 'popover glass', role: 'dialog' }, content);
  const wrap = h('div', { class: 'pop-wrap' }, trigger);
  (document.getElementById('ui') || document.body).append(pop);
  const place = () => {
    const r = trigger.getBoundingClientRect();
    const w = pop.offsetWidth || 280;
    pop.style.left = `${Math.max(12, Math.min(innerWidth - w - 12, r.left + r.width / 2 - w / 2))}px`;
    pop.style.bottom = `${innerHeight - r.top + 12}px`;
  };
  const outside = (e) => { if (!wrap.contains(e.target) && !pop.contains(e.target)) close(); };
  function close() {
    wrap.classList.remove('open');
    pop.classList.remove('open');
    document.removeEventListener('pointerdown', outside, true);
  }
  trigger.addEventListener('click', () => {
    const open = !pop.classList.contains('open');
    document.querySelectorAll('.popover.open').forEach((p) => p !== pop && p.close?.());
    if (!open) return close();
    wrap.classList.add('open');
    pop.classList.add('open');
    onOpen?.();
    place();
    setTimeout(() => document.addEventListener('pointerdown', outside, true));
  });
  pop.close = close;
  wrap.close = close;
  // the wrap is rebuilt with the dock; take the panel with it
  new MutationObserver(() => { if (!wrap.isConnected) { close(); pop.remove(); } })
    .observe(document.getElementById('dock') || document.body, { childList: true, subtree: true });
  return wrap;
}

let toastTimer;
export function toast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
