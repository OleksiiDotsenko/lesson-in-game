'use strict';
/* Cast view — the room's shared screen. Shows the spectacle, never an
   individual's mistake, and never the correct answer before the reveal. */

const $ = (id) => document.getElementById(id);
const key = new URLSearchParams(location.search).get('key');
const socket = io();

let lastDash = null;

socket.on('connect', () => {
  socket.emit('host:auth', { key }, (res) => {
    if (!res || !res.ok) {
      document.body.innerHTML = '<main class="cast"><h1>Wrong or missing key</h1><p class="phase-note">Open the cast link printed by the runner.</p></main>';
    }
  });
});

socket.on('host:dashboard', (d) => {
  lastDash = d;
  render(d);
});

function showOnly(id) {
  for (const s of ['c-lobby', 'c-round', 'c-review', 'c-summary', 'c-reflection', 'c-paused']) {
    $(s).classList.toggle('hidden', s !== id);
  }
}

function render(d) {
  if (d.phase === 'lobby') {
    $('c-title').textContent = d.packMeta.title || 'Ludus';
    $('c-code').textContent = d.joinInfo.roomCode;
    $('c-url').textContent = d.joinInfo.url;
    const roster = $('c-roster');
    roster.innerHTML = '';
    for (const p of d.roster) {
      const s = document.createElement('span');
      s.textContent = p.name;
      if (!p.connected) s.className = 'off';
      roster.appendChild(s);
    }
    showOnly('c-lobby');
    return;
  }

  if (d.phase === 'paused') { showOnly('c-paused'); return; }

  if (d.phase === 'roundActive' && d.round) {
    const sec = Math.ceil((d.timeLeft || 0) / 1000);
    $('c-count').textContent = sec + 's';
    $('c-count').classList.toggle('low', sec <= 5);
    $('c-prompt').textContent = d.round.content.prompt;
    const grid = $('c-options');
    grid.innerHTML = '';
    if (d.round.content.primitive === 'recall') {
      (d.round.content.options || []).forEach((o, idx) => {
        const div = document.createElement('div');
        div.className = 'opt';
        div.innerHTML = `<span class="letter">${String.fromCharCode(65 + idx)}</span>`;
        div.appendChild(document.createTextNode(o.text));
        grid.appendChild(div);
      });
    }
    const eligible = d.roster.filter((r) => r.connected && !r.pending).length;
    $('c-answered').textContent = `${d.roster.filter((r) => r.answeredThisRound).length} / ${eligible}`;
    showOnly('c-round');
    return;
  }

  if (d.phase === 'roundReview' && d.reveal) {
    const r = d.reveal;
    $('c-review-prompt').textContent = r.prompt;
    const grid = $('c-review-options');
    const buckets = $('c-buckets');
    grid.innerHTML = '';
    buckets.innerHTML = '';
    buckets.classList.add('hidden');
    if (r.distribution.kind === 'options') {
      const max = Math.max(1, ...r.distribution.counts.map((c) => c.count));
      r.distribution.counts.forEach((c, idx) => {
        const div = document.createElement('div');
        div.className = 'opt' + (idx === r.distribution.answerIndex ? ' correct' : '');
        div.innerHTML = `<span class="letter">${String.fromCharCode(65 + idx)}</span>`;
        div.appendChild(document.createTextNode(`${c.text} — ${c.count}`));
        const bar = document.createElement('span');
        bar.className = 'bar';
        bar.style.width = Math.round((c.count / max) * 100) + '%';
        div.appendChild(bar);
        grid.appendChild(div);
      });
    } else if (r.distribution.kind === 'buckets') {
      buckets.classList.remove('hidden');
      const b = r.distribution;
      buckets.innerHTML =
        `<div class="bucket">🎯 ${b.within}</div>` +
        `<div class="bucket">≈ ${b.close}</div>` +
        `<div class="bucket">· ${b.far}</div>` +
        (b.median !== null ? `<div class="bucket">median ${b.median}</div>` : '');
      grid.innerHTML = `<div class="opt correct">✔ ${r.correctDisplay}</div>`;
    }
    $('c-explanation').textContent = r.explanation || '';
    renderTeams($('c-review-teams'), d.teams);
    showOnly('c-review');
    return;
  }

  if (d.phase === 'summary' || d.phase === 'ended') {
    $('c-summary-title').textContent = '🏁 ' + (d.packMeta.title || '');
    renderTeams($('c-summary-teams'), d.teams);
    $('c-summary-note').textContent = d.phase === 'ended' ? 'Session ended' : '';
    showOnly('c-summary');
    return;
  }

  if (d.phase === 'reflection') {
    $('c-reflection-prompt').textContent = d.reflectionPrompt || '';
    $('c-reflection-count').textContent = `${d.reflections.length} 💬`;
    showOnly('c-reflection');
  }
}

function renderTeams(el, teams) {
  el.innerHTML = '';
  const sorted = [...teams].sort((a, b) => b.score - a.score);
  for (const t of sorted) {
    const div = document.createElement('div');
    div.className = 'team';
    div.style.background = t.color;
    div.innerHTML = `<span class="score">${t.score}</span>${t.name}`;
    el.appendChild(div);
  }
}
