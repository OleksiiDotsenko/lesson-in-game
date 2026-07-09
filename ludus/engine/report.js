'use strict';
/**
 * Post-game diagnostic report — the formative-assessment payoff.
 *
 * Compiled from session state at the natural end of a match, or reconstructed
 * from log.jsonl (`compileFromLog`) if the session died mid-flight. Outputs:
 *   report.json    machine-readable (feeds the next create-game interview)
 *   report.md      the teacher's one-pager
 *   students.csv   per-student rows for the teacher's records
 *
 * Four sections, per the concept doc: misconception map, silent-struggler
 * flags, mastery by objective, engagement distribution. Individual flags are
 * teacher-only — nothing here is ever broadcast to students.
 */

const fs = require('fs');
const path = require('path');
const store = require('./store');

function compileFromSession(session) {
  const players = [...session.players.values()].filter((p) => !p.kicked);
  const items = session.pack.items.filter((it) => session.usedItemIds.has(it.id));
  return compile({
    pack: session.pack,
    shellId: session.shell.id,
    preview: session.preview,
    roundsPlayed: session.roundIndex,
    players: players.map((p) => ({
      name: p.name, team: p.teamId, score: p.score,
      answers: p.answers, reflection: p.reflection,
    })),
    items,
    teams: session.publicTeams(),
  });
}

/** Rebuild the same inputs from log.jsonl (crash recovery / CLI). */
function compileFromLog(sessionDir, pack) {
  const log = store.readLog(sessionDir);
  const players = new Map();
  const usedItemIds = new Set();
  let roundsPlayed = 0;
  let preview = false;
  for (const e of log) {
    if (e.ev === 'session_created') preview = !!e.preview;
    if (e.ev === 'join' && !players.has(e.playerId)) {
      players.set(e.playerId, { name: e.name, team: e.team, score: 0, answers: [], reflection: null });
    }
    if (e.ev === 'round_start') { usedItemIds.add(e.itemId); roundsPlayed = Math.max(roundsPlayed, e.roundIndex); }
    if (e.ev === 'round_reset') {
      for (const p of players.values()) {
        const dropped = p.answers.filter((a) => a.itemId === e.itemId);
        for (const d of dropped) p.score -= d.delta;
        p.answers = p.answers.filter((a) => a.itemId !== e.itemId);
      }
    }
    if (e.ev === 'answer') {
      const p = players.get(e.playerId);
      if (p) {
        p.answers.push({ itemId: e.itemId, roundIndex: e.roundIndex, correct: e.correct, partial: e.partial, delta: e.delta, ms: e.ms, double: e.double, scaffold: e.scaffold });
        p.score += e.delta;
      }
    }
    if (e.ev === 'reflection') {
      const p = players.get(e.playerId);
      if (p) p.reflection = e.text;
    }
  }
  const items = pack.items.filter((it) => usedItemIds.has(it.id));
  return compile({
    pack, shellId: 'quiz-arena', preview, roundsPlayed,
    players: [...players.values()], items, teams: [],
  });
}

function compile({ pack, shellId, preview, roundsPlayed, players, items, teams }) {
  const allAnswers = players.flatMap((p) => p.answers.map((a) => ({ ...a, player: p.name })));

  // Per-item stats.
  const perItem = items.map((it) => {
    const answers = allAnswers.filter((a) => a.itemId === it.id);
    const answered = answers.length;
    const accuracy = answered ? sum(answers.map((a) => a.partial)) / answered : null;
    return {
      id: it.id,
      prompt: it.prompt,
      primitive: it.primitive,
      difficulty: it.difficulty,
      tags: it.tags || [],
      answered,
      accuracy: roundPct(accuracy),
      avgSeconds: answered ? Math.round(sum(answers.map((a) => a.ms || 0)) / answered / 100) / 10 : null,
    };
  });

  // Misconception map: weakest items + weakest tags (what to reteach).
  const weakItems = perItem
    .filter((i) => i.answered >= 2 && i.accuracy !== null && i.accuracy < 60)
    .sort((a, b) => a.accuracy - b.accuracy);
  const tagStats = {};
  for (const it of perItem) {
    for (const tag of it.tags) {
      if (it.accuracy === null) continue;
      (tagStats[tag] = tagStats[tag] || { tag, items: 0, accSum: 0, answered: 0 }).items++;
      tagStats[tag].accSum += it.accuracy;
      tagStats[tag].answered += it.answered;
    }
  }
  const byTag = Object.values(tagStats)
    .map((t) => ({ tag: t.tag, items: t.items, accuracy: Math.round(t.accSum / t.items), answered: t.answered }))
    .sort((a, b) => a.accuracy - b.accuracy);
  const weakTags = byTag.filter((t) => t.accuracy < 60 && t.answered >= 2);

  // Per-student rows + flags (teacher-only).
  const perStudent = players.map((p) => {
    const answered = p.answers.length;
    const accuracy = answered ? sum(p.answers.map((a) => a.partial)) / answered : null;
    const participation = roundsPlayed ? answered / roundsPlayed : null;
    const flags = [];
    if (answered >= 3 && accuracy !== null && accuracy < 0.5) flags.push('struggling');
    if (roundsPlayed >= 3 && participation !== null && participation < 0.5) flags.push('low-participation');
    if (answered >= 3 && accuracy !== null && accuracy >= 0.9) flags.push('ready-for-more');
    return {
      name: p.name, team: p.team, score: p.score, answered, roundsPlayed,
      accuracy: roundPct(accuracy), participation: roundPct(participation),
      scaffolded: p.answers.some((a) => a.scaffold), flags,
      reflection: p.reflection || null,
    };
  }).sort((a, b) => (a.name > b.name ? 1 : -1));

  const strugglers = perStudent.filter((s) => s.flags.includes('struggling') || s.flags.includes('low-participation'));

  // Mastery vs the stated objective.
  const overall = allAnswers.length ? sum(allAnswers.map((a) => a.partial)) / allAnswers.length : null;
  const mastery = {
    objective: pack.objective,
    bloom: pack.bloom,
    overallAccuracy: roundPct(overall),
    verdict: overall === null ? 'no-data'
      : overall >= 0.8 ? 'landed'
      : overall >= 0.6 ? 'partial'
      : 'needs-reteach',
    byTag,
  };

  // Engagement: was participation broad or captured by a few?
  const parts = perStudent.map((s) => s.participation).filter((v) => v !== null);
  const meanPart = parts.length ? sum(parts) / parts.length : null;
  const spread = parts.length > 1 ? Math.sqrt(sum(parts.map((v) => (v - meanPart) ** 2)) / parts.length) : 0;
  const engagement = {
    players: players.length,
    meanParticipation: meanPart === null ? null : Math.round(meanPart),
    spread: Math.round(spread),
    lowParticipants: perStudent.filter((s) => s.flags.includes('low-participation')).length,
    breadth: meanPart === null ? 'no-data' : spread <= 20 && meanPart >= 70 ? 'broad' : spread > 35 ? 'captured-by-few' : 'mixed',
  };

  // Recommendations that seed the next interview.
  const recommendations = [];
  for (const t of weakTags.slice(0, 2)) {
    recommendations.push(`Reteach "${t.tag}" — class accuracy was ${t.accuracy}% across ${t.items} item(s).`);
  }
  for (const i of weakItems.slice(0, 2)) {
    if (!i.tags.some((tag) => weakTags.slice(0, 2).some((t) => t.tag === tag))) {
      recommendations.push(`Revisit: "${i.prompt}" (${i.accuracy}% correct).`);
    }
  }
  if (strugglers.length) {
    recommendations.push(`Check in privately with ${strugglers.length} student(s) flagged below — quietly falling behind is invisible in a normal lesson.`);
  }
  if (engagement.breadth === 'captured-by-few') {
    recommendations.push('Participation was uneven — consider a co-op format or smaller teams next time.');
  }
  if (mastery.verdict === 'landed') {
    recommendations.push('The objective landed — the next lesson can build on it rather than repeat it.');
  }

  return {
    generatedAt: new Date().toISOString(),
    pack: { packId: pack.packId, title: pack.title || '', subject: pack.subject, grade: pack.grade, objective: pack.objective, bloom: pack.bloom, language: pack.language },
    shell: shellId,
    preview,
    roundsPlayed,
    teams,
    misconceptions: { weakItems, weakTags },
    perItem,
    perStudent,
    strugglers: strugglers.map((s) => ({ name: s.name, flags: s.flags, accuracy: s.accuracy, participation: s.participation })),
    mastery,
    engagement,
    reflections: perStudent.filter((s) => s.reflection).map((s) => ({ name: s.name, text: s.reflection })),
    recommendations,
  };
}

function renderMarkdown(r) {
  const L = [];
  L.push(`# Game report — ${r.pack.title || r.pack.packId}`);
  L.push('');
  L.push(`**Subject:** ${r.pack.subject} · **Grade:** ${r.pack.grade} · **Objective:** ${r.pack.objective}`);
  L.push(`**Rounds played:** ${r.roundsPlayed} · **Students:** ${r.engagement.players}${r.preview ? ' · **PREVIEW RUN (bots)**' : ''}`);
  L.push('');
  L.push('## Did the objective land?');
  const verdictText = {
    landed: '✅ Landed', partial: '🟡 Partially — worth a follow-up', 'needs-reteach': '🔴 Needs reteaching', 'no-data': 'No data',
  }[r.mastery.verdict];
  L.push(`${verdictText} — overall accuracy ${fmtPct(r.mastery.overallAccuracy)}.`);
  L.push('');
  L.push('## Misconception map (reteach these first)');
  if (!r.misconceptions.weakTags.length && !r.misconceptions.weakItems.length) {
    L.push('No collective weak spots — nothing fell below 60% accuracy.');
  } else {
    for (const t of r.misconceptions.weakTags) L.push(`- **${t.tag}** — ${t.accuracy}% across ${t.items} item(s)`);
    for (const i of r.misconceptions.weakItems.slice(0, 5)) L.push(`- "${i.prompt}" — ${i.accuracy}% correct (${i.answered} answers)`);
  }
  L.push('');
  L.push('## Silent-struggler flags (teacher-only — handle privately)');
  if (!r.strugglers.length) L.push('Nobody flagged.');
  for (const s of r.strugglers) {
    L.push(`- **${s.name}** — accuracy ${fmtPct(s.accuracy)}, participation ${fmtPct(s.participation)} (${s.flags.join(', ')})`);
  }
  L.push('');
  L.push('## Engagement');
  L.push(`Participation was **${r.engagement.breadth}** — mean ${fmtPct(r.engagement.meanParticipation)}, spread ±${r.engagement.spread}pp, ${r.engagement.lowParticipants} low participant(s).`);
  L.push('');
  L.push('## Item results');
  L.push('| # | Prompt | Difficulty | Answered | Accuracy | Avg time |');
  L.push('|---|---|---|---|---|---|');
  r.perItem.forEach((i, n) => {
    L.push(`| ${n + 1} | ${i.prompt.replace(/\|/g, '\\|')} | ${i.difficulty} | ${i.answered} | ${fmtPct(i.accuracy)} | ${i.avgSeconds ?? '—'}s |`);
  });
  L.push('');
  if (r.reflections.length) {
    L.push('## Student reflections');
    for (const f of r.reflections) L.push(`- **${f.name}:** ${f.text}`);
    L.push('');
  }
  L.push('## What to do next');
  if (!r.recommendations.length) L.push('Nothing urgent — play on.');
  for (const rec of r.recommendations) L.push(`- ${rec}`);
  L.push('');
  L.push(`*Generated ${r.generatedAt}. Data stayed on this machine.*`);
  return L.join('\n');
}

function renderCsv(r) {
  const rows = [['name', 'team', 'score', 'answered', 'rounds', 'accuracy_pct', 'participation_pct', 'flags']];
  for (const s of r.perStudent) {
    rows.push([s.name, s.team, s.score, s.answered, s.roundsPlayed, s.accuracy ?? '', s.participation ?? '', s.flags.join(';')]);
  }
  return rows.map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
}

function writeReport(sessionDir, report, { preview = false } = {}) {
  fs.writeFileSync(path.join(sessionDir, 'report.json'), JSON.stringify(report, null, 2));
  const md = renderMarkdown(report);
  fs.writeFileSync(path.join(sessionDir, 'report.md'), md);
  fs.writeFileSync(path.join(sessionDir, 'students.csv'), renderCsv(report));
  if (!preview) {
    store.ensureDirs();
    fs.writeFileSync(path.join(store.reportsDir(), path.basename(sessionDir) + '.md'), md);
  }
  return {
    json: path.join(sessionDir, 'report.json'),
    md: path.join(sessionDir, 'report.md'),
    csv: path.join(sessionDir, 'students.csv'),
  };
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const roundPct = (v) => (v === null || v === undefined ? null : Math.round(v * 100));
const fmtPct = (v) => (v === null || v === undefined ? '—' : `${v}%`);
const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

module.exports = { compileFromSession, compileFromLog, writeReport, renderMarkdown };

if (require.main === module) {
  // CLI: node report.js <sessionDir> <pack.json>  — recompile a report from the log.
  const [dir, packFile] = process.argv.slice(2);
  if (!dir || !packFile) {
    console.error('Usage: node report.js <sessionDir> <pack.json>');
    process.exit(1);
  }
  const pack = JSON.parse(fs.readFileSync(packFile, 'utf8'));
  const report = compileFromLog(dir, pack);
  const files = writeReport(dir, report, { preview: report.preview });
  console.log(`Report written:\n  ${files.md}\n  ${files.json}\n  ${files.csv}`);
}
