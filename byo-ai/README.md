# Black Hawk Coaching — BYO-AI workout log

Private prototype. **Do not merge and do not deploy.** Merging to `main` would publish this folder on the existing GitHub Pages site. It is not the live Lift Tracker. No accounts, no paid APIs, and no calls to an AI. You copy a prompt into your own model and paste JSON back.

Joe's 10 Nov 2026 decisions, followed here: build the private prototype, keep the Black Hawk Coaching name with a strong disclaimer, and log workouts only. There is no food, calorie, or diet feature.

## Run it

From this folder:

```sh
node --test test/*.test.mjs
python3 -m http.server 8765
```

Open `http://127.0.0.1:8765/`. A local server is required. Opening the file directly cannot load the schema. Add to Home Screen is a normal PWA install from that origin. Nothing here changes GitHub Pages.

## What the tests prove

`node --test` covers the engine and the sample in `samples/full-body-2-week.json`.

- The sample is valid liftplan 0.1. It has two weeks, three days, RPE, a 75% squat, a superset, and all four equipment types. The preview counts 6 sessions and 64 sets.
- Broken JSON, a list, version `1.0`, bad equipment, numeric reps, a missing rest, a bad set id, a reversed rep range, percent of 1RM without `oneRepMaxes`, and meal or calorie keys all fail with a plain-language error. The previous plan and the log stay as they were. One bad exercise rejects the whole file.
- Extra unknown fields are accepted. A markdown fence around the JSON is stripped.
- Importing the sample resolves the squat to 235 lb, saves it, reloads it, and does not wipe an existing log. Importing again clears calculated loads and still keeps the log.
- Superset A alternates (row then chin, dumbbell bench then seated row) and rests once per round for the longer rest, 90 seconds. The last set of the day does not start a rest.
- Barbell curls with no warm-up rows get a suggested 45 lb warm-up. Dumbbell rows do not.
- On a Friday the open session is week 1 Friday. On a Thursday it is the next unlogged day, Monday.
- The prompt in the app is the text in `PROMPT.md`.
- A scripted two weeks (all six sessions) does what `SPEC.md` says: squat 235 → 240 → 245, bench +5 each hit week, dumbbell row +2.5 per hand, machine leg press +10, chin-ups `5-8` → `6-9` → `7-10`. Romanian deadlift at one rep short holds, then a later hit adds 5. Overhead press missed twice goes 95 → 95 (streak 1) → **85 lb** deload. A hot RPE holds or, if it is a real miss twice, deloads. A hold clears the miss streak. `ifMiss: "hold"` does not deload. Kilogram jumps are barbell 2.5, dumbbell 2, machine 5. A heavier logged load becomes the next base. A failed warm-up does not block a hit on the work sets.

## What is guessed or untested

- Whether ChatGPT, Claude, Grok, or Gemini will actually emit valid 0.1 JSON. The prompt was not sent to any of them.
- Whether these jumps and the 2-miss, ~10% back-off are good coaching. They are implemented as written in `SPEC.md`. A 2.5 lb dumbbell jump is often unavailable; many gyms jump 5 lb per hand. The plan can override `progressionDefaults.increments`.
- After a week is logged, the engine replaces later loads in the file. An AI that programmed a different week 2 does not get both increases.
- iPhone home-screen install, airplane mode, and a real gym session were not tested on a phone. The service worker is cache-on-fetch with an offline fallback. Desktop screenshots cover import, today, the rest timer, and progress.
- CSV import from the current tracker is not in this prototype.
- The in-app disclaimer and layout were reviewed in desktop Chrome at 390×844, not by a lifter.

## Open questions

1. Should dumbbells default to 2.5 lb per hand, or 5?
2. Should a later week written by the AI ever beat the engine after you have logged?
3. Are “within 1 rep / +1 RPE” and “deload on the second miss, round down” the rules to keep?
4. Bodyweight work adds a rep. Is a loaded vest supposed to use the dumbbell jump?
