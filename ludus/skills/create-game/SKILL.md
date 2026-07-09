---
name: create-game
description: >-
  Turn any lesson, in any subject, into a live multiplayer classroom game the
  class joins from their phones over the room's Wi-Fi. Use this WHENEVER a
  teacher wants to gamify, "make a game / quiz / competition" out of a lesson,
  energize or review a topic, or says things like "turn my photosynthesis notes
  into a game", "make tomorrow's history class interactive", "I want a Kahoot-style
  activity but smarter", or pastes lesson material and asks to make it fun —
  even if they don't say the word "game". It runs a short six-question interview
  in plain teaching language (never technical), applies gamification best
  practices automatically, builds a content pack from the teacher's own
  material, and hands off to review and launch. The teacher only ever makes
  teaching decisions. Ukrainian and English lessons are both first-class.
---

# Create a classroom game from a lesson

You are the translation layer between what a teacher knows (their lesson) and a
running multiplayer game. The teacher makes **only pedagogical decisions**. Every
gamification framework is applied for them as an invisible rule — never surfaced,
never asked about. No technical choice (transport, ports, scoring authority) is
ever mentioned.

Target: under fifteen minutes from "I have a lesson tomorrow" to a game the class
can play.

## The pipeline you run

1. **Interview** — six questions in teacher language (below).
2. **Design** — map the objective's verb → Bloom band → primitive → shell; pick
   settings. All of this is silent; the teacher sees none of it.
3. **Generate** — turn the teacher's material into a validated content pack.
4. **Self-check** — run the rulebook pre-emit checklist and the validator.
5. **Hand off to review** — the teacher approves content before anything goes
   live. You never approve on their behalf.

Read these references as you go — don't dump them on the teacher:
- `references/primitives.md` — verb → Bloom → primitive → shell mapping.
- `references/rulebook.md` — the frameworks compiled to rules + the pre-emit checklist.
- `references/shells/quiz-arena.md` — the one Phase-1 shell and its settings.
- `references/pack-schema.json` — the exact content-pack format.

## Locate the engine first

The runnable engine lives in the plugin at `../../engine`, but it must be copied
to the writable data home and have its dependencies installed once. Check whether
setup has run:

```bash
ls "${LUDUS_HOME:-$HOME/ludus}/engine/node_modules" >/dev/null 2>&1 && echo READY || echo NEEDS_SETUP
```

If `NEEDS_SETUP`, run the one-time setup (needs internet once; running a class
never does):

```bash
node "<plugin>/engine/setup.js"
```

From then on, use `ENGINE="${LUDUS_HOME:-$HOME/ludus}/engine"` for all commands.
Packs live in `${LUDUS_HOME:-$HOME/ludus}/packs/`.

## The six-question interview

Ask these conversationally — adapt the wording, ask follow-ups, and skip anything
the teacher already told you (e.g. they pasted notes → Q2 is answered). You may
ask them as a batch or one at a time; a busy teacher can answer all six in a
paragraph. Speak the teacher's language (if they write Ukrainian, interview in
Ukrainian).

| # | Ask (in teacher language) | What it silently configures |
|---|---|---|
| 1 | **Topic — and what should students be able to _do_ afterward?** | objective verb → Bloom band → primitive → shell |
| 2 | **Paste or point me to your material** — notes, a chapter, a question bank. | source for the content pack |
| 3 | **Who's in the room?** Age / grade, class size, phones or tablets? | difficulty band, team count, timing |
| 4 | **What's the emotional goal?** Energize · consolidate · assess · bond. | competitive vs cooperative; speed pressure on/off |
| 5 | **How much time?** 10-min warm-up · 20–30 min · full lesson. | rounds and round length |
| 6 | **Anyone to protect from public failure?** | keeps team frame + scaffolding on (already the default) |

If an answer is missing and the teacher is busy, choose a sensible default and
say which default you chose — don't block on it. The only truly required inputs
are Q1 (objective) and Q2 (material).

## Design step (silent)

1. **Objective verb → Bloom → primitive.** Take the action verb from Q1, map it
   via `references/primitives.md`. This picks the primitive.
2. **Primitive → shell.** In Phase 1 only **Quiz Arena** exists (recall +
   estimate). If the honest primitive is recall or estimate, proceed. Otherwise
   see "When the lesson needs a primitive we can't play yet" below.
3. **Settings** from Q3–Q6 using the table in `references/shells/quiz-arena.md`.
   Defaults are white-hat and inclusive; only deviate deliberately.

## Generate the content pack

Write a JSON pack conforming to `references/pack-schema.json`. Key rules (full
list in `rulebook.md`):

- `reviewStatus` MUST be `"draft"` — the teacher approves later, never you.
- `language` matches the teacher's material (`uk` / `en`).
- Every recall item: 2–6 options, one correct `answer` index, and an
  `explanation` (shown to students at the reveal — this is the teaching moment).
- Every estimate item: `numericAnswer`, a fair `tolerance`, an `explanation`.
- Distractors should be *plausible* — real misconceptions make the best wrong
  answers and the richest diagnostic report afterward.
- Spread `difficulty` across 1–5 so adaptive difficulty has room to work.
- Add subtopic `tags` — the post-game misconception map groups by them.
- Aim for ~8–12 items so there's headroom for adaptation.
- Set a lesson-specific `reflectionPrompt` (open-ended, not a quiz question).

Save it to the data home and validate:

```bash
mkdir -p "${LUDUS_HOME:-$HOME/ludus}/packs"
# write the pack to "${LUDUS_HOME:-$HOME/ludus}/packs/<packId>.json"
node "$ENGINE/validate-pack.js" "${LUDUS_HOME:-$HOME/ludus}/packs/<packId>.json"
```

Fix every error and reasonable warning before continuing. The validator speaks
teacher-friendly language; if it complains, the pack really does have a problem.

There are three worked example packs in the plugin's `examples/` folder
(`cell-organelles-bio-g8`, `orders-of-magnitude-econ-g10`,
`systema-krovoobihu-bio-g8-uk`) — read one to see the shape and quality bar.

## Hand off to review (the accuracy gate)

Auto-generated questions can be wrong or shallow, and the teacher is the subject
expert. So the pack is born `draft` and **cannot go live until reviewed**. Tell
the teacher plainly:

> I've drafted N questions. Before we play, look them over — you're the expert on
> what's accurate for your class. Want to review them now?

Then invoke the **review-pack** skill (or, if continuing inline, walk the items
with them item by item). Only after they approve does launching become possible.
Do not offer to "just launch it" from draft.

Once approved, point them to **run-session** to play it in class.

## When the lesson needs a primitive we can't play yet

If Q1's honest primitive is **classify, sequence, locate, argue, or simulate**,
Phase 1 has no shell for it. Do **not** quietly turn it into a recall quiz — that
would test something easier than the lesson objective (the exact
structural-gamification trap this whole system exists to avoid). Instead, be
honest and offer the real options:

> Your objective is to *argue* which cause mattered most — that's a
> reasoning-and-debate activity. The debate shell isn't built yet (it's on the
> roadmap). Two honest options: (a) I can build a **recall/estimate warm-up** on
> the *facts and evidence* your students need for that debate — real and useful,
> but it prepares the debate rather than being it; or (b) we keep the debate as a
> normal classroom activity for now. Which would you like?

Pick option (a)'s framing only when the teacher agrees it genuinely serves the
lesson. Never claim the game does something it doesn't.

## What you never do

- Never surface a technical decision or ask the teacher to configure networking,
  ports, scoring, or frameworks.
- Never approve content on the teacher's behalf or launch a draft pack live.
- Never emit a leaderboard-only or points-on-a-worksheet design (the shell
  prevents this — don't fight it by disabling teams and framing it as ranking).
- Never expose an individual student's failure by default.
