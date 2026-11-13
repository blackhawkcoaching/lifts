import assert from "node:assert/strict";
import test from "node:test";
import { parseAndValidate } from "../src/liftplan.mjs";
import { minimalPlan, sample, sampleText, schema } from "./helpers.mjs";

function errorsOf(plan) {
  const text = typeof plan === "string" ? plan : JSON.stringify(plan);
  return parseAndValidate(text, schema);
}

test("the sample plan validates and previews", () => {
  const result = errorsOf(sampleText);
  assert.equal(result.ok, true, result.errors?.join("\n"));
  assert.equal(result.warnings.length, 0);
  assert.equal(result.preview.name, "Full Body A/B/C — 2 weeks");
  assert.equal(result.preview.unit, "lb");
  assert.equal(result.preview.weeks, 2);
  assert.equal(result.preview.sessions, 6);
  assert.equal(result.preview.uniqueExercises, 10);
  assert.equal(result.preview.sets, 64);
  assert.deepEqual(result.preview.equipment.sort(), ["barbell", "bodyweight", "dumbbell", "machine"]);
});

test("unknown fields are ignored", () => {
  const plan = structuredClone(sample);
  plan.createdBy = "an AI";
  plan.program.weeks[0].days[0].exercises[1].sets[0].tempo = "3-0-1";
  const result = errorsOf(plan);
  assert.equal(result.ok, true, result.errors?.join("\n"));
});

test("a markdown fence around a valid plan is accepted", () => {
  const result = errorsOf("```json\n" + sampleText.trim() + "\n```");
  assert.equal(result.ok, true, result.errors?.join("\n"));
});

test("schema requires the four equipment types and version 0.1", () => {
  assert.deepEqual(schema.$defs.exercise.properties.equipment.enum, [
    "barbell",
    "dumbbell",
    "machine",
    "bodyweight",
  ]);
  assert.equal(schema.properties.version.const, "0.1");
  assert.equal(schema.properties.format.const, "liftplan");
});

test("bad plans get a friendly error and do not validate", () => {
  const cases = [
    ["not json", /valid JSON/i],
    ["[]", /JSON object/i],
    [minimalPlan((plan) => { delete plan.format; }), /liftplan/i],
    [minimalPlan((plan) => { plan.version = "1.0"; }), /0\.1/],
    [minimalPlan((plan) => { plan.unit = "stone"; }), /lb/i],
    [minimalPlan((plan) => { plan.program.weeks = []; }), /at least one week/i],
    [minimalPlan((plan) => {
      plan.program.weeks[0].days[0].exercises[0].equipment = "cable";
    }), /barbell, dumbbell, machine, or bodyweight/i],
    [minimalPlan((plan) => {
      plan.program.weeks[0].days[0].exercises[0].sets[0].reps = 5;
    }), /text/i],
    [minimalPlan((plan) => {
      delete plan.program.weeks[0].days[0].exercises[0].sets[0].restSec;
    }), /rest/i],
    [minimalPlan((plan) => {
      plan.program.weeks[0].days[0].exercises[0].sets[0].set = "warmup";
    }), /W1/],
    [minimalPlan((plan) => {
      plan.program.weeks[0].days[0].exercises[0].sets[0].reps = "10-8";
    }), /8-10/],
    [minimalPlan((plan) => {
      const set = plan.program.weeks[0].days[0].exercises[0].sets[0];
      set.load = null;
      set.percent1rm = 80;
    }), /oneRepMaxes/i],
    [minimalPlan((plan) => { plan.calories = 2400; }), /workouts only/i],
    [minimalPlan((plan) => { plan.meals = [{ name: "lunch" }]; }), /workouts only/i],
  ];

  for (const [plan, pattern] of cases) {
    const result = errorsOf(plan);
    assert.equal(result.ok, false, `expected failure for ${pattern}`);
    assert.match(result.errors.join("\n"), pattern);
  }
});

test("a broken exercise rejects the whole file", () => {
  const plan = structuredClone(sample);
  plan.program.weeks[1].days[2].exercises[2].equipment = "bands";
  const result = errorsOf(plan);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /Barbell Curl/);
  assert.match(result.errors.join("\n"), /barbell, dumbbell, machine, or bodyweight/);
});

test("bodyweight may omit a load, and a loaded set may not", () => {
  const body = minimalPlan((plan) => {
    const exercise = plan.program.weeks[0].days[0].exercises[0];
    exercise.equipment = "bodyweight";
    exercise.name = "Chin-up";
    exercise.id = "chin";
    exercise.sets[0].load = null;
  });
  assert.equal(errorsOf(body).ok, true, errorsOf(body).errors?.join("\n"));

  const bare = minimalPlan((plan) => {
    plan.program.weeks[0].days[0].exercises[0].sets[0].load = null;
  });
  const result = errorsOf(bare);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /load/i);
});
