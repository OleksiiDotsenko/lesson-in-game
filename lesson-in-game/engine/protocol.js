'use strict';
/**
 * The Lesson in Game event contract — the single source of truth for every message
 * exchanged between student clients, the server, and the host (teacher) views.
 *
 * Authority always rests with the server: a client `input` is a REQUEST, never
 * a state change. A lost packet self-corrects on the next `state` broadcast.
 *
 * ── student → server ────────────────────────────────────────────────────────
 * join    { room, name, resumeToken? }  ack → { ok, playerId, resumeToken, name,
 *                                               team:{id,name,color}, phase, lang,
 *                                               pending?, error? }
 * input   { type, data }                the generic gameplay envelope; the shell
 *                                       interprets `type`:
 *                                         'answer'     data per primitive:
 *                                            recall   { choice }        (ORIGINAL option index)
 *                                            estimate { value }
 *                                            + { double:true } to play the one-per-session
 *                                              double-points token (autonomy rule)
 *                                         'reflection' data { text }
 * leave   { }
 *
 * ── server → students ───────────────────────────────────────────────────────
 * lobby       { players:[{name,team}], teams, phase, lang, roomCode, joinUrl, title }
 * roundStart  { roundIndex, total, content, deadline, timeLeft, difficulty,
 *               scaffold, canDouble }              (sent PER SOCKET — scaffold differs)
 *               content is shell.publicContent(item): never contains the answer.
 * state       { phase, roundIndex, total, timeLeft, answered, playersOnline,
 *               teams:[{id,name,color,score,size}] }   (1s heartbeat + transitions)
 * feedback    { itemId, correct, partial, delta, streak, score }  (PRIVATE, per student)
 * roundEnd    { roundIndex, itemId, prompt, correctDisplay, explanation,
 *               distribution, teams }
 * sessionEnd  { teams, classStats, personal:{score,correct,answered,bestStreak},
 *               reflectionPrompt }                  (sent PER SOCKET — personal differs)
 * errorMsg    { code, message }
 *
 * ── host ↔ server ───────────────────────────────────────────────────────────
 * host:auth      { key }  ack → { ok }
 * host:control   { action, args? }  ack → { ok, error? }
 *                actions: start | pause | resume | next | reveal | reset |
 *                         kick (args:{playerId}) | end
 * host:dashboard { phase, roundIndex, total, timeLeft, joinInfo, packMeta,
 *                  roster:[{id,name,team,connected,pending,answeredThisRound,
 *                           score,accuracy,answered,flags[]}],
 *                  class:{answeredPct,emaAccuracy,online},
 *                  round:{content,correctDisplay}|null,
 *                  reveal:roundEnd|null, teams, reflections }
 * host:report    { reportDir, report }              (after the session finishes)
 */

const EVENTS = {
  JOIN: 'join',
  INPUT: 'input',
  LEAVE: 'leave',
  LOBBY: 'lobby',
  ROUND_START: 'roundStart',
  STATE: 'state',
  FEEDBACK: 'feedback',
  ROUND_END: 'roundEnd',
  SESSION_END: 'sessionEnd',
  ERROR: 'errorMsg',
  HOST_AUTH: 'host:auth',
  HOST_CONTROL: 'host:control',
  HOST_DASHBOARD: 'host:dashboard',
  HOST_REPORT: 'host:report',
};

const PHASES = {
  LOBBY: 'lobby',
  ROUND_ACTIVE: 'roundActive',
  PAUSED: 'paused',
  ROUND_REVIEW: 'roundReview',
  SUMMARY: 'summary',
  REFLECTION: 'reflection',
  ENDED: 'ended',
};

const HOST_ACTIONS = ['start', 'pause', 'resume', 'next', 'reveal', 'reset', 'kick', 'end'];

const INPUT_TYPES = { ANSWER: 'answer', REFLECTION: 'reflection' };

module.exports = { EVENTS, PHASES, HOST_ACTIONS, INPUT_TYPES };
