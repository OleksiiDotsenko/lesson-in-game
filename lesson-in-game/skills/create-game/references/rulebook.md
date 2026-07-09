# The framework rulebook (the invisible layer)

Every design framework is compiled here into concrete rules. **The teacher never
reads this and is never asked about it.** They experience the rules only as "the
game it made happens to work well." Your job while building a pack and choosing
settings is to satisfy every rule automatically.

Each rule names its enforcement point:
- **[design]** — you enforce it now, while writing the pack and settings.
- **[engine]** — the runtime already guarantees it; you just must not disable it.

## Self-Determination Theory (Deci & Ryan) — the motivational spine

- **Autonomy** — every game must contain at least one real student choice.
  **[engine]** Quiz Arena gives each student a once-per-session ×2 "double
  points" token they choose when to spend. That satisfies autonomy on its own.
  **[design]** Prefer question banks with some independent items so order isn't
  strictly forced.
- **Competence** — visible individual progress + adaptive difficulty.
  **[engine]** Private score, streak, and per-student scaffolding are built in;
  difficulty adapts to the class's live accuracy. **[design]** Give items a
  spread of `difficulty` (1–5) so adaptation has somewhere to go. A pack where
  every item is difficulty 3 defeats this.
- **Relatedness** — at least one cooperative element.
  **[engine]** Team scoring is the default frame (teams average their members'
  scores, so no one is dead weight). **[design]** Keep `teams` ≥ 2 unless the
  teacher explicitly wants a whole-class co-op score (`teams: 1`).

## Flow (Csikszentmihalyi)

- Difficulty tracks the class's live accuracy — impossible on paper, native here.
  **[engine]** **[design]** spread item difficulty.
- Every task has a clear goal and immediate feedback. **[engine]** Feedback is
  private and immediate by default. **[design]** Every recall/estimate item needs
  an `explanation` — it's what the student sees at the reveal.

## HEXAD (Marczewski) — don't build for only one player type

- **Never** a leaderboard-only game — that serves Achievers and Players while
  alienating Socialisers and Free Spirits. **[engine]** Quiz Arena always mixes
  progress (mastery) + teams (social) + the choice token (autonomy) + reflection
  (purpose). You cannot accidentally emit a leaderboard-only design with this
  shell, which is *why the shell is safe*. **[design]** Don't turn teams off AND
  frame everything as ranking.

## RECIPE / meaningful gamification (Nicholson)

- Every session ends with a **mandatory reflection** moment. **[engine]** The
  reflection screen always fires at session end. **[design]** You may set a
  lesson-specific `reflectionPrompt` in the pack; otherwise a good default is
  used. Make it open and thought-provoking ("which answer surprised you?"), not
  a quiz.
- Reward economy defaults to **white-hat** (progress, mastery, meaning).
  Black-hat drivers (time pressure, scarcity, loss) are **opt-in**, never default.
  **[engine]** `speedBonus` is OFF by default. **[design]** Only enable time
  pressure if the teacher explicitly wants energy/competition, and tell them
  plainly that's what you're turning on.

## Structural vs content gamification (Kapp)

- The mechanic must equal the cognitive operation. **[design]** Enforced by the
  primitives model: you choose the shell from the objective's primitive, never
  free-form. If the honest primitive has no shell yet, you say so — you do not
  substitute a recall quiz for a reasoning objective.

## Bloom's taxonomy — the bridge

- The objective verb maps to a Bloom band, which constrains eligible primitives.
  **[design]** See primitives.md. Record the band as `bloom` in the pack; the
  validator warns if the chosen primitives can't serve that band.

## Inclusion (cross-cutting, non-negotiable)

- **No public individual failure by default.** **[engine]** Per-student feedback
  is private; the cast (projector) screen shows teams and anonymous answer
  distributions only — never "X got it wrong." Struggling students get private
  scaffolding (a removed wrong option, or a hint range) automatically.
  **[design]** If the teacher named students to protect (interview Q6), keep
  `teams` ≥ 2 (individual scores stay private inside a team frame) and leave
  scaffolding on.
- Anonymous/pseudonymous handles are always allowed — students type any display
  name.

## The pre-emit checklist

Before you show a pack for review, confirm — silently — that all of these hold.
If one fails, fix the pack or settings, don't ship it:

1. Objective verb mapped to a Bloom band, and the chosen primitive can serve it
   (or you've flagged that the honest shell isn't built yet).
2. Every item's `primitive` is one the chosen shell supports.
3. Every recall/estimate item has a correct-answer key AND an `explanation`.
4. Item `difficulty` values span at least 2 levels (ideally 1–4).
5. There are enough items for the planned rounds (aim for ≥ 8 usable items).
6. `teams` ≥ 2 unless the teacher chose whole-class co-op.
7. `speedBonus` is off unless the teacher consciously asked for time pressure.
8. A reflection prompt is set (pack-specific or default).
9. `reviewStatus` is `draft` — the teacher approves it, never you.
10. `language` matches the teacher's material.
