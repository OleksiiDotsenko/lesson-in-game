'use strict';
/**
 * Quiz Arena — the Phase 1 shell. Recall + estimate primitives, team scoring,
 * class-level adaptive difficulty, private per-student scaffolding.
 *
 * Rulebook guarantees this shell carries by construction:
 *   SDT autonomy     — the one-per-session double-points token (student chooses when)
 *   SDT competence   — private progress/streak + adaptive difficulty + scaffolding
 *   SDT relatedness  — team scoring is the default frame (teams >= 1)
 *   Flow             — immediate private feedback; difficulty tracks the class edge
 *   HEXAD            — never leaderboard-only: progress + team + reflection always on
 *   RECIPE           — white-hat defaults: no speed bonus unless the teacher opts in;
 *                      reflection prompt always shown at session end
 *   Inclusion        — feedback is private; the cast screen shows teams and anonymous
 *                      answer distributions, never an individual's mistake
 */

const SPEED_BONUS_MAX = 50;
const STREAK_BONUS_STEP = 10;
const STREAK_BONUS_CAP = 5;

module.exports = {
  id: 'quiz-arena',
  name: 'Quiz Arena',
  supportedPrimitives: ['recall', 'estimate'],

  defaultSettings: {
    rounds: 8,             // planned rounds (capped by usable items)
    timePerRound: 30,      // seconds
    teams: 2,              // 1 = whole-class co-op score
    feedbackTiming: 'immediate', // 'immediate' | 'review'
    speedBonus: false,     // black-hat tunable — off by default (RECIPE)
    streakBonus: true,     // small mastery signal
    doublePoints: true,    // the autonomy token
    scaffolding: true,     // private support for struggling students
  },

  /**
   * The content a student is allowed to see for this item. NEVER includes the
   * answer. `scaffold` personalises it privately:
   *   recall   → one wrong option removed (options keep ORIGINAL indexes)
   *   estimate → a "somewhere between X and Y" hint
   */
  publicContent(item, { scaffold = false } = {}) {
    const base = { itemId: item.id, primitive: item.primitive, prompt: item.prompt };
    if (item.primitive === 'recall') {
      let options = item.options.map((text, i) => ({ i, text }));
      if (scaffold && options.length > 2) {
        // Deterministic per item so a re-sent roundStart (reconnect) matches:
        // drop the last wrong option.
        const wrong = options.filter((o) => o.i !== item.answer);
        const drop = wrong[wrong.length - 1].i;
        options = options.filter((o) => o.i !== drop);
      }
      return { ...base, options, scaffolded: scaffold && item.options.length > 2 };
    }
    if (item.primitive === 'estimate') {
      const c = { ...base, unit: item.unit || null, min: item.min ?? null, max: item.max ?? null };
      if (scaffold) {
        const span = 5 * item.tolerance;
        c.hintRange = { lo: round2(item.numericAnswer - span), hi: round2(item.numericAnswer + span) };
        c.scaffolded = true;
      }
      return c;
    }
    return base;
  },

  /**
   * Score one answer. Returns { correct, partial (0|0.5|1), delta } — the session
   * applies the double-points token on top and owns all state.
   */
  score(item, data, { timeLeftFrac = 0, settings, streakBefore = 0 } = {}) {
    let partial = 0;
    if (item.primitive === 'recall') {
      partial = data && Number.isInteger(data.choice) && data.choice === item.answer ? 1 : 0;
    } else if (item.primitive === 'estimate') {
      const v = data ? Number(data.value) : NaN;
      if (isFinite(v)) {
        const d = Math.abs(v - item.numericAnswer);
        partial = d <= item.tolerance ? 1 : d <= 2 * item.tolerance ? 0.5 : 0;
      }
    }
    const correct = partial === 1;
    let delta = Math.round(100 * partial);
    if (correct && settings.streakBonus) {
      delta += STREAK_BONUS_STEP * Math.min(streakBefore + 1, STREAK_BONUS_CAP);
    }
    if (correct && settings.speedBonus) {
      delta += Math.round(SPEED_BONUS_MAX * Math.max(0, Math.min(1, timeLeftFrac)));
    }
    return { correct, partial, delta };
  },

  /** Human display of the correct answer for the review screen. */
  correctDisplay(item) {
    if (item.primitive === 'recall') return item.options[item.answer];
    if (item.primitive === 'estimate') {
      return `${item.numericAnswer}${item.unit ? ' ' + item.unit : ''} (±${item.tolerance})`;
    }
    return '';
  },

  /**
   * Anonymous class-answer distribution for the review screen (inclusion rule:
   * aggregates only, never names).
   */
  distribution(item, answers) {
    if (item.primitive === 'recall') {
      const counts = item.options.map((text, i) => ({ i, text, count: 0 }));
      for (const a of answers) {
        if (a.data && Number.isInteger(a.data.choice) && counts[a.data.choice]) counts[a.data.choice].count++;
      }
      return { kind: 'options', counts, answerIndex: item.answer };
    }
    if (item.primitive === 'estimate') {
      let within = 0, close = 0, far = 0;
      const values = [];
      for (const a of answers) {
        const v = a.data ? Number(a.data.value) : NaN;
        if (!isFinite(v)) continue;
        values.push(v);
        const d = Math.abs(v - item.numericAnswer);
        if (d <= item.tolerance) within++;
        else if (d <= 2 * item.tolerance) close++;
        else far++;
      }
      values.sort((a, b) => a - b);
      const median = values.length ? values[Math.floor(values.length / 2)] : null;
      return { kind: 'buckets', within, close, far, median };
    }
    return { kind: 'none' };
  },
};

function round2(n) { return Math.round(n * 100) / 100; }
