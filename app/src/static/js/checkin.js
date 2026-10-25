import {
  api, confirmSheet, esc, formatDuration, h, icons, initHostChrome, latestOnly, maskNum, msUntil,
  openSheet, photoHTML, poll, setPartyName, showStatus, syncClock, syncList,
} from './common.js';

const $ = (id) => document.getElementById(id);
const PHASE_LABEL = { checkin: 'Check-in', voting: 'Voting open', final: 'Voting closed', winners: 'Winners out' };
const MAX_EDGE = 1200;

initHostChrome();

const latest = latestOnly();
let state = null;
let photoBlob = null;
let previewUrl = null;
// Refreshes the open ticket sheet, so it flips to "scanned" when the guest scans
let syncTicketSheet = null;

async function load(request) {
  const next = await latest(request);
  if (next) {
    state = next;
    render();
  }
  return next;
}

const refresh = poll(() => load(api('GET', '/api/admin/state')));

function render() {
  syncClock(state.server_now);
  setPartyName(state.party_name);

  $('phase-text').textContent = PHASE_LABEL[state.phase];
  $('phase-dot').classList.toggle('is-idle', state.phase !== 'voting');
  tickTimer();
  $('mask-count').textContent = state.masks.length;
  $('voter-count').textContent = state.voters_count;
  $('next-number').textContent = maskNum(state.next_mask_number);

  $('gallery-empty').hidden = state.masks.length > 0;
  syncList($('gallery'), state.masks, (m) => m.id, createTile, updateTile);
  syncTicketSheet?.();
}

function tickTimer() {
  if (!state) return;
  const ms = state.phase === 'voting' ? msUntil(state.voting_closes_at) : null;
  $('time-left').textContent = ms === null ? '—' : formatDuration(ms);
  if (ms === 0) refresh();
}
setInterval(tickTimer, 1000);

// ---- gallery -----------------------------------------------------------

function createTile(mask) {
  const el = h(`
    <article class="admin-card">
      <button type="button" class="tile-photo">${photoHTML(mask, { iconSize: 24, tag: 'span' })}</button>
      <div class="admin-card-foot">
        <span class="mono"></span>
        <button type="button" class="icon-btn" aria-label="Remove mask ${maskNum(mask.number)}">${icons.trash()}</button>
      </div>
    </article>`);
  el.querySelector('.photo').insertAdjacentHTML('beforeend', '<span class="ticket-badge" aria-hidden="true"></span>');
  el.querySelector('.tile-photo').addEventListener('click', () => showTicket(mask.id));
  el.querySelector('.icon-btn').addEventListener('click', () => removeMask(mask));
  return el;
}

function updateTile(el, mask) {
  const num = maskNum(mask.number);
  el.querySelector('.mono').textContent = mask.votes;
  el.querySelector('.mono').setAttribute('aria-label', `${mask.votes} votes`);
  el.querySelector('img').alt = `Mask ${num}${mask.label ? `, ${mask.label}` : ''}`;
  el.title = mask.label || '';

  const badge = el.querySelector('.ticket-badge');
  badge.classList.toggle('is-claimed', mask.ticket_claimed);
  badge.innerHTML = mask.ticket_claimed ? icons.check(14) : icons.qr(14);
  el.querySelector('.tile-photo').setAttribute(
    'aria-label',
    `Voting QR for mask ${num}, ${mask.ticket_claimed ? 'scanned' : 'not scanned yet'}`,
  );
}

// ---- tickets -----------------------------------------------------------

const ticketLink = (mask) => `${location.origin}/?ticket=${encodeURIComponent(mask.ticket)}`;

function ticketBodyHTML(mask) {
  if (mask.ticket_claimed) {
    return `
      <div class="sheet-body">
        <p>This ticket is already on the guest's phone.</p>
        <p>If they lost it or switched phones, issue a new code. The old phone stops voting and their votes carry over.</p>
      </div>
      <p class="qr-state is-claimed">${icons.check(14)} Scanned</p>
      <p class="status is-error" data-role="error" hidden></p>
      <div class="btn-stack">
        <button type="button" class="btn btn-primary" data-action="reissue">Issue new code</button>
        <button type="button" class="btn" data-close="done" data-autofocus>Close</button>
      </div>`;
  }
  return `
    <div class="sheet-body">
      <p>Ask the guest to scan this with their phone camera. It works on one phone only.</p>
    </div>
    <div class="qr">
      <img src="/api/admin/masks/${mask.id}/qr.svg?v=${encodeURIComponent(mask.ticket)}" alt="Voting QR code for mask ${maskNum(mask.number)}">
      <span class="qr-state">Waiting for the guest to scan</span>
    </div>
    <div class="btn-stack">
      <button type="button" class="btn" data-action="copy">Copy link</button>
      <button type="button" class="btn btn-primary" data-close="done" data-autofocus>Done</button>
    </div>`;
}

function showTicket(maskId) {
  const mask = state.masks.find((m) => m.id === maskId);
  if (!mask) return;

  const content = h(`<div class="ticket-body"><h2>Ticket for ${esc(maskNum(mask.number))}</h2><div class="ticket-body"></div></div>`);
  const body = content.lastElementChild;
  let shown = null;

  syncTicketSheet = () => {
    const current = state.masks.find((m) => m.id === maskId);
    if (!current) return;
    const key = `${current.ticket}:${current.ticket_claimed}`;
    if (key === shown) return;

    // Keep the id the dialog's aria-describedby points at
    const bodyId = body.querySelector('.sheet-body')?.id;
    body.innerHTML = ticketBodyHTML(current);
    if (bodyId) body.querySelector('.sheet-body').id = bodyId;
    // The re-render dropped the focused button; openSheet handles the first focus
    if (shown !== null) body.querySelector('[data-autofocus]')?.focus();
    shown = key;
  };
  syncTicketSheet();

  body.addEventListener('click', async (e) => {
    const button = e.target.closest('[data-action]');
    if (!button) return;
    const current = state.masks.find((m) => m.id === maskId);

    if (button.dataset.action === 'copy') {
      try {
        await navigator.clipboard.writeText(ticketLink(current));
        button.textContent = 'Link copied';
      } catch {
        window.prompt('Copy this link', ticketLink(current));
      }
    } else if (button.dataset.action === 'reissue') {
      button.disabled = true;
      try {
        await load(api('POST', `/api/admin/masks/${maskId}/ticket`));
      } catch (err) {
        showStatus(body.querySelector('[data-role="error"]'), err.message, true);
        button.disabled = false;
      }
    }
  });

  openSheet(content).then(() => { syncTicketSheet = null; });
}

async function removeMask(mask) {
  const num = maskNum(mask.number);
  const ok = await confirmSheet({
    title: `Remove mask ${num}?`,
    body: ['Its photo and every vote for it are deleted. This can\'t be undone.'],
    confirm: 'Yes, remove it',
  });
  if (!ok) return;

  try {
    await load(api('DELETE', `/api/admin/masks/${mask.id}`));
    showStatus($('gallery-status'), `Removed ${num}.`);
  } catch (e) {
    showStatus($('gallery-status'), e.message, true);
  }
}

// ---- check-in ----------------------------------------------------------

async function compress(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) throw new Error('Could not process the photo');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function setPhoto(blob) {
  photoBlob = blob;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = blob ? URL.createObjectURL(blob) : null;

  const preview = $('capture-preview');
  preview.hidden = !blob;
  if (blob) preview.src = previewUrl;
  else preview.removeAttribute('src');
  $('capture-retake').hidden = !blob;
  $('capture-btn').setAttribute('aria-label', blob ? 'Retake photo' : 'Take photo');
  $('add-btn').disabled = !blob;
}

$('capture-btn').addEventListener('click', () => $('photo-input').click());

$('photo-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  showStatus($('checkin-status'), '');
  try {
    setPhoto(await compress(file));
  } catch {
    // Let the server judge a format the browser can't draw
    setPhoto(file);
  }
});

$('checkin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!photoBlob) return;

  const button = $('add-btn');
  button.disabled = true;
  button.textContent = 'Adding…';
  const body = new FormData();
  body.append('photo', photoBlob, 'mask.jpg');
  body.append('label', $('label').value.trim());

  try {
    const next = await load(api('POST', '/api/admin/masks', body));
    const added = next?.masks.find((m) => m.number === next.next_mask_number - 1);
    showStatus($('checkin-status'), `${added ? maskNum(added.number) : 'The mask'} is in the gallery.`);
    $('label').value = '';
    setPhoto(null);
    if (added) showTicket(added.id);
  } catch (err) {
    showStatus($('checkin-status'), err.message, true);
    button.disabled = false;
  } finally {
    button.textContent = 'Add to gallery';
  }
});
