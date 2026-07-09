# Session lifecycle & runtime mechanics

How a match actually runs, from empty screen to diagnostic report. The server
owns this; the teacher steers it from the control view.

## The state machine

```
Idle → Lobby → RoundActive ⇄ Paused
               RoundActive → RoundReview → (next round | Summary)
               Summary → Reflection → Ended → report
```

| Phase | Students see | Teacher does | Exit |
|---|---|---|---|
| **Lobby** | Join screen → "you're in", roster | Watch roster fill, click **Start** | → RoundActive |
| **RoundActive** | Live question, timer, private feedback | Monitor; may Pause / Reveal / Reset | → RoundReview / Paused |
| **Paused** | "Paused" overlay, frozen | Handle the interruption, **Resume** | → RoundActive |
| **RoundReview** | Result + correct answer + anonymous distribution + teams | Discuss; **Next** | → RoundActive / Summary |
| **Summary** | Final team standings + personal stats | Wrap up; **Next** | → Reflection |
| **Reflection** | Reflection prompt, text box | Collect responses; **Finish** | → report |

The reflection moment is mandatory (RECIPE) — **End** fast-forwards toward it but
never skips it.

## Two host screens (keep them separate)

- **Cast view** (`/cast`) — for the room's projector/shared screen. Room code +
  QR in the lobby, the current question, countdown, anonymous answer
  distribution at the reveal, team standings. **Never shows an individual's
  answer or the correct answer before the reveal.** This is the shared spectacle.
- **Control view** (`/host`) — private, on the teacher's device. Live roster with
  each student's connection + progress + private flags (struggling, low
  participation, scaffolded), class metrics, the current answer (teacher-only),
  and the controls: **Start · Pause · Resume · Reveal · Next · Reset · Kick ·
  End**. Steer from here so the class never sees the machinery.

Put the cast link on the projector, keep the control link on your own screen.

## Controls, in plain terms

- **Start** — begin round 1 (enabled once at least one student has joined).
- **Pause / Resume** — freeze the timer and screens; nothing is lost.
- **Reveal** — end the current round now (don't wait for the timer), show the
  answer. Rounds also end automatically when time runs out or everyone's answered.
- **Next** — advance to the next round / to summary / to reflection / finish.
- **Reset round** — discard the current round's answers and points and re-ask the
  same question (use if a question was confusing or interrupted).
- **Kick** — remove a disruptive student.
- **End** — wind the session down to summary → reflection → report.

## Robustness (surviving a real classroom)

- **Reconnect.** A dropped student's browser auto-reconnects and presents its
  saved token; the server restores them to their session and score. They rejoin
  where they left off.
- **Late joiners.** A student arriving mid-session waits in the lobby and enters
  at the **next** round by default.
- **Name collisions.** Resolved silently (`Alex` → `Alex-2`).
- **Host restart / crash.** State is checkpointed every phase to a local file. If
  the laptop hiccups, relaunch with `--resume "<sessionDir>"`; the session
  restores **paused** and students auto-reconnect via their tokens. A laptop
  glitch doesn't kill the lesson.
- **Packet loss.** The server is authoritative and re-broadcasts state every
  second, so a missed message self-corrects — no fragile per-message reliability
  needed. This is why flaky classroom Wi-Fi is tolerable.

## Analytics capture (free by-product)

The server already receives every answer with a timestamp, so it logs
per-student, per-item correctness, timing, and choices as the match runs — no
extra instrumentation. At the end it compiles the diagnostic report (see the
**game-report** skill) and writes it locally. Nothing leaves the machine.
