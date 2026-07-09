#!/usr/bin/env node
'use strict';
/**
 * One-time setup: copy the engine to ~/ludus/engine and install dependencies.
 *
 * Why copy? Installed plugins can live in read-only locations; the data home is
 * always writable, keeps node_modules out of the plugin, and gives every skill
 * one predictable path to run from. Re-running setup safely refreshes the copy
 * (your packs/sessions/reports are never touched).
 *
 *   node setup.js [--no-copy]   # --no-copy: npm install in place instead
 *
 * Internet is needed ONCE here (npm). Running a class needs none.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const store = require('./store');

const args = process.argv.slice(2);
const noCopy = args.includes('--no-copy');
const src = __dirname;
const dest = noCopy ? src : path.join(store.dataHome(), 'engine');

store.ensureDirs();

if (!noCopy) {
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, {
    recursive: true,
    filter: (p) => !p.includes('node_modules') && !p.endsWith('.log'),
  });
  console.log(`✓ Engine copied to ${dest}`);
}

console.log('Installing dependencies (one-time, needs internet)…');
try {
  execSync('npm install --no-fund --no-audit --loglevel=error', { cwd: dest, stdio: 'inherit' });
} catch (e) {
  console.error('\n✗ npm install failed. Check your internet connection and re-run:');
  console.error(`    node "${path.join(dest, 'setup.js')}" --no-copy`);
  process.exit(1);
}

console.log('\n✓ Ludus engine is ready.');
console.log(`  Data home:  ${store.dataHome()}  (packs/, sessions/, reports/)`);
console.log(`  Runner:     node "${path.join(dest, 'runner.js')}" --pack <packId> [--preview]`);
console.log('  Run a class fully offline from here on.');
