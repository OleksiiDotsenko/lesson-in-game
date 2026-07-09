---
name: run-session
description: >-
  Launch and run a Lesson in Game classroom game live: start the server, show the QR code
  students scan to join, and steer the match from the teacher's control panel.
  Use this WHENEVER a teacher wants to start, launch, host, run, or play a game
  in class, do a practice/preview run before the lesson, resume a game after a
  laptop crash, or troubleshoot students who "can't connect" / "can't join" /
  "can't scan the code". Handles the first-run network checklist, the mandatory
  dry-run preview with bots, live host controls (start, pause, reveal, next
  round, reset, kick, end), and reconnection. Runs entirely on the teacher's
  machine over the classroom Wi-Fi — no internet, no student accounts.
---

# Run a game in the classroom

This is the runtime. It takes an **approved** content pack and puts a game in
front of the class. Everything runs on the teacher's laptop over the room's local
network — student data never leaves the machine.

References (read as needed — don't lecture the teacher):
- `references/networking.md` — how devices connect + the "can't connect" playbook.
- `references/session-lifecycle.md` — the phase machine, the two host screens,
  every control, and crash recovery.

## Preconditions

```bash
ENGINE="${LESSON_IN_GAME_HOME:-$HOME/lesson-in-game}/engine"
# 1. Engine installed?
ls "$ENGINE/node_modules" >/dev/null 2>&1 || echo "Run setup first: node <plugin>/engine/setup.js"
# 2. What packs exist, and are they approved?
node "$ENGINE/runner.js" --list
```

A pack must be **approved** to launch live. If it's still a draft (`✎`), send the
teacher to the **review-pack** skill first — don't try to launch it live (the
runner will refuse, by design).

## Always preview before going live

No teacher should launch something untested in front of thirty teenagers. Preview
mode boots the real session and fills the room with dummy bots so a full round
plays out — the teacher watches pacing, difficulty, and content on the cast view.
Preview also works on a **draft** pack, so it doubles as a content sanity check.

```bash
node "$ENGINE/runner.js" --pack <packId> --preview           # 8 bots
node "$ENGINE/runner.js" --pack <packId> --preview --bots 20 # bigger dry-run
```

Open the printed **cast** URL (projector view) and **control** URL (teacher
view). Click **Start**, watch a round or two, then Ctrl+C. Encourage the teacher
to also open the join URL on one real phone here — that's the first real-device
test and it confirms the network path.

## Go live

Once previewed and the pack is approved:

```bash
node "$ENGINE/runner.js" --pack <packId>
# optional setting overrides, e.g. a shorter, punchier game:
node "$ENGINE/runner.js" --pack <packId> --set rounds=6 --set timePerRound=25
```

The runner prints, in the terminal:
- a **QR code** and the **join URL** (`http://<laptop-ip>:<port>/?room=CODE`),
- the **room code** (students who can't scan type this),
- the **teacher control** URL and the **projector cast** URL,
- the session directory (where the report will land).

Then walk the teacher through the room:

1. **Firewall** — if this is the first run on this laptop, approve the one-time
   OS prompt to let `node` accept connections (see networking.md step 2).
2. **Project the cast view** — put `/cast` on the room's shared screen. The QR
   code and room code stay visible until the first round starts.
3. **Keep control private** — open `/host` on the teacher's own device only.
4. **Students join** — scan the QR (or type the room code), pick a name, land in
   the lobby. The roster fills live on both screens.
5. **Start** when ready, and steer with the controls.

## Steering the match

The controls, in plain terms (full detail in session-lifecycle.md):
**Start** begins · **Pause/Resume** freezes safely · **Reveal** ends a round
early and shows the answer · **Next** advances · **Reset round** re-asks a
botched question · **Kick** removes a disruptor · **End** winds down to the
reflection and report. Rounds also end on their own when the timer runs out or
everyone has answered.

The cast screen shows the spectacle (teams, anonymous distributions); the control
screen shows the private roster with quiet flags for students who are struggling
or dropping out of participation. Those flags are teacher-only — never on the
projector.

## If something goes wrong

- **Students can't connect** → work the checklist in `references/networking.md`
  (same Wi-Fi? right address? firewall? school-Wi-Fi client isolation?).
- **A student dropped** → they just reload/rescan; their token rejoins them with
  their score intact.
- **The laptop crashed or you hit Ctrl+C** → resume the exact session; it comes
  back **paused** and students auto-reconnect:
  ```bash
  node "$ENGINE/runner.js" --resume "<sessionDir printed at launch>"
  ```
- **A question was confusing mid-round** → **Reset round** and re-ask it.

## After the game

When the session ends (or you press **End**), the server compiles the diagnostic
report to the session directory automatically. Hand the teacher to the
**game-report** skill to read "what to reteach tomorrow." Data stays local.
