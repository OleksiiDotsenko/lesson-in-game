'use strict';
/* Control view — the teacher's private cockpit. Steers the session without the
   class seeing the machinery. Individual flags live ONLY here and in the report. */

const $ = (id) => document.getElementById(id);
const key = new URLSearchParams(location.search).get('key');
const socket = io();

socket.on('connect', () => {
  socket.emit('host:auth', { key }, (res) => {
    if (!res || !res.ok) {
      document.body.innerHTML = '<main class="login"><h1>Wrong or missing key</h1><p class="muted">Open the control link printed by the runner (it carries ?key=…).</p></main>';
    }
  });
});

function act(action, args) {
  socket.emit('host:control', { action, args }, (res) => {
    if (res && !res.ok && res.error) console.warn('control:', res.error);
  });
}

$('btn-start').onclick = () => act('start');
$('btn-pause').onclick = () => act('pause');
$('btn-resume').onclick = () => act('resume');
$('btn-reveal').onclick = () => act('reveal');
$('btn-next').onclick = () => act('next');
$('btn-reset').onclick = () => { if (confirm('Reset this round? Answers and points for it are discarded and the same question is re-asked.')) act('reset'); };
$('btn-end').onclick = () => act('end');

const ENABLED = {
  lobby:       ['btn-start'],
  roundActive: ['btn-pause', 'btn-reveal', 'btn-reset', 'btn-end'],
  paused:      ['btn-resume', 'btn-reset', 'btn-end'],
  roundReview: ['btn-next', 'btn-reset', 'btn-end'],
  summary:     ['btn-next', 'btn-end'],
  reflection:  ['btn-next', 'btn-end'],
  ended:       [],
};
const NEXT_LABEL = { roundReview: '⏭ Next round', summary: '⏭ To reflection', reflection: '✓ Finish & report' };

socket.on('host:dashboard', (d) => {
  $('k-phase').textContent = d.phase;
  $('k-round').textContent = d.roundIndex ? `round ${d.roundIndex}/${d.total}` : `${d.total} rounds planned`;
  $('k-timer').textContent = d.phase === 'roundActive' || d.phase === 'paused' ? Math.ceil((d.timeLeft || 0) / 1000) + 's' : '–';
  $('k-preview').classList.toggle('hidden', !d.packMeta.preview);
  $('k-pack').textContent = `${d.packMeta.title || d.packMeta.packId} · ${d.packMeta.subject} · ${d.packMeta.objective}`;
  $('s-join').textContent = `Join: ${d.joinInfo.url} (code ${d.joinInfo.roomCode})`;

  const enabled = ENABLED[d.phase] || [];
  for (const b of ['btn-start', 'btn-pause', 'btn-resume', 'btn-reveal', 'btn-next', 'btn-reset', 'btn-end']) {
    $(b).disabled = !enabled.includes(b);
  }
  $('btn-next').textContent = NEXT_LABEL[d.phase] || '⏭ Next';

  // roster
  const tbody = $('roster');
  tbody.innerHTML = '';
  for (const p of d.roster) {
    const tr = document.createElement('tr');
    if (!p.connected) tr.className = 'off';
    const acc = p.accuracy === null ? null : Math.round(p.accuracy * 100);
    tr.innerHTML =
      `<td><span class="dot ${p.connected ? 'on' : 'offd'}"></span></td>` +
      `<td>${esc(p.name)}${p.flags.map((f) => `<span class="flag">${f}</span>`).join('')}` +
        `${p.pending ? '<span class="flag pending">joins next round</span>' : ''}` +
        `${p.scaffolded ? '<span class="flag scaffold">scaffold</span>' : ''}` +
        `${p.reflected ? ' 💬' : ''}</td>` +
      `<td>${p.team}</td>` +
      `<td>${p.answeredThisRound ? '✓' : d.phase === 'roundActive' ? '…' : ''}</td>` +
      `<td>${p.score}</td>` +
      `<td>${acc === null ? '—' : `<span class="acc-bar"><i style="width:${acc}%"></i></span> ${acc}%`}</td>` +
      `<td><button class="kick" data-id="${p.id}">kick</button></td>`;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll('.kick').forEach((b) => {
    b.onclick = () => { if (confirm('Remove this student from the session?')) act('kick', { playerId: b.dataset.id }); };
  });

  // class stats
  $('s-online').textContent = d.class.online;
  $('s-answered').textContent = d.class.answeredPct === null ? '—' : d.class.answeredPct + '%';
  $('s-ema').textContent = Math.round(d.class.emaAccuracy * 100) + '%';
  $('s-target').textContent = d.class.targetDifficulty + '/5';

  // current round (teacher-only answer preview)
  if (d.round) {
    let html = `<p><strong>${esc(d.round.content.prompt)}</strong> <span class="muted">(difficulty ${d.round.difficulty})</span></p>`;
    if (d.round.content.options) {
      html += '<ul>' + d.round.content.options.map((o) => `<li>${esc(o.text)}</li>`).join('') + '</ul>';
    }
    html += `<p class="answer">✔ ${esc(d.round.correctDisplay)}</p>`;
    $('round-preview').innerHTML = html;
  } else {
    $('round-preview').textContent = '—';
  }

  // reflections
  const ul = $('reflections');
  ul.innerHTML = '';
  for (const r of d.reflections) {
    const li = document.createElement('li');
    li.innerHTML = `<strong>${esc(r.name)}:</strong> ${esc(r.text)}`;
    ul.appendChild(li);
  }

  if (d.reportDir) {
    $('report-card').classList.remove('hidden');
    $('report-link').textContent = d.reportDir;
  }
});

socket.on('host:report', (r) => {
  $('report-card').classList.remove('hidden');
  $('report-link').textContent = r.reportDir;
});

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
