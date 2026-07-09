---
name: review-pack
description: >-
  Show a teacher the auto-generated game questions so they can check accuracy,
  edit or reject items, and approve the pack before it goes live. Use this
  WHENEVER a teacher wants to review, check, edit, fix, or approve the content of
  a Ludus game — e.g. "show me the questions before we play", "let me fix question
  3", "approve the photosynthesis pack", "are these answers right?", or right
  after create-game drafts a pack. This is the mandatory human-expert accuracy
  gate: a pack cannot be launched live until a teacher approves it here. Also use
  to re-open an already-approved pack for edits.
---

# Review and approve a game pack

Auto-generated questions can be wrong, ambiguous, or too shallow — and the
teacher is the subject-matter authority, not the generator. This skill is the
**gate that keeps the human expert in charge of accuracy**. A pack is born
`draft`; the runner refuses to launch a draft live. Approval happens only here,
and only by the teacher's explicit decision.

## Find the pack

Packs live in `${LUDUS_HOME:-$HOME/ludus}/packs/`. List them:

```bash
ENGINE="${LUDUS_HOME:-$HOME/ludus}/engine"
node "$ENGINE/runner.js" --list
```

`✎` marks drafts (need review), `✓` marks approved. Load the JSON for the pack
the teacher names.

## Walk the teacher through it

Present the pack in **teacher language**, not raw JSON. For each item show:

- the question prompt,
- the options (mark which is correct) or the numeric answer + tolerance,
- the explanation students will see at the reveal,
- the difficulty and any subtopic tags.

Keep it scannable — a numbered list, the correct answer highlighted. Example:

> **3.** *Which organelle packages and ships proteins out of the cell?*
> A) Lysosome  ·  **B) Golgi apparatus ✓**  ·  C) Ribosome  ·  D) Vacuole
> *Explanation shown to students:* "The Golgi apparatus modifies, sorts and
> packages proteins for secretion." — difficulty 3 · tags: proteins, transport

Invite the specific kinds of problems teachers catch: a wrong answer key, a
distractor that's actually also correct, a factual slip, an ambiguous prompt, a
reading level that's off for the class, or an explanation that won't land.

## Apply their edits

Make the changes they ask for directly in the pack JSON:

- **fix an answer** — change the `answer` index (recall) or `numericAnswer` /
  `tolerance` (estimate).
- **reword** — edit `prompt`, `options`, or `explanation`.
- **reject an item** — remove it from `items`.
- **add one** — append a well-formed item (same rules as create-game: plausible
  options, one correct answer, an explanation, a difficulty, tags).
- **retune** — adjust `difficulty` or `tags`.

After every batch of edits, re-validate so a fix doesn't introduce a new problem:

```bash
node "$ENGINE/validate-pack.js" "${LUDUS_HOME:-$HOME/ludus}/packs/<packId>.json"
```

Resolve all errors. Surface warnings to the teacher when they reflect a real
teaching concern (e.g. "all items are the same difficulty — the game won't adapt").

## Approve (only on the teacher's word)

When the teacher explicitly says it's good, flip the gate: set
`reviewStatus` to `"approved"` and stamp `approvedAt` with the current time.
Confirm the pack now passes the launch check:

```bash
node "$ENGINE/validate-pack.js" "${LUDUS_HOME:-$HOME/ludus}/packs/<packId>.json" --launch
```

An exit code of 0 with "Approved for launch" means it's ready. Then tell the
teacher they can play it (hand off to **run-session**), and remind them a quick
**preview** (dry-run with bots) is one command away if they want to see it first.

**Never** approve a pack the teacher hasn't actually signed off on, and never
approve one that still has validation errors. If they want to change something
after approval, re-open it (edit freely; re-approve when done).
