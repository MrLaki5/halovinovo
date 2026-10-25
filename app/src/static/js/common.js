const svg = (size, body, width = 2) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  camera: (size = 24, width = 1.5) => svg(size, '<path d="M4 8h3l2-3h6l2 3h3v11H4z"></path><circle cx="12" cy="13" r="3.5"></circle>', width),
  check: (size = 16) => svg(size, '<path d="M5 12.5l4.5 4.5L19 7.5"></path>', 3),
  trophy: (size = 20) => svg(size, '<path d="M8 4h8v5a4 4 0 0 1-8 0z"></path><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9 20h6"></path>'),
  trash: (size = 17) => svg(size, '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"></path>'),
  warning: (size = 24) => svg(size, '<path d="M12 3l10 18H2z"></path><path d="M12 10v5M12 18h.01"></path>'),
};

export const pad2 = (n) => String(n).padStart(2, '0');
export const maskNum = (n) => '#' + pad2(n);

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function frag(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content;
}

export const h = (html) => frag(html).firstElementChild;

// ---- API -------------------------------------------------------------------

function errorMessage(data) {
  const detail = data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail[0]?.msg) return detail[0].msg.replace(/^Value error, /, '');
  return null;
}

export async function api(method, path, body) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(path, opts);
  if (res.status === 401 && path.startsWith('/api/admin/') && path !== '/api/admin/login') {
    location.href = '/admin/login';
    throw new Error('Signed out');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(errorMessage(data) || `Something went wrong (${res.status})`);
  return data;
}

// Drops a response that arrives after a newer one, so a slow poll can't undo a vote
export function latestOnly() {
  let issued = 0;
  let applied = 0;
  return async (promise) => {
    const id = ++issued;
    const value = await promise;
    if (id < applied) return null;
    applied = id;
    return value;
  };
}

export function poll(fn, ms = 3000) {
  let timer = null;
  let running = false;
  async function tick() {
    clearTimeout(timer);
    if (running) return;
    running = true;
    try {
      await fn();
    } catch (e) {
      console.warn(e);
    } finally {
      running = false;
    }
    if (!document.hidden) timer = setTimeout(tick, ms);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  tick();
  return tick;
}

// ---- clock -----------------------------------------------------------------

// Phone clocks drift, so countdowns run on the server's clock
let clockOffset = 0;
export function syncClock(serverNow) { clockOffset = Date.parse(serverNow) - Date.now(); }
export const serverNow = () => Date.now() + clockOffset;

export function msUntil(iso) {
  return iso ? Math.max(0, Date.parse(iso) - serverNow()) : null;
}

export function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
}

// ---- page chrome -----------------------------------------------------------

export function setPartyName(name) {
  document.querySelectorAll('[data-party-name]').forEach((el) => { el.textContent = name; });
  const page = document.body.dataset.page;
  document.title = page ? `${page} · ${name}` : name;
}

export function initHostChrome() {
  document.querySelector('[data-logout]')?.addEventListener('click', async () => {
    await api('POST', '/api/admin/logout').catch(() => {});
    location.href = '/admin/login';
  });
}

export function showStatus(el, message, isError = false) {
  el.textContent = message;
  el.classList.toggle('is-error', isError);
  el.setAttribute('role', isError ? 'alert' : 'status');
  el.hidden = !message;
}

// ---- rendering -------------------------------------------------------------

// Keyed update: reuses each item's element, so photos don't reload on every poll
export function syncList(container, items, key, create, update) {
  const keyed = container._keyed || (container._keyed = new Map());
  const seen = new Set();
  items.forEach((item, i) => {
    const k = key(item);
    seen.add(k);
    let el = keyed.get(k);
    if (!el) {
      el = create(item);
      keyed.set(k, el);
    }
    update(el, item, i);
    if (container.children[i] !== el) container.insertBefore(el, container.children[i] || null);
  });
  for (const [k, el] of keyed) {
    if (!seen.has(k)) {
      el.remove();
      keyed.delete(k);
    }
  }
}

export function photoHTML(mask, { iconSize = 36, badge = true } = {}) {
  const num = maskNum(mask.number);
  return `<div class="photo ph">${icons.camera(iconSize)}<img src="${esc(mask.photo_url)}" alt="Mask ${num}" loading="lazy" decoding="async">${badge ? `<span class="num-badge">${num}</span>` : ''}</div>`;
}

export function podiumHTML(winners) {
  const byPlace = Object.fromEntries(winners.map((w) => [w.place, w]));
  const first = byPlace[1];
  const runnerUp = (w, cls, label) => (w ? `
    <article class="podium-card ${cls}">
      ${photoHTML(w.mask, { iconSize: 32 })}
      <div class="podium-card-body">
        <span class="podium-card-place">${label}</span>
        <span class="podium-card-name">${esc(w.name)}</span>
        ${w.costume_title ? `<span class="podium-card-title">${esc(w.costume_title)}</span>` : ''}
      </div>
    </article>` : '');

  return `
    ${first ? `
    <article class="podium-first">
      ${photoHTML(first.mask, { iconSize: 48 })}
      <div class="podium-first-footer">
        <span class="podium-place">${icons.trophy()} 1st place</span>
        <span class="podium-first-name">${esc(first.name)}</span>
        ${first.costume_title ? `<span class="podium-first-title">${esc(first.costume_title)}</span>` : ''}
      </div>
    </article>` : ''}
    ${byPlace[2] || byPlace[3] ? `
    <div class="podium-pair">
      ${runnerUp(byPlace[2], 'is-second', '2nd place')}
      ${runnerUp(byPlace[3], 'is-third', '3rd place')}
    </div>` : ''}`;
}

// ---- sheets ----------------------------------------------------------------

let sheetIds = 0;

// Bottom sheet with a focus trap. Resolves with the clicked [data-close] value, or null.
export function openSheet(content, { role = 'dialog', danger = false } = {}) {
  return new Promise((resolve) => {
    const opener = document.activeElement;
    const backdrop = h(`<div class="sheet-backdrop"><div class="sheet${danger ? ' is-danger' : ''}" role="${role}" aria-modal="true"><span class="sheet-grip" aria-hidden="true"></span></div></div>`);
    const sheet = backdrop.firstElementChild;
    sheet.append(content);

    const id = `sheet-${++sheetIds}`;
    const heading = sheet.querySelector('h2');
    if (heading) {
      heading.id = `${id}-title`;
      sheet.setAttribute('aria-labelledby', heading.id);
    }
    const body = sheet.querySelector('.sheet-body');
    if (body) {
      body.id = `${id}-body`;
      sheet.setAttribute('aria-describedby', body.id);
    }

    const focusables = () => [...sheet.querySelectorAll('button, a[href], input, select, textarea')].filter((el) => !el.disabled);
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(null);
      } else if (e.key === 'Tab') {
        const items = focusables();
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    function close(value) {
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      document.body.style.overflow = '';
      opener?.focus?.();
      resolve(value);
    }

    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(null); });
    sheet.addEventListener('click', (e) => {
      const button = e.target.closest('[data-close]');
      if (button) close(button.dataset.close);
    });
    document.addEventListener('keydown', onKey, true);
    document.body.append(backdrop);
    document.body.style.overflow = 'hidden';
    (sheet.querySelector('[data-autofocus]') || focusables()[0])?.focus();
  });
}

export async function confirmSheet({ title, body = [], confirm, danger = true }) {
  const result = await openSheet(frag(`
    ${danger ? `<span class="sheet-icon">${icons.warning()}</span>` : ''}
    <h2>${esc(title)}</h2>
    <div class="sheet-body">${body.map((p) => `<p>${esc(p)}</p>`).join('')}</div>
    <div class="btn-stack">
      <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-close="yes">${esc(confirm)}</button>
      <button type="button" class="btn" data-close="no" data-autofocus>Cancel</button>
    </div>`), { role: 'alertdialog', danger });
  return result === 'yes';
}
