import {
  api, formatDuration, h, icons, latestOnly, maskNum, msUntil, photoHTML, podiumHTML,
  poll, serverNow, setPartyName, showStatus, syncClock, syncList,
} from './common.js';

const $ = (id) => document.getElementById(id);
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five'];
const PHASE_PILL = { checkin: 'Opens soon', final: 'Voting closed', winners: 'Winners' };

const latest = latestOnly();
let state = null;
let busy = false;
let statusTimer = null;
let podiumShown = null;
let refresh = () => {};

async function load(request) {
  const next = await latest(request);
  if (next) {
    state = next;
    render();
  }
  return next;
}

function notify(message, { isError = false, sticky = false } = {}) {
  showStatus($('vote-status'), message, isError);
  clearTimeout(statusTimer);
  if (!sticky) statusTimer = setTimeout(() => showStatus($('vote-status'), ''), 4000);
}
const showError = (message) => notify(message, { isError: true });

// Arriving from a check-in QR: claim the ticket, then drop it from the address bar
async function start() {
  const ticket = new URLSearchParams(location.search).get('ticket');
  if (ticket) {
    history.replaceState(null, '', location.pathname);
    try {
      const claimed = await load(api('POST', '/api/claim', { ticket }));
      const me = claimed?.masks.find((m) => m.id === claimed.my_mask_id);
      notify(`You're in${me ? ` as ${maskNum(me.number)}` : ''}. Pick your favourite costumes below.`);
    } catch (e) {
      notify(e.message, { isError: true, sticky: true });
    }
  }
  refresh = poll(() => load(api('GET', '/api/state')));
}
start();

async function act(method, path) {
  if (busy) return;
  busy = true;
  try {
    await load(api(method, path));
  } catch (e) {
    showError(e.message);
    refresh();
  } finally {
    busy = false;
  }
}

function render() {
  syncClock(state.server_now);
  setPartyName(state.party_name);

  const roundOne = state.phase === 'checkin' || state.phase === 'voting';
  $('view-vote').hidden = !roundOne;
  $('vote-bar').hidden = !roundOne;
  $('view-final').hidden = state.phase !== 'final';
  $('view-winners').hidden = state.phase !== 'winners';

  $('timer-pill').hidden = state.phase !== 'voting';
  $('phase-pill').hidden = state.phase === 'voting';
  $('phase-pill').textContent = PHASE_PILL[state.phase] || '';
  $('phase-pill').classList.toggle('pill-accent', state.phase === 'winners');
  tickTimer();

  if (roundOne) renderVote();
  else if (state.phase === 'final') renderFinal();
  else renderWinners();
}

function tickTimer() {
  if (state?.phase !== 'voting') return;
  const ms = msUntil(state.voting_closes_at);
  const text = ms === null ? 'Open' : formatDuration(ms);
  $('timer-text').textContent = text;
  $('timer-pill').setAttribute('aria-label', ms === null ? 'Voting is open' : `Voting closes in ${text}`);
  // The server closes voting on the first request after the deadline
  if (ms === 0) refresh();
}
setInterval(tickTimer, 1000);

// ---- round 1 -----------------------------------------------------------

function renderVote() {
  const max = state.votes_per_guest;
  const mine = state.my_votes;
  const word = NUMBER_WORDS[max] || max;

  $('vote-title').textContent = max === 1 ? 'Pick your best costume' : `Pick your ${word} best costumes`;
  $('vote-lead').textContent = `${max === 1 ? 'Tap one mask' : `Tap up to ${word} masks`}. When the timer runs out, the top ${state.finalist_count} go to the live final on stage.`;
  $('vote-empty').hidden = state.masks.length > 0;
  $('ticket-notice').hidden = hasTicket();
  syncList($('mask-grid'), state.masks, (m) => m.id, createCard, updateCard);

  const picked = mine.map((id) => state.masks.find((m) => m.id === id)).filter(Boolean);
  let summary = `${mine.length} of ${max} picked`;
  if (picked.length) summary += ' · ' + picked.map((m) => maskNum(m.number)).join(', ');
  if (state.phase === 'checkin') summary = 'Voting opens soon';
  if (!hasTicket()) summary = 'Scan your check-in QR to vote';
  if (state.locked) summary = 'Votes locked in. Watch for the finalists.';
  $('vote-summary').textContent = summary;

  $('pips').setAttribute('aria-label', `${mine.length} of ${max} votes used`);
  $('pips').innerHTML = Array.from({ length: max }, (_, i) => `<span class="pip${i < mine.length ? ' is-on' : ''}"></span>`).join('');

  const lock = $('lock-btn');
  lock.textContent = state.locked ? 'Votes locked' : 'Lock in my votes';
  lock.disabled = state.phase !== 'voting' || state.locked || mine.length === 0;
}

const hasTicket = () => state.my_mask_id !== null;

function createCard(mask) {
  const el = h(`
    <article class="mask-card">
      ${photoHTML(mask)}
      <div class="mask-body">
        <span class="count-row"><span class="mono"></span><span>votes</span></span>
        <button type="button" class="btn-vote"></button>
      </div>
    </article>`);
  el.querySelector('.photo').insertAdjacentHTML('beforeend', `<span class="check-badge" hidden>${icons.check()}</span>`);
  el.querySelector('.btn-vote').addEventListener('click', () => {
    const voted = state.my_votes.includes(mask.id);
    act(voted ? 'DELETE' : 'POST', `/api/votes/${mask.id}`);
  });
  return el;
}

function updateCard(el, mask) {
  const voted = state.my_votes.includes(mask.id);
  const mine = mask.id === state.my_mask_id;
  const open = state.phase === 'voting' && hasTicket() && !state.locked;
  const outOfVotes = state.my_votes.length >= state.votes_per_guest;
  const disabled = !open || mine || (outOfVotes && !voted);
  const num = maskNum(mask.number);

  el.classList.toggle('is-voted', voted);
  el.classList.toggle('is-mine', mine);
  el.classList.toggle('is-dim', open && disabled && !voted && !mine);
  el.querySelector('.check-badge').hidden = !voted;

  const count = el.querySelector('.count-row');
  count.hidden = mask.votes === null;
  count.firstElementChild.textContent = mask.votes ?? '';

  const btn = el.querySelector('.btn-vote');
  btn.disabled = disabled;
  btn.setAttribute('aria-pressed', String(voted));
  if (mine) {
    btn.textContent = 'Your mask';
    btn.setAttribute('aria-label', `Mask ${num} is yours`);
  } else if (voted) {
    btn.textContent = 'Voted';
    btn.setAttribute('aria-label', open ? `Remove vote for mask ${num}` : `Voted for mask ${num}`);
  } else {
    btn.textContent = state.phase !== 'voting' ? 'Vote' : state.locked ? 'Locked' : outOfVotes ? 'Out of votes' : 'Vote';
    btn.setAttribute('aria-label', `Vote for mask ${num}`);
  }
}

$('lock-btn').addEventListener('click', () => act('POST', '/api/lock'));

// ---- round 2 -----------------------------------------------------------

function renderFinal() {
  const n = state.finalists.length;
  $('final-title').textContent =
    n === 0 ? 'The live final is about to start'
      : n === 1 ? 'This mask is going to the stage'
        : `These ${n} masks are going to the stage`;

  syncList(
    $('finalist-list'),
    state.finalists,
    (m) => m.id,
    (m) => h(`
      <li class="finalist">
        ${photoHTML(m, { iconSize: 24, badge: false })}
        <div class="finalist-info">
          <span class="finalist-rank"></span>
          <span class="finalist-num">${maskNum(m.number)}</span>
        </div>
        <span class="finalist-votes"><span class="mono"></span><span>votes</span></span>
      </li>`),
    (el, m, i) => {
      el.querySelector('.finalist-rank').textContent = `Finalist ${i + 1}`;
      el.querySelector('.finalist-votes').hidden = m.votes === null;
      el.querySelector('.finalist-votes .mono').textContent = m.votes ?? '';
    },
  );
}

// ---- podium ------------------------------------------------------------

function renderWinners() {
  $('winners-eyebrow').textContent = `Best costume ${new Date(serverNow()).getFullYear()}`;
  const html = podiumHTML(state.winners);
  if (html !== podiumShown) {
    $('podium').innerHTML = html;
    podiumShown = html;
  }
}
