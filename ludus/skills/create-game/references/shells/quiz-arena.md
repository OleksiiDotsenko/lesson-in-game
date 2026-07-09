# Shell: Quiz Arena

The Phase-1 shell. Team-scored rapid-answer game for **recall** and **estimate**
items, with class-adaptive difficulty and private per-student scaffolding.

## Plays these primitives
- **recall** — multiple-choice (2–6 options), one correct.
- **estimate** — a numeric answer with a tolerance band (full credit within
  ±tolerance, half credit within ±2×tolerance).

A single pack may mix both. Items of any *other* primitive are ignored by this
shell — so don't build a pack around classify/sequence/locate/argue/simulate and
expect Quiz Arena to play it.

## Strong for
Factual review, vocabulary, formulas, dates, "get a feel for the numbers"
magnitude lessons, warm-ups and consolidation. Emotional goals: energize,
consolidate, assess.

## How the rulebook is baked in (you get these for free)
- **Autonomy** — once-per-session ×2 token each student chooses when to spend.
- **Competence** — private score + streak; difficulty walks toward the class's
  accuracy edge; struggling students privately get a wrong option removed
  (recall) or a hint range (estimate).
- **Relatedness** — team scoring by average (uneven teams stay fair).
- **Flow** — immediate private feedback; clear per-round goal + timer.
- **Inclusion** — cast screen shows only teams + anonymous distributions.
- **RECIPE** — reflection screen always closes the session; white-hat by default.

## Settings you configure (from the interview, not from the teacher directly)

| Setting | Default | Set it from | Notes |
|---|---|---|---|
| `rounds` | 8 | time available (Q5) | capped by usable item count |
| `timePerRound` | 30 | age (Q3) + topic | younger / harder → give more |
| `teams` | 2 | class size (Q3), protection (Q6) | `1` = whole-class co-op; ≥2 keeps individual scores private |
| `feedbackTiming` | `immediate` | almost always immediate | `review` holds feedback to the reveal |
| `speedBonus` | `false` | emotional goal (Q4) | **black-hat** — only on if the teacher wants time pressure |
| `streakBonus` | `true` | — | small mastery signal; leave on |
| `doublePoints` | `true` | — | the autonomy token; leave on |
| `scaffolding` | `true` | protection (Q6) | leave on; it's silent and private |

### Time / rounds rules of thumb
- 10-min warm-up → `rounds: 5`, `timePerRound: 20`.
- 20–30 min activity → `rounds: 8–10`, `timePerRound: 25–35`.
- Younger students (grade ≤ 6) → fewer rounds, +10s per round.
- "Energize / competitive" (Q4) → you *may* set `speedBonus: true` and `teams: 2+`
  and say so. "Consolidate / bond" → keep white-hat, consider `teams: 1`.

## Item authoring rules
- **recall**: 2–6 plausible options, exactly one correct (`answer` = its index),
  and a one-sentence `explanation`. Distractors should be plausible (common
  misconceptions make the best wrong options and the richest report).
- **estimate**: a real `numericAnswer`, a `tolerance` that reflects genuine
  "close enough," an `explanation`, and (optional) `unit`, `min`, `max` hints.
  Choose tolerance thoughtfully — too tight punishes good intuition, too loose
  makes it trivial.
- Give items `tags` (subtopic labels). The report's misconception map groups by
  tag, so good tags make the diagnostic sharper.
- Spread `difficulty` 1–5 across the pack.

## Launch
```
node <engine>/runner.js --pack <packId> --preview          # dry-run with bots
node <engine>/runner.js --pack <packId>                     # live (needs approval)
node <engine>/runner.js --pack <packId> --set rounds=6 --set speedBonus=true
```
