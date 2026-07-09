# Interaction primitives — the subject-agnostic bridge

"Any subject" is credible only because the diversity of school subjects collapses
into a handful of **cognitive operations**. Design for the operation, not the
subject: a biology teacher sequencing respiration steps and a history teacher
sequencing revolution events get the *same* mechanic with different content.

This is also what makes the design **content gamification** (Kapp): the mechanic
IS the cognitive operation, never points bolted onto an unchanged worksheet.

## The seven primitives

| Primitive | Cognitive operation | Bloom band | Cross-field examples | Natural mechanic | Phase-1 shell |
|---|---|---|---|---|---|
| **recall** | Retrieve a fact | remember | vocabulary, dates, formulas, taxonomy names | rapid-answer quiz | **Quiz Arena ✓** |
| **classify** | Sort items into categories | understand / analyze | parts of speech, taxa, rock types, eras | sorting race | Pipeline Race (Phase 2) |
| **sequence** | Order steps or events | understand / apply | reaction steps, chronology, algorithms, plot | assembly relay | Pipeline Race (Phase 2) |
| **locate** | Place things spatially | apply | maps, anatomy, circuits, geometry | map/board capture | Territory Conquest (Phase 2) |
| **estimate** | Numeric / magnitude judgment | apply / analyze | dates, populations, probabilities, prices | confidence wager | **Quiz Arena ✓** |
| **argue** | Take and defend a position | evaluate | ethics, historiography, policy, criticism | debate + class vote | Debate & Vote (Phase 2) |
| **simulate** | Manipulate parameters, observe | apply / analyze / create | markets, ecosystems, physics | shared simulation | Simulation Sandbox (Phase 2) |

## Objective verb → Bloom band → eligible primitives

The teacher's objective verb (interview Q1) is the entry point. Map it to a Bloom
band; the band constrains which primitives can honestly satisfy the objective.
You cannot satisfy an "evaluate" objective with a pure recall quiz — that is the
structural-gamification trap the engine exists to avoid.

| If the objective verb is like… | Bloom band | Primitives that honestly serve it |
|---|---|---|
| list, name, recall, define, label, state, identify | remember | recall |
| explain, classify, group, categorise, summarise, compare | understand | classify, sequence, (recall for sub-facts) |
| order, sequence, arrange, apply, calculate, use, solve | apply | sequence, locate, estimate, simulate |
| analyse, differentiate, estimate, predict, model | analyze | classify, estimate, simulate |
| judge, argue, justify, critique, evaluate, defend, decide | evaluate | argue |
| design, create, compose, invent, build | create | simulate |

**When the honest primitive has no Phase-1 shell** (classify, sequence, locate,
argue, simulate), say so plainly and offer the nearest supported design — see
SKILL.md "When the lesson needs a primitive we can't play yet." Never silently
downgrade an "argue" lesson into a recall quiz.

## Mixed lessons

Most lessons combine two or three primitives. Quiz Arena handles **recall +
estimate** together in one pack. If a lesson's core operation is recall or
estimate with a little of the other, one Quiz Arena pack covers it. If the core
operation is something else, the lesson needs a Phase-2 shell.
