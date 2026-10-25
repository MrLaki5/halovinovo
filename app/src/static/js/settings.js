import {
  api, confirmSheet, initHostChrome, latestOnly, pad2, poll, setPartyName, showStatus, syncClock,
} from './common.js';

const $ = (id) => document.getElementById(id);
const PHASES = ['checkin', 'voting', 'final', 'winners'];

initHostChrome();

const latest = latestOnly();
let state = null;
let formFilled = false;

async function load(request, { fillForm = false } = {}) {
  const next = await latest(request);
  if (next) {
    state = next;
    render();
    if (fillForm || !formFilled) fill();
  }
  return next;
}

// Polling only refreshes the stepper and buttons, never fields the host may be editing
poll(() => load(api('GET', '/api/admin/state')));

function toLocalInput(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function render() {
  syncClock(state.server_now);
  setPartyName(state.party_name);

  const current = PHASES.indexOf(state.phase);
  $('stepper').querySelectorAll('.step').forEach((step, i) => {
    if (i === current) step.setAttribute('aria-current', 'step');
    else step.removeAttribute('aria-current');
    step.querySelector('.step-num').textContent = pad2(i + 1) + (i < current ? ' ✓' : i === current ? ' now' : '');
  });
  $('end-btn').disabled = state.phase !== 'voting';
}

function fill() {
  formFilled = true;
  $('party-name').value = state.party_name;
  $('closes-at').value = state.voting_closes_at ? toLocalInput(state.voting_closes_at) : '';
  $('finalists').value = state.finalist_count;
  $('votes').value = state.votes_per_guest;
  $('counts').checked = state.show_vote_counts;
}

$('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  const closesAt = $('closes-at').value;
  const wasVoting = state?.phase === 'voting';
  $('save-btn').disabled = true;
  try {
    const next = await load(api('PUT', '/api/admin/settings', {
      party_name: $('party-name').value.trim(),
      voting_closes_at: closesAt ? new Date(closesAt).toISOString() : null,
      finalist_count: Number($('finalists').value),
      votes_per_guest: Number($('votes').value),
      show_vote_counts: $('counts').checked,
    }), { fillForm: true });
    const opened = !wasVoting && next?.phase === 'voting';
    showStatus($('settings-status'), opened ? 'Saved. Voting is open on every guest screen.' : 'Settings saved.');
  } catch (err) {
    showStatus($('settings-status'), err.message, true);
  } finally {
    $('save-btn').disabled = false;
  }
});

$('end-btn').addEventListener('click', async () => {
  const ok = await confirmSheet({
    title: 'End voting now?',
    body: [
      `Votes freeze and the top ${state.finalist_count} masks go to the live final.`,
      'You can reopen voting later by saving a new closing time.',
    ],
    confirm: 'End voting',
    danger: false,
  });
  if (!ok) return;

  try {
    await load(api('POST', '/api/admin/end-voting'), { fillForm: true });
    showStatus($('settings-status'), 'Voting closed. Guests now see the finalists.');
  } catch (err) {
    showStatus($('settings-status'), err.message, true);
  }
});

$('reset-btn').addEventListener('click', async () => {
  const n = state?.masks.length ?? 0;
  showStatus($('reset-status'), '');
  const ok = await confirmSheet({
    title: 'Are you sure?',
    body: [
      `This permanently deletes all ${n} mask photo${n === 1 ? '' : 's'}, every vote, the finalists and winners, and all settings.`,
      'Guests will see an empty gallery until you check in new masks.',
    ],
    confirm: 'Yes, reset everything',
  });
  if (!ok) return;

  try {
    await load(api('POST', '/api/admin/reset'), { fillForm: true });
    showStatus($('settings-status'), '');
    showStatus($('reset-status'), 'Tournament reset. Everything is cleared for the next party.');
  } catch (err) {
    showStatus($('reset-status'), err.message, true);
  }
});
