import {
  api, confirmSheet, formatDuration, h, icons, initHostChrome, latestOnly, maskNum, msUntil,
  photoHTML, poll, setPartyName, showStatus, syncClock, syncList,
} from './common.js';

const $ = (id) => document.getElementById(id);
const PHASE_LABEL = { checkin: 'Check-in', voting: 'Voting open', final: 'Voting closed', winners: 'Winners out' };
const MAX_EDGE = 1200;

initHostChrome();

const latest = latestOnly();
let state = null;
let photoBlob = null;
let previewUrl = null;

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
      ${photoHTML(mask, { iconSize: 24 })}
      <div class="admin-card-foot">
        <span class="mono"></span>
        <button type="button" class="icon-btn" aria-label="Remove mask ${maskNum(mask.number)}">${icons.trash()}</button>
      </div>
    </article>`);
  el.querySelector('button').addEventListener('click', () => removeMask(mask));
  return el;
}

function updateTile(el, mask) {
  el.querySelector('.mono').textContent = mask.votes;
  el.querySelector('.mono').setAttribute('aria-label', `${mask.votes} votes`);
  el.querySelector('img').alt = `Mask ${maskNum(mask.number)}${mask.label ? `, ${mask.label}` : ''}`;
  el.title = mask.label || '';
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
    const added = next ? maskNum(next.next_mask_number - 1) : 'The mask';
    showStatus($('checkin-status'), `${added} is in the gallery.`);
    $('label').value = '';
    setPhoto(null);
  } catch (err) {
    showStatus($('checkin-status'), err.message, true);
    button.disabled = false;
  } finally {
    button.textContent = 'Add to gallery';
  }
});
