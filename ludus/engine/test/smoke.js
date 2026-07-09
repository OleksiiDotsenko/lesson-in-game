'use strict';
/**
 * End-to-end smoke test: boots the real server, joins 5 simulated students,
 * drives the host through every phase, and asserts the report files land.
 * Also asserts the review gate refuses draft packs.
 *
 *   node test/smoke.js        (exit 0 = pass)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Isolate the data home so tests never touch the real ~/ludus.
process.env.LUDUS_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ludus-test-'));

const { io: ioc } = require('socket.io-client');
const { createServer } = require('../server');
const { launchCheck } = require('../validate-pack');
const quizArena = require('../shells/quiz-arena');

const PACK = {
  packId: 'smoke-test-001',
  title: 'Smoke test',
  subject: 'Testing',
  grade: 8,
  language: 'en',
  objective: 'Recall the facts of smoke',
  bloom: 'remember',
  primitives: ['recall', 'estimate'],
  reviewStatus: 'approved',
  approvedAt: new Date().toISOString(),
  items: [
    { id: 'r1', primitive: 'recall', prompt: 'Pick A', options: ['A', 'B', 'C', 'D'], answer: 0, difficulty: 1, explanation: 'A is first.', tags: ['alpha'] },
    { id: 'r2', primitive: 'recall', prompt: 'Pick B', options: ['A', 'B', 'C'], answer: 1, difficulty: 2, explanation: 'B is second.', tags: ['alpha'] },
    { id: 'r3', primitive: 'recall', prompt: 'Pick C', options: ['A', 'B', 'C', 'D'], answer: 2, difficulty: 3, explanation: 'C is third.', tags: ['beta'] },
    { id: 'e1', primitive: 'estimate', prompt: 'Guess 100', numericAnswer: 100, tolerance: 10, unit: 'kg', min: 0, max: 200, difficulty: 2, explanation: 'It is 100.', tags: ['beta'] },
    { id: 'e2', primitive: 'estimate', prompt: 'Guess 50', numericAnswer: 50, tolerance: 5, min: 0, max: 100, difficulty: 4, explanation: 'It is 50.', tags: ['beta'] },
  ],
};

const BOTS = 5;
const phasesSeen = [];
let failures = 0;

function ok(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`);
  else { failures++; console.error(`  ✗ ${msg}`); }
}

async function main() {
  console.log('1. Review gate');
  const draft = { ...PACK, reviewStatus: 'draft' };
  ok(launchCheck(draft).ok === false && launchCheck(draft).notApproved === true, 'draft pack is refused for live launch');
  ok(launchCheck(PACK).ok === true, 'approved pack passes the gate');

  console.log('2. Boot server');
  const srv = await createServer({ pack: PACK, shell: quizArena, settings: { rounds: 3, timePerRound: 5, teams: 2 }, port: 0, hostKey: 'testkey' });
  ok(srv.port > 0, `listening on :${srv.port}`);
  ok(/room=/.test(srv.joinUrl), `join URL ${srv.joinUrl}`);

  const url = `http://localhost:${srv.port}`;

  // static pages
  for (const p of ['/', '/host', '/cast', '/qr.png', '/health']) {
    const res = await fetch(url + p);
    ok(res.ok, `GET ${p} → ${res.status}`);
  }

  console.log('3. Join students');
  const students = [];
  await Promise.all(Array.from({ length: BOTS }, (_, n) => new Promise((resolve) => {
    const s = ioc(url);
    const bot = { socket: s, name: `Bot${n}`, feedbacks: 0, roundsSeen: 0, sessionEnd: null };
    students.push(bot);
    s.on('connect', () => {
      s.emit('join', { room: srv.roomCode, name: bot.name }, (res) => {
        ok(res.ok, `${bot.name} joined as ${res.name} (team ${res.team.name})`);
        resolve();
      });
    });
    s.on('roundStart', (r) => {
      bot.roundsSeen++;
      if (r.answered) return;
      setTimeout(() => {
        // Bot0 always answers correctly (deterministic accuracy signal); others random.
        let data;
        if (r.content.primitive === 'recall') {
          const correctByPrompt = { 'Pick A': 0, 'Pick B': 1, 'Pick C': 2 };
          const want = correctByPrompt[r.content.prompt];
          const pool = r.content.options.map((o) => o.i);
          data = { choice: n === 0 && pool.includes(want) ? want : pool[Math.floor(Math.random() * pool.length)] };
        } else {
          const truth = r.content.prompt === 'Guess 100' ? 100 : 50;
          data = { value: n === 0 ? truth : Math.random() * 200 };
        }
        if (n === 1 && bot.roundsSeen === 1) data.double = true;
        s.emit('input', { type: 'answer', data });
      }, 100 + n * 60);
    });
    s.on('feedback', () => bot.feedbacks++);
    s.on('sessionEnd', (e) => {
      if (!bot.sessionEnd) {
        bot.sessionEnd = e;
        s.emit('input', { type: 'reflection', data: { text: `hi from ${bot.name}` } });
      }
    });
  })));

  // duplicate-name resolution
  await new Promise((resolve) => {
    const dup = ioc(url);
    dup.on('connect', () => dup.emit('join', { room: srv.roomCode, name: 'Bot0' }, (res) => {
      ok(res.ok && res.name === 'Bot0-2', `name collision resolved: ${res.name}`);
      dup.close();
      resolve();
    }));
  });
  // bad room code
  await new Promise((resolve) => {
    const bad = ioc(url);
    bad.on('connect', () => bad.emit('join', { room: 'XXXX', name: 'Ghost' }, (res) => {
      ok(res.ok === false && res.error === 'bad-room', 'bad room code rejected');
      bad.close();
      resolve();
    }));
  });

  console.log('4. Drive the session (host)');
  const host = ioc(url);
  const acted = new Set();
  let reportPayload = null;

  // Attach dashboard handlers BEFORE authenticating — the server pushes the
  // first dashboard during auth and we must not miss it.
  const finished = new Promise((resolve, reject) => {
    const guard = setTimeout(() => reject(new Error('TIMEOUT — session did not finish in 45s. Phases seen: ' + phasesSeen.join('→'))), 45000);
    host.on('host:report', (r) => { reportPayload = r; });
    host.on('host:dashboard', (d) => {
      if (phasesSeen[phasesSeen.length - 1] !== d.phase) phasesSeen.push(d.phase);
      const stamp = d.phase + ':' + d.roundIndex;
      if (acted.has(stamp)) return;
      const act = (a) => { acted.add(stamp); host.emit('host:control', { action: a }, () => {}); };
      if (d.phase === 'lobby' && d.roster.filter((r) => r.connected).length >= BOTS) act('start');
      else if (d.phase === 'roundReview') setTimeout(() => act('next'), 150);
      else if (d.phase === 'summary') setTimeout(() => act('next'), 150);
      else if (d.phase === 'reflection') {
        // give reflections a moment to arrive, then finish
        setTimeout(() => act('next'), 1200);
      } else if (d.phase === 'ended') { clearTimeout(guard); resolve(); }
    });
  });

  await new Promise((resolve) => {
    host.on('connect', () => host.emit('host:auth', { key: 'testkey' }, (res) => {
      ok(res.ok, 'host authenticated');
      resolve();
    }));
    if (host.connected) host.emit('host:auth', { key: 'testkey' }, (res) => { ok(res.ok, 'host authenticated'); resolve(); });
  });
  await new Promise((resolve) => {
    const wrong = ioc(url);
    wrong.on('connect', () => wrong.emit('host:auth', { key: 'nope' }, (res) => {
      ok(res.ok === false, 'wrong host key rejected');
      wrong.close();
      resolve();
    }));
  });

  await finished;

  console.log('5. Assertions');
  ok(phasesSeen.includes('lobby') && phasesSeen.includes('roundActive') && phasesSeen.includes('roundReview')
    && phasesSeen.includes('summary') && phasesSeen.includes('reflection') && phasesSeen.includes('ended'),
    `full phase spine traversed (${phasesSeen.join(' → ')})`);
  ok(students.every((b) => b.roundsSeen === 3), `every student saw 3 rounds (${students.map((b) => b.roundsSeen).join(',')})`);
  ok(students.every((b) => b.feedbacks === 3), `every student got 3 private feedbacks (${students.map((b) => b.feedbacks).join(',')})`);
  ok(students.every((b) => b.sessionEnd && b.sessionEnd.reflectionPrompt), 'sessionEnd carried a reflection prompt (RECIPE)');
  const b0 = students[0].sessionEnd.personal;
  ok(b0.correct === 3 && b0.answered === 3, `deterministic Bot0 got 3/3 correct (got ${b0.correct}/${b0.answered})`);

  const dir = srv.sessionDir;
  for (const f of ['log.jsonl', 'checkpoint.json', 'report.json', 'report.md', 'students.csv']) {
    ok(fs.existsSync(path.join(dir, f)), `session file exists: ${f}`);
  }
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
  ok(report.roundsPlayed === 3, 'report.roundsPlayed = 3');
  ok(report.perItem.length === 3, 'report has 3 item rows');
  ok(report.perStudent.length >= BOTS, `report has ${report.perStudent.length} student rows`);
  ok(report.reflections.length === BOTS, `report captured ${report.reflections.length}/${BOTS} reflections`);
  const bot0Row = report.perStudent.find((s) => s.name === 'Bot0');
  ok(bot0Row && bot0Row.accuracy === 100, `Bot0 accuracy 100% in report (got ${bot0Row && bot0Row.accuracy})`);
  ok(reportPayload && reportPayload.reportDir === dir, 'host received host:report with the session dir');

  for (const b of students) b.socket.close();
  host.close();
  await srv.stop();

  console.log(failures === 0 ? '\nSMOKE PASS' : `\nSMOKE FAIL — ${failures} assertion(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
