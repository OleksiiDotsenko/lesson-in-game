'use strict';
/**
 * Content-pack validator. Implements skills/create-game/references/pack-schema.json
 * plus the cross-field rules JSON Schema cannot express (answer bounds, permutation
 * checks, category mapping bounds), with error messages a teacher can act on.
 *
 * Also the enforcement point of the review gate: `launchCheck` refuses packs
 * whose reviewStatus is not 'approved'.
 *
 * CLI:  node validate-pack.js <pack.json> [--launch]
 *   exit 0 = valid (and approved, if --launch), 1 = invalid, 2 = valid but not approved
 */

const PRIMITIVES = ['recall', 'classify', 'sequence', 'locate', 'estimate', 'argue', 'simulate'];
const BLOOM = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];

// Which primitives can plausibly serve which Bloom bands (Kapp guard, warning-level).
const BLOOM_PRIMITIVES = {
  remember: ['recall'],
  understand: ['classify', 'sequence', 'recall'],
  apply: ['sequence', 'locate', 'estimate', 'simulate'],
  analyze: ['classify', 'estimate', 'simulate'],
  evaluate: ['argue'],
  create: ['simulate'],
};

function validatePack(pack) {
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);

  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) {
    return { ok: false, errors: ['The pack file is not a JSON object.'], warnings };
  }

  // ── top-level fields ──
  if (typeof pack.packId !== 'string' || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(pack.packId)) {
    err(`packId must be a short slug of lowercase letters, digits and dashes (got ${JSON.stringify(pack.packId)}).`);
  }
  if (typeof pack.subject !== 'string' || !pack.subject.trim()) err('subject is missing.');
  if (!(Number.isInteger(pack.grade) || (typeof pack.grade === 'string' && pack.grade.trim()))) {
    err('grade must be a number (e.g. 8) or a short string (e.g. "8-A").');
  }
  if (typeof pack.language !== 'string' || !/^[a-z]{2}(-[A-Z]{2})?$/.test(pack.language)) {
    err(`language must be a two-letter code like "uk" or "en" (got ${JSON.stringify(pack.language)}).`);
  }
  if (typeof pack.objective !== 'string' || !pack.objective.trim()) err('objective is missing — state what students should be able to do.');
  if (!BLOOM.includes(pack.bloom)) err(`bloom must be one of ${BLOOM.join(', ')} (got ${JSON.stringify(pack.bloom)}).`);
  if (!Array.isArray(pack.primitives) || pack.primitives.length === 0) {
    err('primitives must be a non-empty list.');
  } else {
    for (const p of pack.primitives) if (!PRIMITIVES.includes(p)) err(`Unknown primitive ${JSON.stringify(p)}. Valid: ${PRIMITIVES.join(', ')}.`);
    if (new Set(pack.primitives).size !== pack.primitives.length) err('primitives contains duplicates.');
  }
  if (!['draft', 'approved'].includes(pack.reviewStatus)) {
    err(`reviewStatus must be "draft" or "approved" (got ${JSON.stringify(pack.reviewStatus)}).`);
  }
  if (pack.reviewStatus === 'approved' && !pack.approvedAt) {
    warn('Pack is approved but has no approvedAt timestamp — approve through the review flow so the approval is recorded.');
  }

  // Kapp guard: the declared Bloom band should be servable by at least one declared primitive.
  if (BLOOM.includes(pack.bloom) && Array.isArray(pack.primitives)) {
    const fit = pack.primitives.some((p) => (BLOOM_PRIMITIVES[pack.bloom] || []).includes(p));
    if (!fit && pack.primitives.every((p) => PRIMITIVES.includes(p))) {
      warn(`Objective is at the "${pack.bloom}" level but the chosen primitives (${pack.primitives.join(', ')}) don't naturally exercise it — the game may test something easier than the lesson objective (structural-gamification trap).`);
    }
  }

  // ── items ──
  if (!Array.isArray(pack.items) || pack.items.length === 0) {
    err('items must be a non-empty list.');
    return { ok: errors.length === 0, errors, warnings };
  }

  const seenIds = new Set();
  pack.items.forEach((item, idx) => {
    const label = `Item ${item && item.id ? item.id : '#' + (idx + 1)}`;
    if (!item || typeof item !== 'object') { err(`${label}: not an object.`); return; }
    if (typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(item.id)) err(`${label}: id must be a short alphanumeric string.`);
    if (seenIds.has(item.id)) err(`${label}: duplicate item id.`);
    seenIds.add(item.id);
    if (!PRIMITIVES.includes(item.primitive)) { err(`${label}: unknown primitive ${JSON.stringify(item.primitive)}.`); return; }
    if (Array.isArray(pack.primitives) && !pack.primitives.includes(item.primitive)) {
      warn(`${label}: uses primitive "${item.primitive}" which is not declared in the pack's primitives list.`);
    }
    if (typeof item.prompt !== 'string' || item.prompt.trim().length < 3) err(`${label}: prompt is missing or too short.`);
    if (!Number.isInteger(item.difficulty) || item.difficulty < 1 || item.difficulty > 5) {
      err(`${label}: difficulty must be an integer 1–5 (got ${JSON.stringify(item.difficulty)}).`);
    }
    if (item.tags !== undefined && (!Array.isArray(item.tags) || item.tags.some((t) => typeof t !== 'string'))) {
      err(`${label}: tags must be a list of strings.`);
    }

    switch (item.primitive) {
      case 'recall': {
        if (!Array.isArray(item.options) || item.options.length < 2 || item.options.length > 6) {
          err(`${label}: recall needs 2–6 options (got ${Array.isArray(item.options) ? item.options.length : 'none'}).`);
        } else {
          if (item.options.some((o) => typeof o !== 'string' || !o.trim())) err(`${label}: every option must be non-empty text.`);
          if (new Set(item.options.map((o) => String(o).trim().toLowerCase())).size !== item.options.length) {
            warn(`${label}: options contain duplicates — students may pick the "wrong" copy of the right answer.`);
          }
          if (!Number.isInteger(item.answer) || item.answer < 0 || item.answer >= item.options.length) {
            err(`${label}: the correct answer index ${JSON.stringify(item.answer)} is outside the options list (valid: 0–${item.options.length - 1}).`);
          }
        }
        if (typeof item.explanation !== 'string' || !item.explanation.trim()) {
          err(`${label}: explanation is required — it is what students see at round review (feedback rule).`);
        }
        break;
      }
      case 'estimate': {
        if (typeof item.numericAnswer !== 'number' || !isFinite(item.numericAnswer)) err(`${label}: numericAnswer must be a number.`);
        if (typeof item.tolerance !== 'number' || !(item.tolerance > 0)) err(`${label}: tolerance must be a positive number (full credit within ±tolerance).`);
        if (item.min !== undefined && typeof item.min !== 'number') err(`${label}: min must be a number.`);
        if (item.max !== undefined && typeof item.max !== 'number') err(`${label}: max must be a number.`);
        if (typeof item.min === 'number' && typeof item.max === 'number' && item.min >= item.max) err(`${label}: min must be below max.`);
        if (typeof item.explanation !== 'string' || !item.explanation.trim()) {
          err(`${label}: explanation is required — it is what students see at round review (feedback rule).`);
        }
        break;
      }
      case 'classify': {
        if (!Array.isArray(item.elements) || item.elements.length < 2) err(`${label}: classify needs at least 2 elements.`);
        if (!Array.isArray(item.categories) || item.categories.length < 2) err(`${label}: classify needs at least 2 categories.`);
        if (!Array.isArray(item.mapping) || (Array.isArray(item.elements) && item.mapping.length !== item.elements.length)) {
          err(`${label}: mapping must assign a category to every element (one entry per element).`);
        } else if (Array.isArray(item.categories) && item.mapping.some((m) => !Number.isInteger(m) || m < 0 || m >= item.categories.length)) {
          err(`${label}: mapping contains a category index outside 0–${item.categories.length - 1}.`);
        }
        break;
      }
      case 'sequence': {
        if (!Array.isArray(item.elements) || item.elements.length < 2) err(`${label}: sequence needs at least 2 elements.`);
        if (!Array.isArray(item.answer)) {
          err(`${label}: answer must list the element indexes in correct order.`);
        } else if (Array.isArray(item.elements)) {
          const n = item.elements.length;
          const sorted = [...item.answer].sort((a, b) => a - b);
          const isPerm = item.answer.length === n && sorted.every((v, i) => v === i);
          if (!isPerm) err(`${label}: answer must be a permutation of 0–${n - 1}, using each index exactly once.`);
        }
        break;
      }
      case 'locate': {
        if (typeof item.board !== 'string' || !item.board.trim()) err(`${label}: locate needs a board name.`);
        if (!Array.isArray(item.targets) || item.targets.length < 1) {
          err(`${label}: locate needs at least one target.`);
        } else {
          item.targets.forEach((t, ti) => {
            if (!t || typeof t.label !== 'string' || typeof t.x !== 'number' || typeof t.y !== 'number') {
              err(`${label}: target #${ti + 1} needs label, x and y.`);
            } else if (t.x < 0 || t.x > 1 || t.y < 0 || t.y > 1) {
              err(`${label}: target "${t.label}" coordinates must be fractions 0–1 of the board.`);
            }
          });
        }
        break;
      }
      case 'argue': {
        if (!Array.isArray(item.positions) || item.positions.length < 2) err(`${label}: argue needs at least 2 positions.`);
        break;
      }
      case 'simulate': {
        if (!item.parameters || typeof item.parameters !== 'object') err(`${label}: simulate needs a parameters object.`);
        if (typeof item.model !== 'string' || !item.model.trim()) err(`${label}: simulate needs a model reference.`);
        break;
      }
    }
  });

  // Enough material for a session? (adaptivity needs headroom)
  const gradeable = pack.items.filter((i) => ['recall', 'estimate', 'classify', 'sequence', 'locate'].includes(i && i.primitive));
  if (gradeable.length > 0 && gradeable.length < 6) {
    warn(`Only ${gradeable.length} gradeable items — adaptive difficulty works best with 8+ so the engine has choices at each level.`);
  }
  const diffs = new Set(pack.items.map((i) => i && i.difficulty).filter(Boolean));
  if (pack.items.length >= 6 && diffs.size === 1) {
    warn('All items share one difficulty level — adaptive difficulty will have nothing to adapt with. Spread items across 2–4 levels.');
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** The review gate. Returns { ok, error? }. */
function launchCheck(pack) {
  const v = validatePack(pack);
  if (!v.ok) return { ok: false, error: 'Pack is invalid:\n  - ' + v.errors.join('\n  - ') };
  if (pack.reviewStatus !== 'approved') {
    return {
      ok: false,
      notApproved: true,
      error: `Pack "${pack.packId}" is still in draft. A subject expert must review and approve the content before it goes live (run the review step). Preview mode (--preview) is allowed for drafts.`,
    };
  }
  return { ok: true };
}

module.exports = { validatePack, launchCheck, PRIMITIVES, BLOOM, BLOOM_PRIMITIVES };

if (require.main === module) {
  const fs = require('fs');
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const launch = args.includes('--launch');
  if (!file) {
    console.error('Usage: node validate-pack.js <pack.json> [--launch]');
    process.exit(1);
  }
  let pack;
  try {
    pack = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`Could not read ${file}: ${e.message}`);
    process.exit(1);
  }
  const v = validatePack(pack);
  for (const w of v.warnings) console.log(`⚠ ${w}`);
  if (!v.ok) {
    for (const e of v.errors) console.error(`✗ ${e}`);
    console.error(`\nPack is INVALID (${v.errors.length} error${v.errors.length > 1 ? 's' : ''}).`);
    process.exit(1);
  }
  console.log(`✓ Pack "${pack.packId}" is valid. ${pack.items.length} items, primitives: ${pack.primitives.join(', ')}, reviewStatus: ${pack.reviewStatus}.`);
  if (launch) {
    const g = launchCheck(pack);
    if (!g.ok) {
      console.error(`✗ ${g.error}`);
      process.exit(2);
    }
    console.log('✓ Approved for launch.');
  }
  process.exit(0);
}
