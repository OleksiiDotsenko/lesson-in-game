'use strict';
/**
 * Data home: everything Lesson in Game persists lives under ~/lesson-in-game (override: $LESSON_IN_GAME_HOME).
 * Local-first by design — student data never leaves this machine.
 *
 *   ~/lesson-in-game/packs/      content packs (draft + approved)
 *   ~/lesson-in-game/sessions/   one directory per session: log.jsonl, checkpoint.json, report.*
 *   ~/lesson-in-game/reports/    convenience copies of report.md for browsing
 */

const os = require('os');
const fs = require('fs');
const path = require('path');

function dataHome() {
  return process.env.LESSON_IN_GAME_HOME || path.join(os.homedir(), 'lesson-in-game');
}

function ensureDirs() {
  for (const d of ['packs', 'sessions', 'reports']) {
    fs.mkdirSync(path.join(dataHome(), d), { recursive: true });
  }
  return dataHome();
}

function packsDir() { return path.join(dataHome(), 'packs'); }
function sessionsDir() { return path.join(dataHome(), 'sessions'); }
function reportsDir() { return path.join(dataHome(), 'reports'); }

/** Create a fresh session directory, named so directory listings sort by time. */
function newSessionDir(packId, { preview = false } = {}) {
  ensureDirs();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const name = `${preview ? 'preview-' : ''}${stamp}-${packId}`;
  const dir = path.join(sessionsDir(), name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Append one event to the session's JSONL log (the analytics source of truth). */
function appendLog(sessionDir, ev, payload = {}) {
  const line = JSON.stringify({ t: Date.now(), ev, ...payload }) + '\n';
  fs.appendFileSync(path.join(sessionDir, 'log.jsonl'), line);
}

function readLog(sessionDir) {
  const file = path.join(sessionDir, 'log.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

/** Atomic checkpoint write — a crash mid-write must not corrupt the resume file. */
function writeCheckpoint(sessionDir, state) {
  const file = path.join(sessionDir, 'checkpoint.json');
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
}

function readCheckpoint(sessionDir) {
  const file = path.join(sessionDir, 'checkpoint.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** List sessions, newest first. */
function listSessions({ includePreviews = false } = {}) {
  ensureDirs();
  return fs.readdirSync(sessionsDir())
    .filter((n) => includePreviews || !n.startsWith('preview-'))
    .sort()
    .reverse()
    .map((n) => path.join(sessionsDir(), n));
}

module.exports = {
  dataHome, ensureDirs, packsDir, sessionsDir, reportsDir,
  newSessionDir, appendLog, readLog, writeCheckpoint, readCheckpoint, listSessions,
};
