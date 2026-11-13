import assert from "node:assert/strict";
import test from "node:test";
import { importPlan } from "../src/liftplan.mjs";
import { emptyState, targetsForDay } from "../src/session.mjs";
import { loadState, saveState } from "../src/store.mjs";
import { sampleText, schema } from "./helpers.mjs";

function memory() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
  };
}

test("importing the sample resolves loads and keeps an existing log", () => {
  const prior = emptyState();
  prior.log = [{ id: "keep-me", weekIndex: 8, dayIndex: 0, performed: [], prescribed: [], results: [] }];
  const result = importPlan(prior, sampleText, schema);
  assert.equal(result.ok, true, result.errors?.join("\n"));
  assert.equal(result.state.log.length, 1);
  assert.equal(result.state.log[0].id, "keep-me");
  assert.equal(result.state.plan.name, "Full Body A/B/C — 2 weeks");
  assert.deepEqual(result.state.working, {});

  const storage = memory();
  saveState(storage, result.state);
  const loaded = loadState(storage);
  assert.equal(loaded.plan.version, "0.1");
  assert.equal(loaded.log[0].id, "keep-me");

  const monday = targetsForDay(loaded, 0, 0);
  const squat = monday.queue.find((item) => item.exerciseId === "squat" && item.required);
  const bench = monday.queue.find((item) => item.exerciseId === "bench" && item.required);
  const row = monday.queue.find((item) => item.exerciseId === "db-row" && item.required);
  const chin = monday.queue.find((item) => item.exerciseId === "chin" && item.required);
  assert.equal(squat.targetLoad, 235);
  assert.equal(squat.targetReps, "5");
  assert.equal(squat.targetRpe, 8);
  assert.equal(bench.targetLoad, 155);
  assert.equal(row.targetLoad, 40);
  assert.equal(chin.targetLoad, null);
  assert.equal(chin.targetReps, "5-8");
});

test("a rejected file does not change the saved plan or the log", () => {
  const imported = importPlan(emptyState(), sampleText, schema);
  const before = imported.state;
  const rejected = importPlan(before, "{ this is not json", schema);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.state, before);
  assert.match(rejected.errors[0], /valid JSON/i);

  const broken = structuredClone(before.plan);
  broken.program.weeks[0].days[0].exercises[0].sets[0].restSec = "long";
  const again = importPlan(before, JSON.stringify(broken), schema);
  assert.equal(again.ok, false);
  assert.equal(again.state, before);
  assert.equal(before.plan.program.weeks[0].days[0].exercises[0].sets[2].percent1rm, 75);
});

test("re-importing replaces the plan and working loads, not the log", () => {
  let state = importPlan(emptyState(), sampleText, schema).state;
  state = {
    ...state,
    working: { bench: { loads: { 1: 999 }, reps: { 1: "5" }, missStreak: 4, lastOutcome: "progress", previous: { loads: {}, reps: {} } } },
    log: [{ id: "session-1", weekIndex: 3, dayIndex: 0, performed: [], prescribed: [], results: [] }],
  };
  const again = importPlan(state, "```json\n" + sampleText.trim() + "\n```", schema);
  assert.equal(again.ok, true, again.errors?.join("\n"));
  assert.equal(again.state.log.length, 1);
  assert.equal(again.state.log[0].id, "session-1");
  assert.deepEqual(again.state.working, {});
  const bench = targetsForDay(again.state, 1, 0).queue.find((item) => item.exerciseId === "bench" && item.required);
  assert.equal(bench.targetLoad, 155);
});
