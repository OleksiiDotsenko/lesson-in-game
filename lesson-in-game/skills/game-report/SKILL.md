---
name: game-report
description: >-
  Turn the data a Lesson in Game game captured into a one-page diagnostic the teacher can
  act on: which concepts the class collectively missed (reteach these), which
  students are quietly falling behind, whether the lesson's objective landed, and
  how broad participation was. Use this WHENEVER a teacher asks how a game went,
  wants the results / report / analytics, asks "what should I reteach tomorrow?",
  "who's struggling?", "did they get it?", or wants to feed the outcome into
  planning the next lesson. Reads the local session data written at the end of a
  match; nothing leaves the machine.
---

# Read the game's diagnostic report

Because the server saw every answer, choice, and response time, the game doubles
as a formative-assessment instrument — a diagnostic disguised as play. This skill
surfaces that, and closes the loop: the report seeds the next **create-game**
interview.

## Find the report

Every finished (non-preview) session writes its report into its own directory
under `${LESSON_IN_GAME_HOME:-$HOME/lesson-in-game}/sessions/`, and a copy of the one-pager into
`${LESSON_IN_GAME_HOME:-$HOME/lesson-in-game}/reports/`.

```bash
HOME_DIR="${LESSON_IN_GAME_HOME:-$HOME/lesson-in-game}"
ls -t "$HOME_DIR/reports/"                       # newest first
# full detail for a specific session:
ls -t "$HOME_DIR/sessions/" | head
```

Each session directory holds:
- `report.md` — the human one-pager (read this to the teacher).
- `report.json` — machine-readable (use this to seed the next lesson).
- `students.csv` — per-student rows for the teacher's records / gradebook.
- `log.jsonl` — the raw event log (source of truth).

If a session ended abnormally and `report.md` is missing, recompile it from the
log:

```bash
node "$HOME_DIR/engine/report.js" "$HOME_DIR/sessions/<sessionDir>" "$HOME_DIR/packs/<packId>.json"
```

## Present it (four sections)

Read `report.json` and give the teacher the four things that matter, in plain
language. Lead with the answer to "what do I do next," not raw tables.

1. **Did the objective land?** (`mastery`) — landed / partial / needs-reteach,
   with the overall accuracy. This is the headline.
2. **Misconception map** (`misconceptions`) — the concepts/tags and specific
   items the class collectively missed. These are the reteach targets. Name them
   concretely: "the class was 40% on the Golgi apparatus — worth revisiting."
3. **Silent-struggler flags** (`strugglers`) — individuals quietly falling behind
   or dropping out of participation, invisible in a normal lesson. **These are
   teacher-only and sensitive** — frame them as private "check in with X"
   prompts, never as public ranking, and never something to show the class.
4. **Engagement** (`engagement`) — was participation broad or captured by a few?

Then offer the ready-made next steps from `recommendations` — they're written to
drop straight into tomorrow's plan.

## Close the loop

The whole point is that the report shapes the next lesson. Offer it explicitly:

> Want me to start the next game already aimed at these two weak spots? I can
> pre-load a review round on the Golgi apparatus and cell membrane.

If the teacher says yes, carry the weak tags/items from `report.json` into a fresh
**create-game** interview as the starting objective — "reteach these two
concepts" — so the loop from data back to design actually closes.

## Handling and privacy

- Individual results are **private to the teacher**. Never suggest projecting the
  struggler list or ranking students publicly.
- Everything is local. If the teacher wants to keep records, point them at
  `students.csv` (opens in any spreadsheet) — but it's their data to move, not
  something the system uploads.
- Preview (bot) runs also write reports, marked as preview — ignore those when
  the teacher asks about a real class.
