# Ludus Skill Set — Build Plan

*Prepared from [lesson-to-game-engine-concept.md](lesson-to-game-engine-concept.md). This is the blueprint for scaffolding; nothing here is built yet.*

---

## 1. Shape of the deliverable

One **plugin named `ludus`** containing **four skills** plus a **bundled game engine** (the actual Node.js server + shells + browser client). The skills are the teacher-facing conversation layers (1–3 and 5 of the concept's architecture); the engine is layer 4 plus the runtime.

Why a plugin with four skills rather than one mega-skill: the teacher's touchpoints happen at different times (design the game Monday evening, review the pack Tuesday morning, run it in class Tuesday afternoon, read the report Tuesday evening). Each touchpoint needs its own entry phrase and its own focused context. This mirrors the structure that worked for `english-exam-coach` (router + task skills + progress tracker).

```
ludus/                              # plugin root
├── skills/
│   ├── create-game/
│   │   ├── SKILL.md                # interview script + design-engine logic
│   │   └── references/
│   │       ├── rulebook.md         # framework rules compiled to if-then (doc §6)
│   │       ├── primitives.md       # primitive → Bloom → mechanic → shell tables (doc §5)
│   │       ├── shells/             # one config doc per shell (doc §7)
│   │       │   └── quiz-arena.md   # (Phase 1: only this one)
│   │       └── pack-schema.json    # JSON Schema for content packs (doc §12)
│   ├── review-pack/
│   │   └── SKILL.md                # the teacher approval gate as a re-entry point
│   ├── run-session/
│   │   ├── SKILL.md                # pre-flight, preview mode, launch, host controls
│   │   └── references/
│   │       ├── networking.md       # transport decision guide + first-run runbook (doc §12)
│   │       └── session-lifecycle.md# state machine, robustness, host surface (doc §13)
│   └── game-report/
│       └── SKILL.md                # session log → diagnostic report (doc §10)
├── engine/                         # the product: shared server codebase
│   ├── package.json                # express + socket.io + qrcode
│   ├── server.js                   # session state machine, rooms, authority
│   ├── protocol.js                 # the event contract (doc §12 table), single source
│   ├── validate-pack.js            # schema + reviewStatus gate; CLI-callable
│   ├── shells/
│   │   └── quiz-arena/             # Phase 1 shell: server module + client page
│   ├── client/                     # shared join/lobby/feedback UI, thin & accessible
│   ├── host/                       # cast view + control view (two host screens)
│   └── bots.js                     # dummy players for preview/dry-run (doc §13.5)
└── scripts/
    └── ludus-runner.js             # start server w/ pack+shell, print URL + QR
```

**Data home:** `~/ludus/` (override via `$LUDUS_HOME`) — `packs/`, `sessions/` (checkpoints + logs), `reports/`. The plugin directory stays read-only at runtime; first run copies `engine/` to the data home and does a one-time `npm install` (install-time internet is acceptable; run-time never needs it).

---

## 2. Skill inventory

| Skill | What it does | Trigger phrases (for pushy descriptions) | Concept sections |
|---|---|---|---|
| **`ludus:create-game`** | The flagship. Runs the 6-question interview, maps objective verb → Bloom band → eligible primitives, selects + configures a shell, applies the rulebook, generates the content pack from the teacher's materials, then hands into the review gate. | "make a game for my lesson", "turn this lesson into a game", "gamify tomorrow's class on X", teacher pastes lesson notes and mentions a class | §5, §6, §8, §9, pack schema in §12 |
| **`ludus:review-pack`** | Displays a generated pack item-by-item in teacher language; teacher edits, rejects, or approves items; flips `reviewStatus: draft → approved`. The runner refuses unapproved packs, so this is the enforcement point. | "review my photosynthesis pack", "show me the questions before we play", "approve the game content" | §8 (gate), §12 (schema), §16 (accuracy risk) |
| **`ludus:run-session`** | Classroom runtime: first-run network checklist, mandatory preview/dry-run (bots), launch, QR code, live host controls, reconnect/late-joiner/crash-resume guidance, graceful end + log capture. | "start the game", "run the game for my class", "launch the session", "the students can't connect" | §12 (transport, runbook), §13 (lifecycle) |
| **`ludus:game-report`** | Reads the session log and produces the one-page diagnostic: misconception map, silent-struggler flags, mastery by objective, engagement distribution — plus concrete "reteach these" seeds for the next `create-game` interview. | "how did the game go", "show me the report", "what should I reteach tomorrow" | §10, §13.6 |

A separate router skill (like `english-exam-coach:exam-router`) is **deferred** — `create-game`'s description can carry the vague entry phrases ("I want to make my lesson fun") until triggering data says otherwise. Description optimization comes last anyway.

---

## 3. The two kinds of content, kept apart

The concept doc mixes knowledge and code; the skill set must separate them cleanly:

- **Knowledge → SKILL.md + references/.** Interview script, rulebook, primitives model, shell selection logic, report interpretation. Loaded into context only when the skill triggers (progressive disclosure; each SKILL.md stays well under 500 lines by pushing tables into references).
- **Code → engine/ + scripts/.** Everything deterministic and repeatable: pack validation, server, shells, QR generation, bots, report aggregation math. Skills call these scripts; they never re-derive them in-context. This is the skill-creator's "if every run would write the same helper script, bundle it" rule applied up front.

The **event protocol** (doc §12 table) and **pack schema** (doc §12 JSON) are the two contracts both sides depend on. They get one canonical machine-readable home each (`engine/protocol.js`, `references/pack-schema.json`) and everything else references them.

---

## 4. Rulebook compilation (doc §6 → enforceable checks)

Each framework rule gets an enforcement point — design-time (the skill applies it while configuring) or runtime (the engine defaults to it):

| Rule | Source | Enforced by |
|---|---|---|
| ≥1 meaningful student choice | SDT autonomy | `create-game` design step (checklist before emitting spec) |
| Visible progress + adaptive difficulty | SDT competence / Flow | engine (per-student accuracy drives item `difficulty` selection) |
| ≥1 cooperative element | SDT relatedness | `create-game` (shell config: team scoring on by default) |
| Never leaderboard-only | HEXAD | `create-game` (spec validator rejects single-hook designs) |
| ≥3 motivational hooks | HEXAD | `create-game` design checklist |
| Mandatory end-of-session reflection | RECIPE | engine (`sessionEnd` always carries `reflectionPrompt`) |
| White-hat defaults; black-hat opt-in | RECIPE | `create-game` (time pressure/loss mechanics off unless teacher enables) |
| Mechanic = cognitive operation | Kapp | primitives model itself (shell choice is derived, never free-form) |
| Objective verb constrains primitives | Bloom | `create-game` verb→band→primitive mapping table |
| No public individual failure by default | Inclusion | engine (`feedback` is per-student private; reveal is host-gated) |
| Draft packs cannot launch | Review gate | `validate-pack.js` + runner refusal |

This table becomes the spine of `references/rulebook.md`.

---

## 5. Build order (maps to doc §14 phases)

**Phase 1 — prove the loop (MVP), in this order:**
1. `references/pack-schema.json` + `engine/validate-pack.js` — contracts first.
2. `engine/` core: server.js state machine (Idle→Lobby→RoundActive→…→Reflection), protocol.js, join/lobby/reconnect, host cast+control views, QR, checkpointing, bots.
3. Quiz Arena shell (recall + estimate primitives; team scoring; adaptive difficulty).
4. `create-game` SKILL.md + rulebook/primitives references (all seven primitives documented, but shell availability limited to Quiz Arena — the skill says honestly what's not built yet and offers the nearest supported design).
5. `review-pack` SKILL.md.
6. `run-session` SKILL.md + runner script + first-run runbook.
7. `game-report` minimal: session log → per-item correctness table + weakest-concepts list (full four-part report is Phase 2).

**Phase 2:** Pipeline Race, Territory Conquest, Co-op Boss Battle, Debate & Vote shells; full diagnostic report; report→interview feedback loop.

**Phase 3:** Electron/one-click packaging, shell-authoring guide, pilot instrumentation.

---

## 6. Test plan (skill-creator eval loop)

Test prompts for Phase 1, drawn from the doc's own worked examples where compatible with Quiz Arena:

1. *Recall, happy path:* "I teach 8th-grade biology, tomorrow is a review of cell organelles, 24 students, most have phones. Make a game — here are my notes: …" → expect full interview→pack→review flow, Quiz Arena config, inclusion defaults on.
2. *Estimate:* "10th-grade economics, I want them to get a feel for orders of magnitude — GDP, populations, prices. 30 students, 20 minutes." → expect estimation items with tolerances, wager framing.
3. *Out-of-scope primitive (graceful degradation):* "11th-grade history — I want them to argue which cause of WWI mattered most." → expect the skill to recognize `argue`, say Debate Arena isn't built yet, and offer the closest supported alternative rather than silently emitting a recall quiz (that would violate the Kapp rule).
4. *Review gate:* "Show me the pack you made and let me fix question 3." → expect item-level edit + `reviewStatus` flip; runner must refuse a draft pack.

Baselines: same prompts with no skill. Assertions will check pack schema validity, `reviewStatus` enforcement, presence of the rulebook's design-time guarantees (≥1 choice, cooperative element, no leaderboard-only), and honest capability statements in test 3.

---

## 7. Defaults adopted (flag if wrong) and open questions

**Defaults:**
- **Namespace/name:** `ludus` (the doc's working name). Skills: `create-game`, `review-pack`, `run-session`, `game-report`.
- **Language:** skills mirror the teacher's language in conversation; packs carry `language` (`uk`/`en` first-class, per doc §16's Ukrainian-quality concern). Reference material written in English.
- **Runtime:** Node 18+, Express + Socket.IO + `qrcode`; one-time online `npm install` into `~/ludus/engine`, fully offline afterwards.
- **Location:** built as a plugin directory in this project (portable, shareable with colleagues later — matches doc Phase 3 intent).
- **Analytics storage:** JSON logs under `~/ludus/sessions/`, reports under `~/ludus/reports/`; nothing leaves the machine.

**Open questions (non-blocking, revisit before Phase 2):**
- Should `review-pack` stay a separate skill or fold into `create-game` once real usage shows how teachers actually re-enter? (Starting separate; cheap to merge.)
- Report depth in Phase 1 — minimal table vs. full four-part diagnostic.
- Whether the plugin should also ship 2–3 ready-made example lessons (doc §16 suggests them for onboarding; cheap to add, good for evals).
