import {
  api, esc, frag, initHostChrome, maskNum, openSheet, podiumHTML, poll, setPartyName, showStatus, syncClock,
} from './common.js';

const $ = (id) => document.getElementById(id);
const PLACE_LABEL = ['1st place', '2nd place', '3rd place'];
const fieldsets = [...document.querySelectorAll('.podium-field')];
const part = (fs, role) => fs.querySelector(`[data-role="${role}"]`);

initHostChrome();

let state = null;
let optionsFor = null;
let prefilled = false;

poll(async () => {
  state = await api('GET', '/api/admin/state');
  render();
});

function render() {
  syncClock(state.server_now);
  setPartyName(state.party_name);

  const ready = state.phase === 'final' || state.phase === 'winners';
  $('not-ready').hidden = ready;
  $('winners-form').hidden = !ready;
  if (!ready) return;

  // Rebuilt only when the finalists change, so polling never clobbers a pick
  const signature = state.finalists.map((m) => `${m.id}:${m.votes}`).join(',');
  if (signature !== optionsFor) {
    buildOptions();
    optionsFor = signature;
  }
  if (!prefilled) {
    prefill();
    prefilled = true;
  }
  syncChoices();
}

function buildOptions() {
  for (const fs of fieldsets) {
    const select = part(fs, 'mask');
    const value = select.value;
    select.innerHTML = '<option value="">Choose a finalist</option>' + state.finalists.map((m) => {
      const label = m.label ? ` · ${esc(m.label)}` : '';
      return `<option value="${m.id}">${maskNum(m.number)}${label} · ${m.votes} vote${m.votes === 1 ? '' : 's'}</option>`;
    }).join('');
    select.value = state.finalists.some((m) => String(m.id) === value) ? value : '';
  }
}

function prefill() {
  for (const w of state.winners) {
    const fs = fieldsets[w.place - 1];
    part(fs, 'mask').value = String(w.mask.id);
    part(fs, 'name').value = w.name;
    part(fs, 'title').value = w.costume_title || '';
  }
}

const findFinalist = (id) => state.finalists.find((m) => String(m.id) === id);

// Each mask can win one place: picking it in one select disables it in the others
function syncChoices() {
  const chosen = fieldsets.map((fs) => part(fs, 'mask').value);
  fieldsets.forEach((fs, i) => {
    for (const option of part(fs, 'mask').options) {
      option.disabled = option.value !== '' && chosen.some((v, j) => j !== i && v === option.value);
    }
    const mask = findFinalist(chosen[i]);
    fs.querySelector('.podium-thumb').innerHTML = mask
      ? `<img src="${esc(mask.photo_url)}" alt="Mask ${maskNum(mask.number)}">`
      : '';
  });
}

fieldsets.forEach((fs) => part(fs, 'mask').addEventListener('change', syncChoices));

function collect() {
  const winners = [];
  for (const [i, fs] of fieldsets.entries()) {
    const maskId = part(fs, 'mask').value;
    const name = part(fs, 'name').value.trim();
    const title = part(fs, 'title').value.trim();
    const label = PLACE_LABEL[i];

    if (!maskId && !name && !title) {
      if (i === 0) return { error: '1st place needs a mask and a name.' };
      continue;
    }
    if (!maskId) return { error: `Pick a mask for ${label}.` };
    if (!name) return { error: `Add the winner's name for ${label}.` };
    winners.push({ place: i + 1, mask_id: Number(maskId), name, costume_title: title || null });
  }
  return { winners };
}

$('winners-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { winners, error } = collect();
  if (error) {
    showStatus($('winners-status'), error, true);
    return;
  }

  $('publish-btn').disabled = true;
  try {
    state = await api('PUT', '/api/admin/winners', { winners });
    render();
    showStatus($('winners-status'), 'Winners published. Every guest now sees the podium.');
  } catch (err) {
    showStatus($('winners-status'), err.message, true);
  } finally {
    $('publish-btn').disabled = false;
  }
});

$('preview-btn').addEventListener('click', () => {
  const { winners, error } = collect();
  if (error) {
    showStatus($('winners-status'), error, true);
    return;
  }
  showStatus($('winners-status'), '');

  const podium = winners.map((w) => ({ ...w, mask: findFinalist(String(w.mask_id)) }));
  openSheet(frag(`
    <h2>Podium preview</h2>
    <div class="podium">${podiumHTML(podium)}</div>
    <div class="btn-stack">
      <button type="button" class="btn" data-close="close" data-autofocus>Close preview</button>
    </div>`));
});
