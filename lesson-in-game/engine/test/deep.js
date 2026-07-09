'use strict';
/**
 * Deep integration test — the classroom edge cases the smoke test doesn't touch:
 *
 *   S1  review-timing feedback, double-points token, streak bonuses, recall
 *       scaffolding (option removed), reveal with a non-answering student,
 *       whole-class co-op team (uk), reflections in the report
 *   S2  estimate scoring (full/partial/zero), immediate feedback, estimate
 *       scaffolding (hint range), team averages
 *   S3  disconnect ends round, reconnect snapshot at review, pause → student
 *       reloads mid-pause → resume re-sends the question, late joiner enters
 *       next round, reset reverts scores, kick ends a waiting round and blocks
 *       rejoin, low-participation flag in the report
 *   S4  crash mid-round → restore from checkpoint (paused) → students rejoin
 *       with tokens → resume → finish; session carries its own pack.json
 *
 *   node test/deep.js        (exit 0 = pass)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

process.env.LESSON_IN_GAME_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-in-game-test-'));

const { io: ioc } = require('socket.io-client');
const { createServer } = require('../server');
const quizArena = require('../shells/quiz-arena');

let failures = 0;
function ok(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`);
  else { failures++; console.error(`  ✗ ${msg}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, label, timeout = 8000) {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`TIMEOUT waiting for: ${label}`);
    await sleep(40);
  }
}

function recallPack(id, lang, n) {
  const items = [];
  for (let i = 1; i <= n; i++) {
    items.push({
      id: `q${i}`, primitive: 'recall', prompt: `Q${i}?`,
      options: ['opt-A', 'opt-B', 'opt-C', 'opt-D'], answer: (i - 1) % 4,
      difficulty: 2, explanation: `Because ${i}.`, tags: [i % 2 ? 'odd' : 'even'],
    });
  }
  return {
    packId: id, title: id, subject: 'Testing', grade: 8, language: lang,
    objective: 'recall things', bloom: 'remember', primitives: ['recall'],
    reviewStatus: 'approved', approvedAt: new Date().toISOString(), items,
  };
}

function estimatePack(id, n) {
  const answers = [100, 50, 1000, 20];
  const tols = [10, 5, 100, 2];
  const items = [];
  for (let i = 1; i <= n; i++) {
    items.push({
      id: `e${i}`, primitive: 'estimate', prompt: `E${i}?`,
      numericAnswer: answers[i - 1], tolerance: tols[i - 1], unit: 'u',
      difficulty: 2, explanation: `It is ${answers[i - 1]}.`, tags: ['est'],
    });
  }
  return {
    packId: id, title: id, subject: 'Testing', grade: 10, language: 'en',
    objective: 'estimate things', bloom: 'apply', primitives: ['estimate'],
    reviewStatus: 'approved', approvedAt: new Date().toISOString(), items,
  };
}

const itemByContent = (pack, content) => pack.items.find((it) => it.id === content.itemId);
const correctChoice = (pack, content) => itemByContent(pack, content).answer;
const wrongChoice = (pack, content) => {
  const ans = itemByContent(pack, content).answer;
  return content.options.map((o) => o.i).find((i) => i !== ans);
};

function student(url, room, name, token = null) {
  const s = {
    name, token, ack: null, rounds: [], feedbacks: [], reveals: [], ends: [], errors: [],
    socket: ioc(url, { forceNew: true, reconnection: false }),
  };
  s.socket.on('roundStart', (r) => s.rounds.push(r));
  s.socket.on('feedback', (f) => s.feedbacks.push(f));
  s.socket.on('roundEnd', (r) => s.reveals.push(r));
  s.socket.on('sessionEnd', (e) => s.ends.push(e));
  s.socket.on('errorMsg', (e) => s.errors.push(e));
  s.join = () => new Promise((res) => {
    const doJoin = () => s.socket.emit('join', { room, name: s.name, resumeToken: s.token }, (a) => {
      s.ack = a;
      if (a && a.ok) s.token = a.resumeToken;
      res(a);
    });
    if (s.socket.connected) doJoin();
    else s.socket.on('connect', doJoin);
  });
  s.answer = (data) => s.socket.emit('input', { type: 'answer', data });
  s.reflect = (text) => s.socket.emit('input', { type: 'reflection', data: { text } });
  s.lastRound = () => s.rounds[s.rounds.length - 1];
  s.waitRound = (idx, label) => waitFor(() => s.rounds.find((r) => r.roundIndex === idx && r.deadline > Date.now() - 60000), label || `${name} sees round ${idx}`);
  s.close = () => s.socket.disconnect();
  return s;
}

function makeHost(url, key) {
  const h = { dashboards: [], reports: [], socket: ioc(url, { forceNew: true }) };
  h.socket.on('host:dashboard', (d) => h.dashboards.push(d));
  h.socket.on('host:report', (r) => h.reports.push(r));
  h.auth = () => new Promise((res) => {
    const doAuth = () => h.socket.emit('host:auth', { key }, res);
    if (h.socket.connected) doAuth();
    else h.socket.on('connect', doAuth);
  });
  h.act = (action, args) => new Promise((res) => h.socket.emit('host:control', { action, args }, res));
  h.latest = () => h.dashboards[h.dashboards.length - 1];
  h.waitPhase = (phase) => waitFor(() => {
    const d = h.latest();
    return d && d.phase === phase ? d : null;
  }, `host sees phase ${phase}`);
  h.close = () => h.socket.disconnect();
  return h;
}

// ═════ S1 — review timing · double · streaks · recall scaffold · co-op uk ═════
async function s1() {
  console.log('S1 · review feedback, double token, streaks, recall scaffold, co-op team');
  const pack = recallPack('deep-s1', 'uk', 5);
  const srv = await createServer({
    pack, shell: quizArena, port: 0, hostKey: 'k1',
    settings: { rounds: 4, timePerRound: 8, teams: 1, feedbackTiming: 'review' },
  });
  const url = `http://localhost:${srv.port}`;
  ok(fs.existsSync(path.join(srv.sessionDir, 'pack.json')), 'session dir carries pack.json');

  const host = makeHost(url, 'k1');
  await host.auth();
  const A = student(url, srv.roomCode, 'Anna');
  const B = student(url, srv.roomCode, 'Bohdan');
  await A.join(); await B.join();
  ok(A.ack.team.name === 'Увесь клас', `co-op single team localized (${A.ack.team.name})`);

  await host.act('start');
  // R1: A answers correct + double; B does not answer.
  const r1 = await A.waitRound(1);
  A.answer({ choice: correctChoice(pack, r1.content), double: true });
  await sleep(400);
  ok(A.feedbacks.length === 0, 'review timing: no feedback while round is live');
  await host.act('reveal');
  await waitFor(() => A.feedbacks.length === 1, 'A feedback at reveal');
  ok(A.feedbacks[0].delta === 220, `double token: (100+10)×2 = 220 (got ${A.feedbacks[0].delta})`);
  ok(B.feedbacks.length === 0 && B.reveals.length === 1, 'non-answering B got the reveal but no feedback');

  // R2–R4: A correct each round; B wrong each round.
  const deltas = [120, 130, 140]; // streak bonuses 20/30/40
  for (let round = 2; round <= 4; round++) {
    await host.act('next');
    const ra = await A.waitRound(round);
    ok(round === 2 ? ra.canDouble === false : true, round === 2 ? 'double token spent — canDouble false' : '');
    const rb = await B.waitRound(round);
    if (round === 4) {
      ok(rb.scaffold === true && rb.content.options.length === 3, `struggling B scaffolded in R4 (${rb.content.options.length} options)`);
      ok(ra.scaffold === false && ra.content.options.length === 4, 'thriving A not scaffolded');
      ok(!rb.content.options.some((o) => o.i === itemByContent(pack, rb.content).answer) === false, 'scaffold never removes the correct option');
    }
    A.answer({ choice: correctChoice(pack, ra.content) });
    B.answer({ choice: wrongChoice(pack, rb.content) });
    await waitFor(() => A.feedbacks.length === round, `A feedback R${round}`);
    ok(A.feedbacks[round - 1].delta === deltas[round - 2], `A streak delta R${round} = ${deltas[round - 2]} (got ${A.feedbacks[round - 1].delta})`);
  }

  await host.act('next'); await host.waitPhase('summary');
  await host.act('next'); await host.waitPhase('reflection');
  await waitFor(() => A.ends.length >= 1 && B.ends.length >= 1, 'sessionEnd delivered');
  ok(A.ends[0].personal.score === 610, `A total 610 (got ${A.ends[0].personal.score})`);
  ok(A.ends[0].teams[0].score === 305, `co-op team average 305 (got ${A.ends[0].teams[0].score})`);
  A.reflect('несподівано!'); B.reflect('складно');
  await waitFor(() => host.latest() && host.latest().reflections.length === 2, 'both reflections on dashboard');
  await host.act('next'); await host.waitPhase('ended');
  const report = JSON.parse(fs.readFileSync(path.join(srv.sessionDir, 'report.json'), 'utf8'));
  ok(report.reflections.length === 2, 'report captured reflections');
  const bRow = report.perStudent.find((s) => s.name === 'Bohdan');
  ok(bRow.flags.includes('struggling'), 'B flagged struggling (teacher-only)');
  A.close(); B.close(); host.close(); await srv.stop();
}

// ═════ S2 — estimate scoring, immediate feedback, hint-range scaffold ═════
async function s2() {
  console.log('S2 · estimate full/partial/zero, immediate feedback, hint-range scaffold');
  const pack = estimatePack('deep-s2', 3);
  const srv = await createServer({
    pack, shell: quizArena, port: 0, hostKey: 'k2',
    settings: { rounds: 3, timePerRound: 8, teams: 2 },
  });
  const url = `http://localhost:${srv.port}`;
  const host = makeHost(url, 'k2'); await host.auth();
  const A = student(url, srv.roomCode, 'Ada');
  const B = student(url, srv.roomCode, 'Bo');
  await A.join(); await B.join();
  await host.act('start');

  const bPlan = [
    (it) => it.numericAnswer + 1.5 * it.tolerance, // half credit
    (it) => it.numericAnswer + 10 * it.tolerance,  // zero
    (it) => it.numericAnswer,                       // full (scaffolded round)
  ];
  const bDeltas = [50, 0, 110]; // R3 is correct, so it starts a streak: 100 + 10
  for (let round = 1; round <= 3; round++) {
    const ra = await A.waitRound(round);
    const rb = await B.waitRound(round);
    if (round === 3) {
      const it = itemByContent(pack, rb.content);
      ok(rb.scaffold === true && rb.content.hintRange
        && rb.content.hintRange.lo === it.numericAnswer - 5 * it.tolerance
        && rb.content.hintRange.hi === it.numericAnswer + 5 * it.tolerance,
        `estimate scaffold hint range for struggling B (${JSON.stringify(rb.content.hintRange)})`);
      ok(!ra.scaffold, 'A not scaffolded');
    }
    A.answer({ value: itemByContent(pack, ra.content).numericAnswer });
    await waitFor(() => A.feedbacks.length === round, `A immediate feedback R${round}`);
    B.answer({ value: bPlan[round - 1](itemByContent(pack, rb.content)) });
    await waitFor(() => B.feedbacks.length === round, `B immediate feedback R${round}`);
    ok(B.feedbacks[round - 1].delta === bDeltas[round - 1], `B estimate delta R${round} = ${bDeltas[round - 1]} (got ${B.feedbacks[round - 1].delta})`);
    await host.waitPhase('roundReview');
    if (round < 3) await host.act('next');
  }
  ok(B.feedbacks[0].partial === 0.5, 'half credit marked partial 0.5');
  await host.act('next'); await host.waitPhase('summary');
  const d = host.latest();
  ok(d.teams.find((t) => t.id === 0).score === 360 && d.teams.find((t) => t.id === 1).score === 160,
    `team averages 360 / 160 (got ${d.teams.map((t) => t.score).join('/')})`);
  await host.act('end'); await host.waitPhase('reflection');
  await host.act('end'); await host.waitPhase('ended');
  A.close(); B.close(); host.close(); await srv.stop();
}

// ═════ S3 — the messy classroom ═════
async function s3() {
  console.log('S3 · disconnects, reload-during-pause, late joiner, reset, kick');
  const pack = recallPack('deep-s3', 'en', 4);
  const srv = await createServer({
    pack, shell: quizArena, port: 0, hostKey: 'k3',
    settings: { rounds: 3, timePerRound: 8, teams: 2 },
  });
  const url = `http://localhost:${srv.port}`;
  const host = makeHost(url, 'k3'); await host.auth();
  let A = student(url, srv.roomCode, 'Al');
  const B = student(url, srv.roomCode, 'Bea');
  const C = student(url, srv.roomCode, 'Cy');
  await A.join(); await B.join(); await C.join();
  await host.act('start');

  // R1: A and B answer, C drops → the round must auto-end (all-answered among connected).
  const r1a = await A.waitRound(1); const r1b = await B.waitRound(1); await C.waitRound(1);
  A.answer({ choice: correctChoice(pack, r1a.content) });
  B.answer({ choice: correctChoice(pack, r1b.content) });
  await sleep(200);
  C.close();
  await host.waitPhase('roundReview');
  ok(true, "C's disconnect ended the round (everyone connected had answered)");

  // C reconnects during review → snapshot brings the reveal.
  const C2 = student(url, srv.roomCode, 'Cy', C.token);
  await C2.join();
  await waitFor(() => C2.reveals.length >= 1, 'reconnected C received the round reveal');
  ok(C2.ack.name === 'Cy' && C2.ack.score === 0, 'C restored by token with score');

  // R2 starts; pause; D joins (pending); A reloads mid-pause.
  await host.act('next');
  await A.waitRound(2); await B.waitRound(2); await C2.waitRound(2);
  await host.act('pause'); await host.waitPhase('paused');
  const D = student(url, srv.roomCode, 'Dee');
  await D.join();
  ok(D.ack.pending === true && D.rounds.length === 0, 'late joiner is pending, gets no live question');
  A.close();
  A = student(url, srv.roomCode, 'Al', A.token);
  await A.join();
  const pausedRound = await A.waitRound(2, 'reloaded A gets the question while paused');
  ok(pausedRound.answered === false, 'reloaded A sees round 2 under the pause overlay');

  // Resume → everyone gets a fresh deadline; all three answer.
  const beforeResume = A.rounds.length;
  await host.act('resume');
  await waitFor(() => A.rounds.length > beforeResume, 'resume re-sent the question with a fresh deadline');
  const r2 = A.lastRound();
  A.answer({ choice: correctChoice(pack, r2.content) });
  B.answer({ choice: correctChoice(pack, B.lastRound().content) });
  C2.answer({ choice: wrongChoice(pack, C2.lastRound().content) });
  await host.waitPhase('roundReview');

  // R3: D enters; A answers then teacher resets; kick ends the waiting round.
  await host.act('next');
  const dRound = await D.waitRound(3, 'pending D promoted into round 3');
  ok(dRound.roundIndex === 3, 'D’s first question is round 3');
  const r3a = await A.waitRound(3);
  const scoreBefore = host.latest().roster.find((r) => r.name === 'Al').score;
  A.answer({ choice: correctChoice(pack, r3a.content) });
  await waitFor(() => host.latest().roster.find((r) => r.name === 'Al').score > scoreBefore, 'A scored in R3');
  await host.act('reset');
  await waitFor(() => {
    const row = host.latest().roster.find((r) => r.name === 'Al');
    return row && row.score === scoreBefore;
  }, 'reset reverted A’s score');
  const r3a2 = await waitFor(() => {
    const last = A.lastRound();
    return last && last.roundIndex === 3 && last.answered === false ? last : null;
  }, 'reset re-asked round 3');
  ok(r3a2.content.itemId === r3a.content.itemId, 'reset re-asks the SAME item');

  A.answer({ choice: correctChoice(pack, r3a2.content) });
  C2.answer({ choice: correctChoice(pack, C2.lastRound().content) });
  D.answer({ choice: correctChoice(pack, D.lastRound().content) });
  await sleep(300);
  ok(host.latest().phase === 'roundActive', 'round waits for Bea (kick target) — still active');
  const beaId = host.latest().roster.find((r) => r.name === 'Bea').id;
  await host.act('kick', { playerId: beaId });
  await host.waitPhase('roundReview');
  ok(true, 'kicking the last unanswered student ended the round');
  await waitFor(() => B.errors.some((e) => e.code === 'kicked'), 'Bea told she was removed');
  const B2 = student(url, srv.roomCode, 'Bea', B.token);
  const rejoin = await B2.join();
  ok(rejoin.ok === false && rejoin.error === 'kicked', 'kicked token cannot rejoin');

  await host.act('next'); await host.waitPhase('summary');
  await host.act('next'); await host.waitPhase('reflection');
  A.reflect('good');
  await host.act('next'); await host.waitPhase('ended');
  const report = JSON.parse(fs.readFileSync(path.join(srv.sessionDir, 'report.json'), 'utf8'));
  ok(!report.perStudent.some((s) => s.name === 'Bea'), 'kicked student excluded from the report');
  const dee = report.perStudent.find((s) => s.name === 'Dee');
  ok(dee && dee.flags.includes('low-participation'), 'late joiner flagged low-participation (1 of 3 rounds)');
  [A, B2, C2, D].forEach((s) => s.close()); host.close(); await srv.stop();
}

// ═════ S4 — crash, restore, resume, finish ═════
async function s4() {
  console.log('S4 · crash mid-round → restore paused → rejoin → resume → report');
  const pack = recallPack('deep-s4', 'en', 3);
  const srv1 = await createServer({
    pack, shell: quizArena, port: 0, hostKey: 'k4',
    settings: { rounds: 2, timePerRound: 8, teams: 2 },
  });
  const url1 = `http://localhost:${srv1.port}`;
  const dir = srv1.sessionDir;
  const host1 = makeHost(url1, 'k4'); await host1.auth();
  const A = student(url1, srv1.roomCode, 'Ann');
  const B = student(url1, srv1.roomCode, 'Ben');
  await A.join(); await B.join();
  await host1.act('start');
  const r1a = await A.waitRound(1); const r1b = await B.waitRound(1);
  A.answer({ choice: correctChoice(pack, r1a.content) });
  B.answer({ choice: correctChoice(pack, r1b.content) });
  await host1.waitPhase('roundReview');
  await host1.act('next');
  await A.waitRound(2);
  A.answer({ choice: correctChoice(pack, A.lastRound().content) }); // will be lost — checkpoint was at round start
  await sleep(150);
  A.close(); B.close(); host1.close();
  await srv1.stop(); // ← the "crash" (no finish, no report)
  ok(!fs.existsSync(path.join(dir, 'report.json')), 'no report yet — session died mid-round');

  const srv2 = await createServer({ pack, shell: quizArena, port: 0, hostKey: 'k5', resumeDir: dir });
  const url2 = `http://localhost:${srv2.port}`;
  ok(srv2.sessionDir === dir, 'restored into the same session directory');
  const host2 = makeHost(url2, 'k5'); await host2.auth();
  const d0 = await host2.waitPhase('paused');
  ok(d0.roundIndex === 2, 'restored paused inside round 2');
  ok(d0.roster.find((r) => r.name === 'Ann').score === 110, 'Ann’s round-1 score survived the crash');

  const A2 = student(url2, srv2.roomCode, 'Ann', A.token);
  const B2 = student(url2, srv2.roomCode, 'Ben', B.token);
  await A2.join(); await B2.join();
  ok(A2.ack.ok && A2.ack.score === 110, `token rejoin across restart, score intact (${A2.ack.score})`);
  await A2.waitRound(2, 'restored round waiting under pause for Ann');

  await host2.act('resume');
  await waitFor(() => A2.rounds.filter((r) => r.roundIndex === 2).length >= 2 || A2.lastRound().deadline > Date.now() + 1000, 'fresh deadline after resume');
  A2.answer({ choice: correctChoice(pack, A2.lastRound().content) });
  B2.answer({ choice: correctChoice(pack, B2.lastRound().content) });
  await host2.waitPhase('roundReview');
  await host2.act('next'); await host2.waitPhase('summary');
  await host2.act('next'); await host2.waitPhase('reflection');
  await host2.act('next'); await host2.waitPhase('ended');
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
  ok(report.roundsPlayed === 2 && report.perStudent.length === 2, `report after resume: ${report.roundsPlayed} rounds, ${report.perStudent.length} students`);
  A2.close(); B2.close(); host2.close(); await srv2.stop();
}

async function main() {
  const guard = setTimeout(() => { console.error('GLOBAL TIMEOUT'); process.exit(1); }, 120000);
  await s1();
  await s2();
  await s3();
  await s4();
  clearTimeout(guard);
  fs.rmSync(process.env.LESSON_IN_GAME_HOME, { recursive: true, force: true });
  console.log(failures === 0 ? '\nDEEP PASS' : `\nDEEP FAIL — ${failures} assertion(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
