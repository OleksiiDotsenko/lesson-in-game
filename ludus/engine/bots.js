#!/usr/bin/env node
'use strict';
/**
 * Dummy students for preview/dry-run mode. They join, answer with human-ish
 * delays, and file a reflection — so the teacher can watch a full round play
 * out on the cast view before going live (doc §13.5).
 *
 *   node bots.js --url http://localhost:3131 --room ABCD [--count 8]
 *
 * Bots don't know correct answers (the server never sends them) — recall picks
 * a random option, estimate guesses inside the hint bounds when present.
 */

const { io } = require('socket.io-client');

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--url') args.url = argv[++i];
  else if (argv[i] === '--room') args.room = argv[++i];
  else if (argv[i] === '--count') args.count = parseInt(argv[++i], 10);
}
if (!args.url || !args.room) {
  console.error('Usage: node bots.js --url http://host:port --room CODE [--count 8]');
  process.exit(1);
}
const COUNT = args.count || 8;
const NAMES = ['Ava', 'Borys', 'Chen', 'Daryna', 'Emil', 'Fatima', 'Hlib', 'Iryna', 'Jo', 'Kateryna', 'Lev', 'Mia', 'Nazar', 'Olya', 'Petro', 'Quinn', 'Roma', 'Sofia', 'Taras', 'Uma'];

let done = 0;

function spawnBot(n) {
  const socket = io(args.url, { reconnection: true });
  const name = (NAMES[n % NAMES.length] || 'Bot') + (n >= NAMES.length ? '-' + n : '');
  let reflected = false;

  socket.on('connect', () => {
    socket.emit('join', { room: args.room, name }, (res) => {
      if (!res || !res.ok) {
        console.error(`[bot ${name}] join failed: ${res && res.error}`);
        socket.close();
      }
    });
  });

  socket.on('roundStart', (r) => {
    if (r.answered) return;
    const delay = 800 + Math.random() * Math.min(6000, Math.max(1500, r.timeLeft * 0.6));
    setTimeout(() => {
      let data = null;
      if (r.content.primitive === 'recall' && Array.isArray(r.content.options) && r.content.options.length) {
        const pick = r.content.options[Math.floor(Math.random() * r.content.options.length)];
        data = { choice: pick.i };
      } else if (r.content.primitive === 'estimate') {
        let lo = r.content.hintRange ? r.content.hintRange.lo : (r.content.min ?? 0);
        let hi = r.content.hintRange ? r.content.hintRange.hi : (r.content.max ?? (lo + 100));
        if (!(hi > lo)) hi = lo + 100;
        data = { value: Math.round((lo + Math.random() * (hi - lo)) * 100) / 100 };
      }
      if (data) {
        if (Math.random() < 0.1) data.double = true; // some bots gamble their token
        socket.emit('input', { type: 'answer', data });
      }
    }, delay);
  });

  socket.on('sessionEnd', () => {
    if (reflected) return;
    reflected = true;
    setTimeout(() => {
      socket.emit('input', { type: 'reflection', data: { text: `(bot ${name}) the estimate one surprised me` } });
      done++;
      if (done === COUNT) console.log('[bots] all reflections sent — preview complete, Ctrl+C when done watching.');
    }, 500 + Math.random() * 2000);
  });
}

for (let i = 0; i < COUNT; i++) setTimeout(() => spawnBot(i), i * 150);
console.log(`[bots] joining ${COUNT} dummy students to room ${args.room} at ${args.url}`);
