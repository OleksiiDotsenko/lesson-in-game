#!/usr/bin/env node
'use strict';
/**
 * The Lesson in Game runner — starts one classroom session.
 *
 *   node runner.js --pack <file-or-packId> [options]
 *
 * Options:
 *   --pack <p>        pack file path, or a packId to find in ~/lesson-in-game/packs
 *   --preview         dry-run mode: allows draft packs, spawns bots, report marked preview
 *   --bots <n>        number of dummy students in preview (default 8)
 *   --port <n>        HTTP port (default 3131)
 *   --resume <dir>    resume a checkpointed session directory
 *   --set k=v         override a shell setting (repeatable), e.g. --set rounds=6
 *                     keys: rounds, timePerRound, teams, feedbackTiming,
 *                           speedBonus, streakBonus, doublePoints, scaffolding
 *   --list            list packs in ~/lesson-in-game/packs and exit
 *
 * The review gate lives here: a live (non-preview) launch of a draft pack is
 * REFUSED. Preview of a draft is allowed — that's how a teacher tests content
 * before approving it.
 */

const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const QRCode = require('qrcode');

const store = require('./store');
const { validatePack, launchCheck } = require('./validate-pack');
const { createServer } = require('./server');
const quizArena = require('./shells/quiz-arena');

const SHELLS = { 'quiz-arena': quizArena };

function parseArgs(argv) {
  const args = { set: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--preview') args.preview = true;
    else if (a === '--list') args.list = true;
    else if (a === '--pack') args.pack = argv[++i];
    else if (a === '--bots') args.bots = parseInt(argv[++i], 10);
    else if (a === '--port') args.port = parseInt(argv[++i], 10);
    else if (a === '--resume') args.resume = argv[++i];
    else if (a === '--set') args.set.push(argv[++i]);
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function coerce(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  const n = Number(v);
  return isFinite(n) && v.trim() !== '' ? n : v;
}

function findPack(ref) {
  if (fs.existsSync(ref) && fs.statSync(ref).isFile()) return ref;
  const inHome = path.join(store.packsDir(), ref.endsWith('.json') ? ref : ref + '.json');
  if (fs.existsSync(inHome)) return inHome;
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  store.ensureDirs();

  if (args.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^[/* ]*/gm, ''));
    return;
  }

  if (args.list) {
    const dir = store.packsDir();
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
    if (!files.length) { console.log(`No packs in ${dir}`); return; }
    for (const f of files) {
      try {
        const p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        console.log(`${p.reviewStatus === 'approved' ? '✓' : '✎'} ${p.packId}  [${p.reviewStatus}]  ${p.subject} g${p.grade} · ${p.items.length} items · ${p.objective}`);
      } catch { console.log(`? ${f} (unreadable)`); }
    }
    return;
  }

  let pack = null;
  let resumeDir = null;

  if (args.resume) {
    resumeDir = path.resolve(args.resume);
    const cp = store.readCheckpoint(resumeDir);
    if (!cp) { console.error(`No checkpoint.json in ${resumeDir}`); process.exit(1); }
    const packFile = findPack(cp.packId);
    if (!packFile) { console.error(`Pack "${cp.packId}" not found in ${store.packsDir()} — cannot resume.`); process.exit(1); }
    pack = JSON.parse(fs.readFileSync(packFile, 'utf8'));
    args.preview = cp.preview;
  } else {
    if (!args.pack) {
      console.error('Usage: node runner.js --pack <file-or-packId> [--preview] [--bots N] [--port N] [--set k=v]');
      console.error('       node runner.js --list');
      process.exit(1);
    }
    const packFile = findPack(args.pack);
    if (!packFile) { console.error(`Pack not found: ${args.pack} (looked in ${store.packsDir()})`); process.exit(1); }
    pack = JSON.parse(fs.readFileSync(packFile, 'utf8'));

    const v = validatePack(pack);
    for (const w of v.warnings) console.log(`⚠ ${w}`);
    if (!v.ok) {
      console.error('✗ Pack is invalid:\n  - ' + v.errors.join('\n  - '));
      process.exit(1);
    }
    if (!args.preview) {
      const gate = launchCheck(pack);
      if (!gate.ok) { console.error(`✗ ${gate.error}`); process.exit(2); }
    }
  }

  const shell = SHELLS['quiz-arena'];
  const usable = pack.items.filter((it) => shell.supportedPrimitives.includes(it.primitive));
  if (!usable.length) {
    console.error(`✗ This pack has no items the ${shell.name} shell can play (needs: ${shell.supportedPrimitives.join(', ')}).`);
    process.exit(1);
  }

  const settings = {};
  for (const kv of args.set) {
    const [k, ...rest] = kv.split('=');
    settings[k] = coerce(rest.join('='));
  }

  const srv = await createServer({
    pack, shell, settings,
    port: args.port || 3131,
    preview: !!args.preview,
    resumeDir,
  });

  const qr = await QRCode.toString(srv.joinUrl, { type: 'terminal', small: true });
  console.log('\n' + '─'.repeat(64));
  console.log(`  LESSON IN GAME ${args.preview ? '· PREVIEW (dry-run) ' : ''}· ${shell.name}`);
  console.log(`  ${pack.title || pack.packId} — ${pack.subject}, grade ${pack.grade}`);
  console.log('─'.repeat(64));
  console.log(qr);
  console.log(`  Students join:   ${srv.joinUrl}`);
  console.log(`  Room code:       ${srv.roomCode}`);
  if (srv.lanIPs.length > 1) {
    console.log(`  Other addresses: ${srv.lanIPs.slice(1).map((i) => i.address).join(', ')}`);
  }
  console.log('');
  console.log(`  Teacher control: ${srv.hostUrl}`);
  console.log(`  Projector cast:  ${srv.castUrl}`);
  console.log('');
  console.log(`  Session data:    ${srv.sessionDir}`);
  console.log(`  Stop safely:     Ctrl+C (state is checkpointed every phase)`);
  if (resumeDir) console.log('  ↻ RESUMED — session restored paused; press Resume in the control view.');
  console.log('─'.repeat(64) + '\n');

  if (args.preview) {
    const count = args.bots || 8;
    console.log(`  Spawning ${count} bots in 2s… watch the cast view play out.\n`);
    setTimeout(() => {
      const bot = fork(path.join(__dirname, 'bots.js'), [
        '--url', `http://localhost:${srv.port}`,
        '--room', srv.roomCode,
        '--count', String(count),
      ], { stdio: 'inherit' });
      bot.on('error', (e) => console.error('bots failed:', e.message));
    }, 2000);
  }

  process.on('SIGINT', async () => {
    console.log('\nCheckpointing and shutting down…');
    try { srv.session.checkpoint(); } catch {}
    if (srv.session.phase !== 'ended') {
      console.log(`Resume later with:\n  node ${__filename} --resume "${srv.sessionDir}"`);
    }
    await srv.stop();
    process.exit(0);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
