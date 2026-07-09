# Lesson in Game — plugin & engine

*This is the technical README. For the friendly project overview, start at the
[repository front page](../README.md).*

> *A teacher describes a lesson; the frameworks design the game; the classroom
> plays it; the data teaches the teacher what to do next — and no one has to read
> a paper or write a line of code.*

Lesson in Game turns an ordinary lesson, in any subject, into a live multiplayer game the
class joins from their phones over the room's Wi-Fi — in under fifteen minutes,
with no coding and no design theory. The teacher makes only decisions they
already know how to make ("what should students be able to do after this
lesson?"). Every gamification best practice is applied automatically as an
invisible rule, and the game doubles as a formative-assessment instrument that
runs on the teacher's own machine, so student data never leaves the room.

This is a Claude Code **plugin**: four skills (the teacher-facing conversation)
plus a bundled Node.js **engine** (the actual classroom game server).

## The four skills

| Skill | When to use it | What it does |
|---|---|---|
| **create-game** | "make a game for my lesson on X" | Runs a six-question interview in teacher language, maps the objective to a game mechanic via the framework rulebook, and builds a content pack from the teacher's material. |
| **review-pack** | "show me the questions before we play" | The accuracy gate: the teacher (the subject expert) reviews, edits, and approves the auto-generated content. A pack can't go live until approved here. |
| **run-session** | "start the game" / "students can't connect" | Launches the server, shows the QR code to join, previews with bots, and gives the teacher live host controls over the classroom LAN. |
| **game-report** | "how did it go? what should I reteach?" | Turns the captured data into a one-page diagnostic — misconception map, silent-struggler flags, mastery, engagement — and seeds the next lesson. |

## The engine

`engine/` is a shared, server-authoritative game codebase (Express + Socket.IO).
A **shell** is a game template configured by a content pack, not a separate app.

- **Phase 1 (built): Quiz Arena** — team-scored recall + estimate, with
  class-adaptive difficulty and private per-student scaffolding.
- **Phase 2 (roadmap):** Pipeline Race (classify/sequence), Territory Conquest
  (locate), Debate & Vote (argue), Simulation Sandbox (simulate), Co-op Boss
  Battle. All seven interaction primitives, one codebase.

### One-time setup (needs internet once)

```bash
node engine/setup.js
```

This copies the engine to `~/lesson-in-game/engine`, installs dependencies, and creates
the data home (`~/lesson-in-game/packs`, `sessions`, `reports`). Override the location
with `$LESSON_IN_GAME_HOME`. **Running a class needs no internet.**

### Run a game by hand (the skills do this for you)

```bash
ENGINE="$HOME/lesson-in-game/engine"
node "$ENGINE/runner.js" --list                        # list packs
node "$ENGINE/runner.js" --pack <packId> --preview     # dry-run with bots
node "$ENGINE/runner.js" --pack <packId>               # live (approved packs only)
node "$ENGINE/runner.js" --resume "<sessionDir>"       # after a crash
node "$ENGINE/validate-pack.js" <pack.json> --launch   # check + gate
npm --prefix "$ENGINE" test                            # end-to-end smoke test
```

## Design principles (non-negotiable)

1. The teacher makes only pedagogical decisions — no technical choice is surfaced.
2. Frameworks are guardrails, not reading — encoded as automatic if-then rules.
3. Content gamification over structural — the mechanic *is* the cognitive operation.
4. Universal through abstraction — design for the operation, not the subject.
5. Inclusive by default — no public individual failure unless the teacher opts in.
6. Assessment is a by-product — the teacher gets analytics for free.
7. Local-first and private — student data stays on the teacher's machine.

## Layout

```
lesson-in-game/
├── .claude-plugin/plugin.json
├── skills/
│   ├── create-game/   SKILL.md + references (rulebook, primitives, shell, schema)
│   ├── review-pack/   SKILL.md
│   ├── run-session/   SKILL.md + references (networking, session-lifecycle)
│   └── game-report/   SKILL.md
├── engine/            server, session state machine, Quiz Arena shell, client, host views, runner, bots, tests
└── examples/          three ready-to-play packs (en biology, en economics, uk biology)
```

## Status

Phase 1 (prove the loop) is implemented and passes an end-to-end smoke test:
interview → pack → review gate → LAN runner → live session → diagnostic report.
See `../lesson-to-game-engine-concept.md` for the full concept and roadmap.
