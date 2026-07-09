'use strict';
/**
 * The session state machine. One instance per classroom match.
 *
 *   Lobby → RoundActive ⇄ Paused
 *           RoundActive → RoundReview → (next round | Summary)
 *           Summary → Reflection → Ended
 *
 * The server is authoritative: clients only send requests; every screen redraws
 * from the last broadcast, so a lost packet self-corrects on the next tick.
 * Host 'end' fast-forwards one macro-stage at a time (…→ Summary → Reflection →
 * Ended) so the RECIPE reflection moment can be shortened but never skipped.
 */

const { EVENTS, PHASES, INPUT_TYPES } = require('./protocol');
const store = require('./store');

const TEAM_COLORS = ['#2563eb', '#ea580c', '#16a34a', '#9333ea'];
const TEAM_NAMES = {
  en: ['Blue team', 'Orange team', 'Green team', 'Purple team'],
  uk: ['Сині', 'Помаранчеві', 'Зелені', 'Фіолетові'],
};
const CLASS_TEAM_NAME = { en: 'The whole class', uk: 'Увесь клас' };
const DEFAULT_REFLECTION = {
  en: 'Which answer surprised you the most — and why?',
  uk: 'Яка відповідь здивувала тебе найбільше — і чому?',
};
const ANSWER_GRACE_MS = 500;
const SCAFFOLD_MIN_ANSWERS = 2;
const SCAFFOLD_ACCURACY_BELOW = 0.5;
const STRUGGLER_MIN_ANSWERS = 3;

class Session {
  constructor({ io, pack, shell, settings = {}, sessionDir, roomCode, hostKey, preview = false }) {
    this.io = io;
    this.pack = pack;
    this.shell = shell;
    this.settings = { ...shell.defaultSettings, ...settings };
    this.sessionDir = sessionDir;
    this.roomCode = roomCode;
    this.hostKey = hostKey;
    this.preview = preview;
    this.joinUrl = '';
    this.lang = (pack.language || 'en').slice(0, 2);

    this.phase = PHASES.LOBBY;
    this.phaseBeforePause = null;
    this.roundIndex = 0; // 1-based once rounds start
    this.usableItems = pack.items.filter((it) => shell.supportedPrimitives.includes(it.primitive));
    this.plannedRounds = Math.min(this.settings.rounds, this.usableItems.length);
    this.usedItemIds = new Set();
    this.emaAccuracy = 0.6;
    this.targetDifficulty = 2;

    this.players = new Map(); // playerId → player
    this.socketToPlayer = new Map();
    this.round = null; // { item, deadline, remainingMs, answers: Map, endedReason }
    this.roundTimer = null;
    this.tick = null;
    this.reportData = null;

    const teamCount = Math.max(1, Math.min(4, this.settings.teams | 0 || 1));
    const names = teamCount === 1
      ? [CLASS_TEAM_NAME[this.lang] || CLASS_TEAM_NAME.en]
      : (TEAM_NAMES[this.lang] || TEAM_NAMES.en);
    this.teams = Array.from({ length: teamCount }, (_, i) => ({
      id: i, name: names[i] || `Team ${i + 1}`, color: TEAM_COLORS[i], rawScore: 0, score: 0,
    }));

    this.reflectionPrompt = pack.reflectionPrompt || DEFAULT_REFLECTION[this.lang] || DEFAULT_REFLECTION.en;

    store.appendLog(sessionDir, 'session_created', {
      packId: pack.packId, shell: shell.id, preview, settings: this.settings, plannedRounds: this.plannedRounds,
    });
  }

  // ── joining ────────────────────────────────────────────────────────────────

  handleJoin(socket, { room, name, resumeToken } = {}, cb) {
    const ack = typeof cb === 'function' ? cb : () => {};
    if (!room || String(room).toUpperCase() !== this.roomCode) {
      return ack({ ok: false, error: 'bad-room' });
    }

    // Reconnection path: a known token restores the player, score intact.
    if (resumeToken && this.players.has(resumeToken)) {
      const p = this.players.get(resumeToken);
      if (p.kicked) return ack({ ok: false, error: 'kicked' });
      if (p.socketId) this.socketToPlayer.delete(p.socketId);
      p.socketId = socket.id;
      p.connected = true;
      this.socketToPlayer.set(socket.id, p.id);
      socket.join('students');
      store.appendLog(this.sessionDir, 'rejoin', { playerId: p.id, name: p.name });
      ack(this.joinAck(p));
      this.sendSnapshotTo(p);
      this.emitLobby();
      this.pushDashboard();
      return;
    }

    if ([PHASES.SUMMARY, PHASES.REFLECTION, PHASES.ENDED].includes(this.phase)) {
      return ack({ ok: false, error: 'session-finishing' });
    }

    const player = {
      id: cryptoRandomId(),
      name: this.uniqueName(sanitizeName(name)),
      teamId: this.smallestTeam().id,
      socketId: socket.id,
      connected: true,
      kicked: false,
      pending: this.phase !== PHASES.LOBBY, // late joiners enter at the next round
      score: 0,
      answers: [], // { itemId, roundIndex, correct, partial, delta, ms, double, scaffold, streakBefore }
      streak: 0,
      bestStreak: 0,
      doubleUsed: false,
      reflection: null,
    };
    this.players.set(player.id, player);
    this.socketToPlayer.set(socket.id, player.id);
    socket.join('students');
    store.appendLog(this.sessionDir, 'join', { playerId: player.id, name: player.name, team: player.teamId, pending: player.pending });
    ack(this.joinAck(player));
    this.sendSnapshotTo(player);
    this.emitLobby();
    this.pushDashboard();
    this.checkpoint();
  }

  joinAck(p) {
    const team = this.teams[p.teamId];
    return {
      ok: true, playerId: p.id, resumeToken: p.id, name: p.name,
      team: { id: team.id, name: team.name, color: team.color },
      phase: this.phase, lang: this.lang, pending: p.pending, score: p.score,
    };
  }

  uniqueName(base) {
    const taken = new Set([...this.players.values()].filter((p) => !p.kicked).map((p) => p.name));
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
  }

  smallestTeam() {
    const counts = this.teams.map((t) => ({ t, n: this.teamMembers(t.id).length }));
    counts.sort((a, b) => a.n - b.n || a.t.id - b.t.id);
    return counts[0].t;
  }

  teamMembers(teamId) {
    return [...this.players.values()].filter((p) => p.teamId === teamId && !p.kicked);
  }

  handleDisconnect(socket) {
    const pid = this.socketToPlayer.get(socket.id);
    if (!pid) return;
    this.socketToPlayer.delete(socket.id);
    const p = this.players.get(pid);
    if (p && p.socketId === socket.id) {
      p.connected = false;
      p.socketId = null;
      store.appendLog(this.sessionDir, 'leave', { playerId: p.id, name: p.name });
      this.emitLobby();
      this.pushDashboard();
      this.maybeEndRoundAllAnswered();
    }
  }

  // ── student input ──────────────────────────────────────────────────────────

  handleInput(socket, { type, data } = {}) {
    const pid = this.socketToPlayer.get(socket.id);
    if (!pid) return;
    const p = this.players.get(pid);
    if (!p || p.kicked) return;

    if (type === INPUT_TYPES.REFLECTION) {
      if (![PHASES.SUMMARY, PHASES.REFLECTION].includes(this.phase)) return;
      const text = String((data && data.text) || '').slice(0, 500).trim();
      if (!text) return;
      p.reflection = text;
      store.appendLog(this.sessionDir, 'reflection', { playerId: p.id, name: p.name, text });
      this.pushDashboard();
      return;
    }

    if (type !== INPUT_TYPES.ANSWER) return;
    if (this.phase !== PHASES.ROUND_ACTIVE || !this.round) return;
    if (p.pending) return;
    if (this.round.answers.has(p.id)) return;
    const now = Date.now();
    if (now > this.round.deadline + ANSWER_GRACE_MS) return;

    const item = this.round.item;
    const timeLeftFrac = Math.max(0, (this.round.deadline - now) / (this.settings.timePerRound * 1000));
    const scaffold = this.round.scaffolded.has(p.id);
    const scored = this.shell.score(item, data, {
      timeLeftFrac, settings: this.settings, streakBefore: p.streak,
    });

    let delta = scored.delta;
    let double = false;
    if (data && data.double === true && this.settings.doublePoints && !p.doubleUsed) {
      p.doubleUsed = true;
      double = true;
      delta *= 2;
    }

    const record = {
      itemId: item.id, roundIndex: this.roundIndex,
      correct: scored.correct, partial: scored.partial, delta,
      ms: this.settings.timePerRound * 1000 - Math.max(0, this.round.deadline - now),
      double, scaffold, streakBefore: p.streak, data,
    };
    this.round.answers.set(p.id, record);
    p.answers.push(record);
    p.score += delta;
    p.streak = scored.correct ? p.streak + 1 : 0;
    p.bestStreak = Math.max(p.bestStreak, p.streak);

    store.appendLog(this.sessionDir, 'answer', {
      playerId: p.id, name: p.name, team: p.teamId, itemId: item.id, roundIndex: this.roundIndex,
      correct: scored.correct, partial: scored.partial, delta, ms: record.ms, double, scaffold,
    });

    if (this.settings.feedbackTiming === 'immediate') this.sendFeedback(p, record);
    this.pushDashboard();
    this.maybeEndRoundAllAnswered();
  }

  sendFeedback(p, record) {
    if (!p.socketId) return;
    this.io.to(p.socketId).emit(EVENTS.FEEDBACK, {
      itemId: record.itemId, correct: record.correct, partial: record.partial,
      delta: record.delta, streak: p.streak, score: p.score,
    });
  }

  maybeEndRoundAllAnswered() {
    if (this.phase !== PHASES.ROUND_ACTIVE || !this.round) return;
    const eligible = [...this.players.values()].filter((p) => p.connected && !p.pending && !p.kicked);
    if (eligible.length > 0 && eligible.every((p) => this.round.answers.has(p.id))) {
      this.endRound('all-answered');
    }
  }

  // ── host control ───────────────────────────────────────────────────────────

  hostControl(action, args = {}) {
    switch (action) {
      case 'start':
        if (this.phase !== PHASES.LOBBY) return { ok: false, error: `cannot start from ${this.phase}` };
        if (![...this.players.values()].some((p) => p.connected && !p.kicked)) {
          return { ok: false, error: 'no players connected yet' };
        }
        this.startRound();
        return { ok: true };
      case 'pause':
        if (this.phase !== PHASES.ROUND_ACTIVE) return { ok: false, error: 'nothing to pause' };
        this.pauseRound();
        return { ok: true };
      case 'resume':
        if (this.phase !== PHASES.PAUSED) return { ok: false, error: 'not paused' };
        this.resumeRound();
        return { ok: true };
      case 'reveal':
        if (this.phase !== PHASES.ROUND_ACTIVE) return { ok: false, error: 'no active round' };
        this.endRound('revealed');
        return { ok: true };
      case 'reset':
        if (![PHASES.ROUND_ACTIVE, PHASES.ROUND_REVIEW, PHASES.PAUSED].includes(this.phase) || !this.round) {
          return { ok: false, error: 'no round to reset' };
        }
        this.resetRound();
        return { ok: true };
      case 'next':
        return this.advance();
      case 'end':
        return this.fastForward();
      case 'kick': {
        const p = this.players.get(args.playerId);
        if (!p) return { ok: false, error: 'unknown player' };
        this.kick(p);
        return { ok: true };
      }
      default:
        return { ok: false, error: `unknown action ${action}` };
    }
  }

  advance() {
    if (this.phase === PHASES.ROUND_REVIEW) {
      if (this.roundIndex >= this.plannedRounds || this.remainingItems().length === 0) this.gotoSummary();
      else this.startRound();
      return { ok: true };
    }
    if (this.phase === PHASES.SUMMARY) { this.gotoReflection(); return { ok: true }; }
    if (this.phase === PHASES.REFLECTION) { this.finish(); return { ok: true }; }
    return { ok: false, error: `nothing to advance from ${this.phase}` };
  }

  fastForward() {
    if ([PHASES.LOBBY, PHASES.ROUND_ACTIVE, PHASES.PAUSED, PHASES.ROUND_REVIEW].includes(this.phase)) {
      this.clearRoundTimer();
      this.gotoSummary();
      return { ok: true };
    }
    if (this.phase === PHASES.SUMMARY) { this.gotoReflection(); return { ok: true }; }
    if (this.phase === PHASES.REFLECTION) { this.finish(); return { ok: true }; }
    return { ok: false, error: 'already ended' };
  }

  kick(p) {
    p.kicked = true;
    p.connected = false;
    if (p.socketId) {
      this.io.to(p.socketId).emit(EVENTS.ERROR, { code: 'kicked', message: 'removed-by-teacher' });
      const s = this.io.sockets.sockets.get(p.socketId);
      if (s) s.disconnect(true);
      this.socketToPlayer.delete(p.socketId);
      p.socketId = null;
    }
    store.appendLog(this.sessionDir, 'kick', { playerId: p.id, name: p.name });
    this.recomputeTeamScores();
    this.emitLobby();
    this.pushDashboard();
    // If the kicked student was the only one yet to answer, don't leave the
    // round hanging until the timer.
    this.maybeEndRoundAllAnswered();
  }

  // ── rounds ─────────────────────────────────────────────────────────────────

  remainingItems() {
    return this.usableItems.filter((it) => !this.usedItemIds.has(it.id));
  }

  /** Adaptive pick: nearest unused item to the class's target difficulty. */
  pickItem() {
    const pool = this.remainingItems();
    if (!pool.length) return null;
    const scored = pool
      .map((it) => ({ it, d: Math.abs(it.difficulty - this.targetDifficulty) }))
      .sort((a, b) => a.d - b.d);
    const best = scored.filter((s) => s.d === scored[0].d);
    return best[Math.floor(Math.random() * best.length)].it;
  }

  startRound(fixedItem = null) {
    const item = fixedItem || this.pickItem();
    if (!item) return this.gotoSummary();

    // Late joiners promised entry "at the next round" — this is that moment.
    for (const p of this.players.values()) if (p.pending && !p.kicked) p.pending = false;

    if (!fixedItem) {
      this.roundIndex += 1;
      this.usedItemIds.add(item.id);
    }
    this.phase = PHASES.ROUND_ACTIVE;
    this.round = {
      item,
      deadline: Date.now() + this.settings.timePerRound * 1000,
      remainingMs: null,
      answers: new Map(),
      scaffolded: new Set(),
      endedReason: null,
    };
    store.appendLog(this.sessionDir, 'round_start', {
      roundIndex: this.roundIndex, itemId: item.id, difficulty: item.difficulty, target: this.targetDifficulty,
    });
    for (const p of this.players.values()) this.sendRoundStartTo(p);
    this.armRoundTimer(this.settings.timePerRound * 1000);
    this.startTick();
    this.broadcastState();
    this.pushDashboard();
    this.checkpoint();
  }

  /** Private scaffolding decision (Flow/competence rule, inclusion-safe). */
  shouldScaffold(p) {
    if (!this.settings.scaffolding) return false;
    const recent = p.answers.slice(-4);
    if (recent.length < SCAFFOLD_MIN_ANSWERS) return false;
    const acc = recent.reduce((s, a) => s + a.partial, 0) / recent.length;
    return acc < SCAFFOLD_ACCURACY_BELOW;
  }

  sendRoundStartTo(p) {
    if (!p.socketId || p.kicked || p.pending || !this.round) return;
    const scaffold = this.round.scaffolded.has(p.id) || this.shouldScaffold(p);
    if (scaffold) this.round.scaffolded.add(p.id);
    this.io.to(p.socketId).emit(EVENTS.ROUND_START, {
      roundIndex: this.roundIndex,
      total: this.plannedRounds,
      content: this.shell.publicContent(this.round.item, { scaffold }),
      deadline: this.round.deadline,
      timeLeft: Math.max(0, this.round.deadline - Date.now()),
      difficulty: this.round.item.difficulty,
      scaffold,
      canDouble: this.settings.doublePoints && !p.doubleUsed,
      answered: this.round.answers.has(p.id),
    });
  }

  armRoundTimer(ms) {
    this.clearRoundTimer();
    this.roundTimer = setTimeout(() => this.endRound('time-up'), ms);
  }

  clearRoundTimer() {
    if (this.roundTimer) { clearTimeout(this.roundTimer); this.roundTimer = null; }
  }

  pauseRound() {
    this.round.remainingMs = Math.max(0, this.round.deadline - Date.now());
    this.clearRoundTimer();
    this.phaseBeforePause = this.phase;
    this.phase = PHASES.PAUSED;
    store.appendLog(this.sessionDir, 'phase', { phase: this.phase });
    this.broadcastState();
    this.pushDashboard();
    this.checkpoint();
  }

  resumeRound() {
    this.phase = PHASES.ROUND_ACTIVE;
    this.round.deadline = Date.now() + (this.round.remainingMs ?? 0);
    this.round.remainingMs = null;
    this.armRoundTimer(Math.max(0, this.round.deadline - Date.now()));
    // Anyone who (re)connected while paused — including the whole class after a
    // crash-restore — has no question on screen. Re-send with the fresh
    // deadline; the client preserves already-answered state.
    for (const p of this.players.values()) this.sendRoundStartTo(p);
    store.appendLog(this.sessionDir, 'phase', { phase: this.phase });
    this.broadcastState();
    this.pushDashboard();
    this.checkpoint();
  }

  resetRound() {
    // Undo everything the current round changed, then re-ask the same item.
    for (const [pid, rec] of this.round.answers) {
      const p = this.players.get(pid);
      if (!p) continue;
      p.score -= rec.delta;
      p.streak = rec.streakBefore;
      if (rec.double) p.doubleUsed = false;
      const idx = p.answers.lastIndexOf(rec);
      if (idx >= 0) p.answers.splice(idx, 1);
    }
    store.appendLog(this.sessionDir, 'round_reset', { roundIndex: this.roundIndex, itemId: this.round.item.id });
    this.recomputeTeamScores();
    const item = this.round.item;
    this.round = null;
    this.startRound(item);
  }

  endRound(reason) {
    if (this.phase !== PHASES.ROUND_ACTIVE || !this.round) return;
    this.clearRoundTimer();
    this.round.endedReason = reason;
    this.phase = PHASES.ROUND_REVIEW;

    const item = this.round.item;
    const answers = [...this.round.answers.values()];
    const answered = answers.length;
    const acc = answered ? answers.reduce((s, a) => s + a.partial, 0) / answered : null;
    if (acc !== null) {
      this.emaAccuracy = 0.7 * this.emaAccuracy + 0.3 * acc;
      if (this.emaAccuracy > 0.85) this.targetDifficulty = Math.min(5, this.targetDifficulty + 1);
      else if (this.emaAccuracy < 0.45) this.targetDifficulty = Math.max(1, this.targetDifficulty - 1);
    }
    this.recomputeTeamScores();

    if (this.settings.feedbackTiming === 'review') {
      for (const [pid, rec] of this.round.answers) {
        const p = this.players.get(pid);
        if (p) this.sendFeedback(p, rec);
      }
    }

    const payload = {
      roundIndex: this.roundIndex,
      itemId: item.id,
      prompt: item.prompt,
      correctDisplay: this.shell.correctDisplay(item),
      explanation: item.explanation || '',
      distribution: this.shell.distribution(item, answers),
      teams: this.publicTeams(),
    };
    this.io.to('students').emit(EVENTS.ROUND_END, payload);
    this.lastReveal = payload;
    store.appendLog(this.sessionDir, 'round_end', {
      roundIndex: this.roundIndex, itemId: item.id, reason, answered,
      accuracy: acc, ema: this.emaAccuracy,
    });
    this.broadcastState();
    this.pushDashboard();
    this.checkpoint();
  }

  recomputeTeamScores() {
    for (const t of this.teams) t.rawScore = 0;
    for (const p of this.players.values()) {
      if (p.kicked) continue;
      this.teams[p.teamId].rawScore += p.score;
    }
    for (const t of this.teams) {
      const n = this.teamMembers(t.id).length;
      t.score = n ? Math.round(t.rawScore / n) : 0; // team average — fair with uneven teams
    }
  }

  // ── endgame ────────────────────────────────────────────────────────────────

  gotoSummary() {
    this.phase = PHASES.SUMMARY;
    this.recomputeTeamScores();
    store.appendLog(this.sessionDir, 'phase', { phase: this.phase });
    this.broadcastState();
    this.pushDashboard();
    this.checkpoint();
  }

  gotoReflection() {
    this.phase = PHASES.REFLECTION;
    store.appendLog(this.sessionDir, 'phase', { phase: this.phase });
    const teams = this.publicTeams();
    const answeredAll = [...this.players.values()].filter((p) => !p.kicked);
    const classStats = {
      players: answeredAll.length,
      rounds: this.roundIndex,
      accuracy: classAccuracy(answeredAll),
    };
    for (const p of this.players.values()) {
      if (!p.socketId || p.kicked) continue;
      this.io.to(p.socketId).emit(EVENTS.SESSION_END, {
        teams, classStats,
        personal: {
          score: p.score,
          correct: p.answers.filter((a) => a.correct).length,
          answered: p.answers.length,
          bestStreak: p.bestStreak,
        },
        reflectionPrompt: this.reflectionPrompt,
      });
    }
    this.broadcastState();
    this.pushDashboard();
    this.checkpoint();
  }

  finish() {
    if (this.phase === PHASES.ENDED) return;
    this.phase = PHASES.ENDED;
    this.stopTick();
    this.clearRoundTimer();
    store.appendLog(this.sessionDir, 'session_end', { rounds: this.roundIndex });
    const report = require('./report').compileFromSession(this);
    require('./report').writeReport(this.sessionDir, report, { preview: this.preview });
    this.reportData = report;
    this.io.to('hosts').emit(EVENTS.HOST_REPORT, { reportDir: this.sessionDir, report });
    this.broadcastState();
    this.pushDashboard();
    this.checkpoint();
  }

  // ── broadcasts ─────────────────────────────────────────────────────────────

  publicTeams() {
    return this.teams.map((t) => ({
      id: t.id, name: t.name, color: t.color, score: t.score, size: this.teamMembers(t.id).length,
    }));
  }

  timeLeft() {
    if (this.phase === PHASES.PAUSED && this.round) return this.round.remainingMs ?? 0;
    if (this.phase === PHASES.ROUND_ACTIVE && this.round) return Math.max(0, this.round.deadline - Date.now());
    return 0;
  }

  emitLobby() {
    this.io.to('students').emit(EVENTS.LOBBY, {
      players: [...this.players.values()].filter((p) => !p.kicked).map((p) => ({ name: p.name, team: p.teamId, connected: p.connected })),
      teams: this.publicTeams(),
      phase: this.phase,
      lang: this.lang,
      roomCode: this.roomCode,
      joinUrl: this.joinUrl,
      title: this.pack.title || this.pack.objective,
    });
  }

  broadcastState() {
    this.io.to('students').emit(EVENTS.STATE, {
      phase: this.phase,
      roundIndex: this.roundIndex,
      total: this.plannedRounds,
      timeLeft: this.timeLeft(),
      answered: this.round ? this.round.answers.size : 0,
      playersOnline: [...this.players.values()].filter((p) => p.connected && !p.kicked).length,
      teams: this.publicTeams(),
    });
  }

  sendSnapshotTo(p) {
    // Bring a (re)joining client up to date with the current phase. PAUSED also
    // sends the question so it sits ready (frozen) under the pause overlay.
    if ([PHASES.ROUND_ACTIVE, PHASES.PAUSED].includes(this.phase) && this.round && !p.pending) {
      this.sendRoundStartTo(p);
    }
    if (this.phase === PHASES.ROUND_REVIEW && this.lastReveal && p.socketId) {
      this.io.to(p.socketId).emit(EVENTS.ROUND_END, this.lastReveal);
    }
    if ([PHASES.SUMMARY, PHASES.REFLECTION].includes(this.phase) && p.socketId) {
      this.io.to(p.socketId).emit(EVENTS.SESSION_END, {
        teams: this.publicTeams(),
        classStats: { players: this.players.size, rounds: this.roundIndex, accuracy: classAccuracy([...this.players.values()]) },
        personal: {
          score: p.score,
          correct: p.answers.filter((a) => a.correct).length,
          answered: p.answers.length,
          bestStreak: p.bestStreak,
        },
        reflectionPrompt: this.reflectionPrompt,
      });
    }
    this.broadcastState();
  }

  startTick() {
    if (this.tick) return;
    this.tick = setInterval(() => {
      if (this.phase === PHASES.ROUND_ACTIVE) {
        this.broadcastState();
        this.pushDashboard();
      }
    }, 1000);
  }

  stopTick() {
    if (this.tick) { clearInterval(this.tick); this.tick = null; }
  }

  // ── host dashboard ─────────────────────────────────────────────────────────

  buildDashboard() {
    const roster = [...this.players.values()].filter((p) => !p.kicked).map((p) => {
      const answered = p.answers.length;
      const accuracy = answered ? p.answers.reduce((s, a) => s + a.partial, 0) / answered : null;
      const flags = [];
      if (answered >= STRUGGLER_MIN_ANSWERS && accuracy < 0.5) flags.push('struggling');
      if (this.roundIndex >= 3 && answered / this.roundIndex < 0.5) flags.push('low-participation');
      return {
        id: p.id, name: p.name, team: p.teamId,
        connected: p.connected, pending: p.pending,
        answeredThisRound: this.round ? this.round.answers.has(p.id) : false,
        score: p.score, accuracy, answered, flags,
        scaffolded: this.round ? this.round.scaffolded.has(p.id) : false,
        reflected: !!p.reflection,
      };
    });
    const online = roster.filter((r) => r.connected).length;
    const eligible = roster.filter((r) => r.connected && !r.pending).length;
    return {
      phase: this.phase,
      roundIndex: this.roundIndex,
      total: this.plannedRounds,
      timeLeft: this.timeLeft(),
      joinInfo: { url: this.joinUrl, roomCode: this.roomCode },
      packMeta: {
        packId: this.pack.packId, title: this.pack.title || '', subject: this.pack.subject,
        objective: this.pack.objective, preview: this.preview,
      },
      roster,
      class: {
        online,
        answeredPct: this.round && eligible ? Math.round((this.round.answers.size / eligible) * 100) : null,
        emaAccuracy: Math.round(this.emaAccuracy * 100) / 100,
        targetDifficulty: this.targetDifficulty,
      },
      round: this.round ? {
        content: this.shell.publicContent(this.round.item, { scaffold: false }),
        correctDisplay: this.shell.correctDisplay(this.round.item), // control view only renders this; cast never does
        difficulty: this.round.item.difficulty,
      } : null,
      reveal: this.phase === PHASES.ROUND_REVIEW ? this.lastReveal : null,
      teams: this.publicTeams(),
      reflections: [...this.players.values()].filter((p) => p.reflection).map((p) => ({ name: p.name, text: p.reflection })),
      reflectionPrompt: this.reflectionPrompt,
      reportDir: this.phase === PHASES.ENDED ? this.sessionDir : null,
    };
  }

  pushDashboard() {
    this.io.to('hosts').emit(EVENTS.HOST_DASHBOARD, this.buildDashboard());
  }

  // ── persistence ────────────────────────────────────────────────────────────

  serialize() {
    return {
      v: 1,
      packId: this.pack.packId,
      shellId: this.shell.id,
      settings: this.settings,
      preview: this.preview,
      roomCode: this.roomCode,
      phase: this.phase,
      roundIndex: this.roundIndex,
      plannedRounds: this.plannedRounds,
      emaAccuracy: this.emaAccuracy,
      targetDifficulty: this.targetDifficulty,
      usedItemIds: [...this.usedItemIds],
      teams: this.teams.map((t) => ({ id: t.id, name: t.name, color: t.color })),
      players: [...this.players.values()].map((p) => ({ ...p, socketId: null, connected: false })),
      round: this.round && [PHASES.ROUND_ACTIVE, PHASES.PAUSED].includes(this.phase)
        ? { itemId: this.round.item.id, remainingMs: this.timeLeft(), answers: [...this.round.answers.entries()], scaffolded: [...this.round.scaffolded] }
        : null,
      lastReveal: this.lastReveal || null,
    };
  }

  checkpoint() {
    store.writeCheckpoint(this.sessionDir, this.serialize());
  }

  /** Rebuild a session from a checkpoint. An interrupted round resumes PAUSED. */
  static restore(state, deps) {
    const s = new Session(deps);
    s.roundIndex = state.roundIndex;
    s.plannedRounds = state.plannedRounds;
    s.emaAccuracy = state.emaAccuracy;
    s.targetDifficulty = state.targetDifficulty;
    s.usedItemIds = new Set(state.usedItemIds);
    s.lastReveal = state.lastReveal || null;
    for (const sp of state.players) {
      s.players.set(sp.id, { ...sp, socketId: null, connected: false, answers: sp.answers || [] });
    }
    s.recomputeTeamScores();
    s.phase = state.phase;
    if (state.round) {
      const item = s.usableItems.find((it) => it.id === state.round.itemId);
      if (item) {
        s.round = {
          item,
          deadline: Date.now() + state.round.remainingMs,
          remainingMs: state.round.remainingMs,
          answers: new Map(state.round.answers),
          scaffolded: new Set(state.round.scaffolded),
          endedReason: null,
        };
        s.phase = PHASES.PAUSED; // teacher resumes when the class is ready
      } else {
        s.phase = PHASES.ROUND_REVIEW;
      }
    }
    if ([PHASES.SUMMARY, PHASES.REFLECTION].includes(state.phase)) s.phase = state.phase;
    if (state.phase === PHASES.ENDED) s.phase = PHASES.SUMMARY; // re-finish to regenerate the report
    store.appendLog(deps.sessionDir, 'session_restored', { phase: s.phase, roundIndex: s.roundIndex });
    return s;
  }
}

function classAccuracy(players) {
  const all = players.flatMap((p) => p.answers || []);
  if (!all.length) return null;
  return Math.round((all.reduce((s, a) => s + a.partial, 0) / all.length) * 100) / 100;
}

function sanitizeName(raw) {
  const s = String(raw || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24);
  return s || 'Player';
}

function cryptoRandomId() {
  return require('crypto').randomBytes(9).toString('base64url');
}

module.exports = { Session };
