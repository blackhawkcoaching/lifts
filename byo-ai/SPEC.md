# liftplan 0.1

Private prototype format for the Black Hawk Coaching workout log. It is not the live Lift Tracker, and it is not a public spec. Version **0.1** is the version this app reads. The 10 Nov 2026 sketch used `"version": "1.0"` and a flat `sessions` array. This file uses weeks and days, and it adds RPE, percent of 1RM, and machine equipment. A 1.0 file is rejected and the error says to use 0.1.

The JSON Schema is `schema/liftplan-0.1.schema.json`. The app validates against that schema, then applies the extra rules below. Unknown fields are kept and ignored, so a later version can add keys. A file with any error is refused whole. Nothing is partial-imported. Importing replaces the plan and the calculated next loads. It does not delete the log.

Workout logging only. Keys such as `meals`, `food`, `calories`, `nutrition`, `macros`, `diet`, or `scaleweight` anywhere in the file are an error.

## Document

| Field | Required | Meaning |
|---|---|---|
| `format` | yes | `"liftplan"` |
| `version` | yes | `"0.1"` |
| `name` | yes | Short plan name |
| `unit` | yes | `"lb"` or `"kg"` |
| `note` | no | Short note. Not nutrition advice |
| `oneRepMaxes` | no | Object. Keys match an exercise `name` (or its `id`). Values are numbers. Required only when a set uses `percent1rm` |
| `program.weeks` | yes | At least one week |

### Week, day, exercise, set

A week has `week` (1, 2, 3, …) and `days`. Week numbers are unique.

A day has `id`, `name`, `exercises`, and optional `weekday` (`mon` through `sun`) and `note`. Day ids are unique in the plan.

An exercise has:

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Lowercase id, such as `bench` or `db-row`. The same movement uses the same id every week. That id is how the next load is tracked |
| `order` | yes | 1, 2, 3, … within the day |
| `name` | yes | Exercise name |
| `equipment` | yes | `barbell`, `dumbbell`, `machine`, or `bodyweight` |
| `superset` | no | A short label such as `"A"`, or `null`. Two or more exercises on that day share a label |
| `sets` | yes | At least one set |
| `note` | no | Lifting cue |
| `progression` | no | Override of the rules below. If present, `when` must be `"allSetsHitTarget"` |

A set has:

| Field | Required | Meaning |
|---|---|---|
| `set` | yes | A whole number, or `W1`, `W2`, … for a warm-up |
| `reps` | yes | Text, `"5"` or `"8-10"`. Not a number. Write ranges low to high |
| `load` | no | A number, or `null`. Dumbbell load is one dumbbell. If both `load` and `percent1rm` are set, `load` wins |
| `rpe` | no | Number from 1 to 10, or `null` |
| `percent1rm` | no | Number from above 0 through 100. The matching `oneRepMaxes` entry is required |
| `restSec` | yes | Whole seconds, 0 through 1800 |
| `note` | no | Short cue |
| `warmup` | no | `true` also marks a warm-up |

Percent loads are rounded to the nearest increment for that equipment. 75% of a 315 lb squat, on a 5 lb barbell increment, is **235 lb**.

## Supersets

Exercises that share a superset label are done together, starting where the first of them sits in `order`. They alternate, one set each, for a round. The app starts **one** rest after the round, using the longer `restSec` in that round. If one exercise has more sets, the extra sets are done alone with their own rest. A label used by only one exercise is logged as straight sets. The last set of the whole session does not start a rest.

## Warm-ups

Warm-up rows (`W1`, or `warmup: true`) are shown and are not used for progression. A barbell exercise with no warm-up rows gets two optional suggestions: the empty bar (45 lb or 20 kg), then about 50% of the first working load rounded to 5 lb or 2.5 kg. Suggestions can be skipped. They are not graded. Dumbbell, machine, and bodyweight exercises do not get those suggestions, and a superset does not get them either. Do not put empty-bar warm-ups on those exercises in the file.

## Progression

Working sets only. The app, not the AI, changes the next load after a finished session. Until an exercise id has been logged, each week shows the loads in the file (percent loads resolved). After it has been logged, the next unlogged session shows the engine's loads for that id. The file's later-week numbers do not stack on top of that. Re-importing clears the engine's loads and keeps the log.

A logged set is compared with the target it was given:

- **Hit.** Reps reach the top of the target (`5`, or the `10` in `8-10`). If the set has a target RPE and the lifter entered one, it is at or under that RPE. A blank RPE does not block a hit.
- **Close.** Reps are under the top, but not shorter than the bottom of the range minus `holdWithinReps` (default 1). For a straight `"5"`, 4 is close and 3 is a miss. For `"8-10"`, 7, 8, and 9 are close and 10 is a hit. A hit whose RPE is above the target, but not by more than `holdRpeOver` (default 1), is also close. RPE 9 against a target of 8 is close. RPE 10 is a miss.
- **Miss.** Shorter than close, RPE further over the target than `holdRpeOver`, or the set was not logged.

The exercise takes the worst set:

- Every working set hit → **progress**
- No misses, at least one close → **hold**
- Any miss → **miss**

Misses count only in a row. A hold or a progressed session clears the streak. After `afterMisses` misses in a row (default **2**), the app **backs off** about `dropPercent` (default **10%**) and clears the streak. `ifMiss: "hold"` on that exercise, or in `program.progressionDefaults`, never backs off.

The base for the next load is the load the lifter logged for that set. If they left it blank, the base is the prescribed load. A heavier all-hit session becomes the new base, then the increment is added.

| Result | Next load | Bodyweight with no load |
|---|---|---|
| Progress | Base plus the increment | Add 1 to both ends of the rep range (`5-8` becomes `6-9`) |
| Hold | Base unchanged | Rep target unchanged |
| Miss, streak still short | Base unchanged | Rep target unchanged |
| Back-off | See below | Each end is reduced by the drop percent, floored, and at least 1 (`5-8` becomes `4-7`) |

A back-off multiplies the base by `(1 - dropPercent / 100)` and **rounds down** to the increment, so the cut is not smaller than about 10% just because of the plates. It will not go below one increment. If it cannot actually get lighter, the load stays and the streak is not cleared. 95 lb at 10% on a 5 lb bar becomes **85 lb**, not 90. 100 lb becomes 90. 40 lb dumbbells at a 2.5 lb step become 35.

### Increments

Defaults, when the plan does not override them. Dumbbell load is per hand, so its jump is not the barbell jump.

| Equipment | Pounds | Kilograms |
|---|---|---|
| Barbell | 5 | 2.5 |
| Dumbbell | 2.5 per hand | 2 per hand |
| Machine | 10 | 5 |
| Bodyweight | 0 (add a rep) | 0 (add a rep) |

`program.progressionDefaults.increments` replaces any of those numbers for the plan's unit. An exercise `progression.addLoad` replaces the jump for that exercise only. A bodyweight exercise that has a real load (a vest, a belt) uses the dumbbell increment unless `addLoad` is set.

These numbers are the rules the tests enforce. They are a guess about a real gym. See the README.

## What is stored on the phone

One localStorage record, `bhc.byo-ai.v1`: the plan, the log (prescribed targets, what was entered, and the result of each exercise), the next loads, and an in-progress draft. There is no account and no upload. The service worker caches the app shell so a refresh can open it without a network. It does not call an AI provider.
