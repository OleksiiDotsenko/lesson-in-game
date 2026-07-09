'use strict';
/* Lesson in Game student client. Holds NO authoritative state — it draws the last thing
   the server said and emits requests. Reconnects resume via the stored token. */

const $ = (id) => document.getElementById(id);
const screens = ['join', 'lobby', 'question', 'review', 'end'];
function show(name) {
  for (const s of screens) $('screen-' + s).classList.toggle('hidden', s !== name);
}

const STORE_KEY = 'lesson-in-game-session';
function saveIdentity(data) { try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch {} }
function loadIdentity() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { return null; } }

const params = new URLSearchParams(location.search);
const socket = io();

let me = { playerId: null, token: null, name: null, team: null, pending: false };
let current = { round: null, answered: false, lastFeedback: null, deadline: 0, roundIndex: 0, total: 0 };
let timerHandle = null;
let joined = false;

// ── boot ──
setLang(navigator.language);
const saved = loadIdentity();
$('room-input').value = (params.get('room') || (saved && saved.room) || '').toUpperCase();
if (saved && saved.name) $('name-input').value = saved.name;

$('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const room = $('room-input').value.trim().toUpperCase();
  const name = $('name-input').value.trim();
  const token = saved && saved.room === room ? saved.token : null;
  doJoin(room, name, token);
});

function doJoin(room, name, token) {
  $('join-error').classList.add('hidden');
  socket.emit('join', { room, name, resumeToken: token }, (res) => {
    if (!res || !res.ok) {
      const key = { 'bad-room': 'badRoom', kicked: 'kicked', 'session-finishing': 'finishing' }[res && res.error] || 'joinFailed';
      $('join-error').textContent = t(key);
      $('join-error').classList.remove('hidden');
      return;
    }
    joined = true;
    me = { playerId: res.playerId, token: res.resumeToken, name: res.name, team: res.team, pending: res.pending, score: res.score || 0 };
    saveIdentity({ room, token: res.resumeToken, name: res.name });
    setLang(res.lang);
    $('team-badge').textContent = res.team.name + ' · ' + res.name;
    $('team-badge').style.background = res.team.color;
    $('pending-note').classList.toggle('hidden', !res.pending);
    if (res.phase === 'lobby' || res.pending) show('lobby');
    // Otherwise the snapshot events arriving right after this ack will route us.
  });
}

// Auto-rejoin after a drop (Socket.IO reconnects the transport; we re-authenticate).
socket.on('connect', () => {
  $('offline-banner').classList.add('hidden');
  const id = loadIdentity();
  if (joined && id && id.token) {
    socket.emit('join', { room: id.room, name: id.name, resumeToken: id.token }, () => {});
  }
});
socket.on('disconnect', () => { if (joined) $('offline-banner').classList.remove('hidden'); });

// ── lobby ──
socket.on('lobby', (data) => {
  if (!joined) { $('join-title').textContent = data.title || ''; return; }
  $('lobby-players').innerHTML = '';
  for (const p of data.players) {
    const chip = document.createElement('span');
    chip.className = 'chip' + (p.connected ? '' : ' off');
    chip.textContent = p.name;
    $('lobby-players').appendChild(chip);
  }
});

// ── rounds ──
socket.on('roundStart', (r) => {
  // The server may re-send the current round (resume after a pause, reconnect).
  // Keep our feedback for it so the strip doesn't blank out mid-round.
  const sameRound = current.round && r.roundIndex === current.roundIndex && r.answered;
  const keepFeedback = sameRound ? current.lastFeedback : null;
  current = { round: r, answered: !!r.answered, lastFeedback: keepFeedback, deadline: r.deadline, roundIndex: r.roundIndex, total: r.total };
  $('pause-overlay').classList.add('hidden');
  $('q-round').textContent = `${t('round')} ${r.roundIndex}/${r.total}`;
  $('q-team').textContent = me.team ? me.team.name : '';
  $('q-team').style.borderColor = me.team ? me.team.color : '';
  $('q-prompt').textContent = r.content.prompt;
  $('q-feedback').classList.add('hidden');
  $('q-locked').classList.toggle('hidden', !current.answered);

  // hint (scaffold)
  const hint = $('q-hint');
  hint.classList.add('hidden');
  if (r.content.hintRange) {
    hint.textContent = t('hintBetween', { lo: r.content.hintRange.lo, hi: r.content.hintRange.hi });
    hint.classList.remove('hidden');
  } else if (r.content.scaffolded) {
    hint.textContent = t('scaffoldNote');
    hint.classList.remove('hidden');
  }

  // double-points token
  $('double-check').checked = false;
  $('double-wrap').classList.toggle('hidden', !r.canDouble || current.answered);

  // answer widgets
  const opts = $('q-options');
  opts.innerHTML = '';
  $('q-estimate').classList.add('hidden');
  if (r.content.primitive === 'recall') {
    r.content.options.forEach((o, idx) => {
      const b = document.createElement('button');
      b.innerHTML = `<span class="opt-letter">${String.fromCharCode(65 + idx)}</span>`;
      b.appendChild(document.createTextNode(o.text));
      b.disabled = current.answered;
      b.addEventListener('click', () => submitAnswer({ choice: o.i }));
      opts.appendChild(b);
    });
  } else if (r.content.primitive === 'estimate') {
    $('q-estimate').classList.remove('hidden');
    $('estimate-input').value = '';
    $('estimate-input').disabled = current.answered;
    $('estimate-submit').disabled = current.answered;
    $('estimate-unit').textContent = r.content.unit || '';
    if (r.content.min !== null && r.content.max !== null) {
      $('estimate-input').placeholder = `${r.content.min} – ${r.content.max}`;
    }
  }
  show('question');
  startTimer();
  if (current.lastFeedback) renderFeedback(current.lastFeedback);
  updateFooter();
});

$('estimate-submit').addEventListener('click', () => {
  const v = parseFloat($('estimate-input').value);
  if (!isFinite(v)) { $('estimate-input').focus(); return; }
  submitAnswer({ value: v });
});

function submitAnswer(data) {
  if (current.answered) return;
  current.answered = true;
  if ($('double-check').checked) data.double = true;
  socket.emit('input', { type: 'answer', data });
  lockUi();
}

function lockUi() {
  $('q-options').querySelectorAll('button').forEach((b) => (b.disabled = true));
  $('estimate-input').disabled = true;
  $('estimate-submit').disabled = true;
  $('double-wrap').classList.add('hidden');
  $('q-locked').classList.remove('hidden');
}

socket.on('feedback', (f) => {
  current.lastFeedback = f;
  me.score = f.score;
  renderFeedback(f);
  updateFooter();
});

function renderFeedback(f) {
  $('q-locked').classList.add('hidden');
  const el = $('q-feedback');
  const cls = f.correct ? 'ok' : f.partial > 0 ? 'half' : 'no';
  const msg = f.correct ? '✓ ' + t('correct') : f.partial > 0 ? '≈ ' + t('partly') : '✗ ' + t('wrong');
  el.className = 'feedback ' + cls;
  el.innerHTML = msg + `<span class="delta">+${f.delta} ${t('points')}${f.streak > 1 ? ` · ${t('streak')} ×${f.streak}` : ''}</span>`;
  el.classList.remove('hidden');
}

socket.on('roundEnd', (r) => {
  stopTimer();
  $('review-prompt').textContent = r.prompt;
  $('review-answer').textContent = r.correctDisplay;
  $('review-explanation').textContent = r.explanation || '';
  const yours = $('review-your');
  const f = current.lastFeedback;
  if (f && f.itemId === r.itemId) {
    const cls = f.correct ? 'ok' : f.partial > 0 ? 'half' : 'no';
    const msg = f.correct ? '✓ ' + t('correct') : f.partial > 0 ? '≈ ' + t('partly') : '✗ ' + t('wrong');
    yours.className = 'review-your ' + cls;
    yours.textContent = `${msg} +${f.delta} ${t('points')}`;
  } else if (current.answered) {
    yours.className = 'review-your no';
    yours.textContent = '…';
  } else {
    yours.className = 'review-your no';
    yours.textContent = t('noAnswer');
  }
  renderTeams($('review-teams'), r.teams);
  show('review');
});

// ── end of session ──
socket.on('sessionEnd', (e) => {
  stopTimer();
  renderTeams($('end-teams'), e.teams);
  $('end-personal').innerHTML = `
    <span class="stat"><b>${e.personal.score}</b>${t('score')}</span>
    <span class="stat"><b>${e.personal.correct}/${e.personal.answered}</b>${t('answered')}</span>
    <span class="stat"><b>×${e.personal.bestStreak}</b>${t('bestStreak')}</span>`;
  $('reflection-prompt').textContent = e.reflectionPrompt;
  show('end');
});

$('reflection-submit').addEventListener('click', () => {
  const text = $('reflection-input').value.trim();
  if (!text) return;
  socket.emit('input', { type: 'reflection', data: { text } });
  $('reflection-input').disabled = true;
  $('reflection-submit').disabled = true;
  $('reflection-thanks').classList.remove('hidden');
});

// ── shared state ──
socket.on('state', (s) => {
  $('pause-overlay').classList.toggle('hidden', s.phase !== 'paused');
  if (s.phase === 'roundActive' && current.round) {
    current.deadline = Date.now() + s.timeLeft; // resync clock drift
  }
});

socket.on('errorMsg', (e) => {
  if (e.code === 'kicked') {
    joined = false;
    saveIdentity(null);
    alert(t('kicked'));
    location.href = '/';
  }
});

// ── helpers ──
function renderTeams(el, teams) {
  el.innerHTML = '';
  for (const tm of teams) {
    const d = document.createElement('div');
    d.className = 'team';
    d.style.background = tm.color;
    d.innerHTML = `<span class="t-score">${tm.score}</span>${tm.name} · ${t('teamAvg')}`;
    el.appendChild(d);
  }
}

function updateFooter() {
  $('progress-footer').textContent = me.name ? `${t('you')}: ${me.name} · ${me.score || 0} ${t('points')}` : '';
}

function startTimer() {
  stopTimer();
  const total = Math.max(1, current.deadline - Date.now());
  timerHandle = setInterval(() => {
    const left = Math.max(0, current.deadline - Date.now());
    const sec = Math.ceil(left / 1000);
    const el = $('q-timer');
    el.textContent = sec + 's';
    el.classList.toggle('low', sec <= 5);
    $('timebar-fill').style.width = Math.max(0, Math.min(100, (left / total) * 100)) + '%';
    if (left <= 0) stopTimer();
  }, 250);
}
function stopTimer() { if (timerHandle) { clearInterval(timerHandle); timerHandle = null; } }
