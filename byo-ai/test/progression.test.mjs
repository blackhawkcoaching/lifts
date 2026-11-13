import assert from "node:assert/strict";
import test from "node:test";
import { importPlan } from "../src/liftplan.mjs";
import {
  DEFAULT_INCREMENTS,
  classifySet,
  deload,
  resolveLoad,
  roundToStep,
  rulesFor,
} from "../src/progression.mjs";
import { emptyState, finishSession, targetsForDay } from "../src/session.mjs";
import { parseReps } from "../src/progression.mjs";
import { minimalPlan, sample, sampleText, schema } from "./helpers.mjs";

function top(reps) {
  return parseReps(reps).max;
}

function logDay(state, weekIndex, dayIndex, adjust, at) {
  const view = targetsForDay(state, weekIndex, dayIndex);
  const performed = view.queue.filter((item) => item.required).map((item) => {
    const row = {
      exerciseId: item.exerciseId,
      set: item.setId,
      reps: top(item.targetReps),
      load: item.targetLoad,
      rpe: item.targetRpe ?? 8,
    };
    adjust?.(row, item);
    return row;
  });
  const result = finishSession(state, {
    weekIndex,
    dayIndex,
    performed,
    at: at || "2026-11-16T15:00:00.000Z",
  });
  assert.equal(result.ok, true, result.errors?.join("\n"));
  return result.state;
}

function loadOf(state, id, setId = "1") {
  return state.working[id].loads[setId];
}

function repsOf(state, id, setId = "1") {
  return state.working[id].reps[setId];
}

test("default jumps differ for barbell, dumbbell, and machine", () => {
  assert.notEqual(DEFAULT_INCREMENTS.lb.dumbbell, DEFAULT_INCREMENTS.lb.barbell);
  assert.notEqual(DEFAULT_INCREMENTS.lb.machine, DEFAULT_INCREMENTS.lb.barbell);
  assert.notEqual(DEFAULT_INCREMENTS.kg.dumbbell, DEFAULT_INCREMENTS.kg.barbell);
  assert.equal(DEFAULT_INCREMENTS.lb.barbell, 5);
  assert.equal(DEFAULT_INCREMENTS.lb.dumbbell, 2.5);
  assert.equal(DEFAULT_INCREMENTS.lb.machine, 10);
  assert.equal(DEFAULT_INCREMENTS.kg.barbell, 2.5);
  assert.equal(DEFAULT_INCREMENTS.kg.dumbbell, 2);
  assert.equal(DEFAULT_INCREMENTS.kg.machine, 5);
});

test("percent of 1RM rounds to the barbell increment", () => {
  const exercise = sample.program.weeks[0].days[0].exercises[0];
  const work = exercise.sets.find((set) => set.set === 1);
  assert.equal(resolveLoad(work, exercise, sample), 235);
  assert.equal(roundToStep(236.25, 5), 235);
  assert.equal(deload(95, 10, 5), 85);
  assert.equal(deload(100, 10, 5), 90);
  assert.equal(deload(40, 10, 2.5), 35);
});

test("two logged weeks progress hits, hold a close set, and back off a second miss", () => {
  let state = importPlan(emptyState(), sampleText, schema).state;

  state = logDay(state, 0, 0, null, "2026-11-16T15:00:00.000Z");
  assert.equal(loadOf(state, "squat"), 240);
  assert.equal(loadOf(state, "bench"), 160);
  assert.equal(loadOf(state, "db-row"), 42.5);
  assert.equal(repsOf(state, "chin"), "6-9");
  assert.equal(state.working.bench.lastOutcome, "progress");
  assert.equal(state.working.squat.previous.loads["1"], 235);

  state = logDay(state, 0, 1, (row) => {
    if (row.exerciseId === "rdl") row.reps = 7;
    if (row.exerciseId === "ohp") row.reps = 3;
  }, "2026-11-18T15:00:00.000Z");
  assert.equal(loadOf(state, "rdl"), 185);
  assert.equal(state.working.rdl.lastOutcome, "hold");
  assert.equal(state.working.rdl.missStreak, 0);
  assert.equal(loadOf(state, "ohp"), 95);
  assert.equal(state.working.ohp.lastOutcome, "miss");
  assert.equal(state.working.ohp.missStreak, 1);
  assert.equal(loadOf(state, "leg-press"), 280);
  assert.equal(state.working["leg-press"].lastOutcome, "progress");

  state = logDay(state, 0, 2, null, "2026-11-20T15:00:00.000Z");
  assert.equal(loadOf(state, "db-bench"), 52.5);
  assert.equal(loadOf(state, "seated-row"), 130);
  assert.equal(loadOf(state, "curl"), 70);

  const week2 = targetsForDay(state, 1, 0);
  assert.equal(week2.queue.find((item) => item.exerciseId === "bench" && item.required).targetLoad, 160);
  assert.equal(week2.queue.find((item) => item.exerciseId === "squat" && item.required).targetLoad, 240);
  assert.equal(week2.queue.find((item) => item.exerciseId === "db-row" && item.required).targetLoad, 42.5);
  assert.equal(week2.queue.find((item) => item.exerciseId === "chin" && item.required).targetReps, "6-9");
  const loggedMonday = targetsForDay(state, 0, 0);
  assert.equal(loggedMonday.logged, true);
  assert.equal(loggedMonday.queue.find((item) => item.exerciseId === "bench" && item.required).targetLoad, 155);

  state = logDay(state, 1, 0, null, "2026-11-23T15:00:00.000Z");
  assert.equal(loadOf(state, "bench"), 165);
  assert.equal(loadOf(state, "squat"), 245);
  assert.equal(loadOf(state, "db-row"), 45);
  assert.equal(repsOf(state, "chin"), "7-10");

  state = logDay(state, 1, 1, (row) => {
    if (row.exerciseId === "ohp") row.reps = 3;
  }, "2026-11-25T15:00:00.000Z");
  assert.equal(loadOf(state, "ohp"), 85);
  assert.equal(state.working.ohp.lastOutcome, "backoff");
  assert.equal(state.working.ohp.missStreak, 0);
  assert.equal(state.working.ohp.previous.loads["1"], 95);
  assert.equal(loadOf(state, "rdl"), 190);
  assert.equal(state.working.rdl.lastOutcome, "progress");
  assert.equal(loadOf(state, "leg-press"), 290);

  state = logDay(state, 1, 2, null, "2026-11-27T15:00:00.000Z");
  assert.equal(state.log.length, 6);
  assert.equal(loadOf(state, "db-bench"), 55);
  assert.equal(loadOf(state, "seated-row"), 140);
  assert.equal(loadOf(state, "curl"), 75);
});

function planWith(exercise) {
  const base = minimalPlan();
  base.program.weeks.push(structuredClone(base.program.weeks[0]));
  base.program.weeks[1].week = 2;
  base.program.weeks[1].days[0].id = "d2";
  Object.assign(base.program.weeks[0].days[0].exercises[0], exercise);
  Object.assign(base.program.weeks[1].days[0].exercises[0], exercise);
  return base;
}

test("RPE at the target progresses, a slightly hot set holds, and a grind misses", () => {
  const rules = rulesFor({ unit: "lb", program: {} }, { equipment: "barbell" });
  assert.equal(classifySet("5", 8, { reps: 5, rpe: 8 }, rules), "hit");
  assert.equal(classifySet("5", 8, { reps: 5, rpe: 9 }, rules), "close");
  assert.equal(classifySet("5", 8, { reps: 5, rpe: 8.5 }, rules), "close");
  assert.equal(classifySet("5", 8, { reps: 5, rpe: 10 }, rules), "miss");
  assert.equal(classifySet("5", 8, { reps: 4, rpe: 8 }, rules), "close");
  assert.equal(classifySet("5", 8, { reps: 3, rpe: 8 }, rules), "miss");
  assert.equal(classifySet("8-10", 8, { reps: 8, rpe: 8 }, rules), "close");
  assert.equal(classifySet("8-10", 8, { reps: 10, rpe: 8 }, rules), "hit");
  assert.equal(classifySet("5", 8, { reps: 5, rpe: null }, rules), "hit");

  const hot = planWith({});
  let state = importPlan(emptyState(), JSON.stringify(hot), schema).state;
  state = logDay(state, 0, 0, (row) => { row.rpe = 9; });
  assert.equal(state.working.bench.lastOutcome, "hold");
  assert.equal(loadOf(state, "bench"), 100);

  const grind = planWith({});
  state = importPlan(emptyState(), JSON.stringify(grind), schema).state;
  state = logDay(state, 0, 0, (row) => { row.rpe = 10; });
  state = logDay(state, 1, 0, (row) => { row.rpe = 10; });
  assert.equal(state.working.bench.lastOutcome, "backoff");
  assert.equal(loadOf(state, "bench"), 90);
});

test("a hold clears the miss streak, and ifMiss hold never deloads", () => {
  const plan = planWith({});
  let state = importPlan(emptyState(), JSON.stringify(plan), schema).state;
  state = logDay(state, 0, 0, (row) => { row.reps = 2; });
  assert.equal(state.working.bench.missStreak, 1);
  state = logDay(state, 1, 0, (row) => { row.reps = 4; });
  assert.equal(state.working.bench.lastOutcome, "hold");
  assert.equal(state.working.bench.missStreak, 0);
  assert.equal(loadOf(state, "bench"), 100);

  const held = planWith({ progression: { when: "allSetsHitTarget", ifMiss: "hold" } });
  state = importPlan(emptyState(), JSON.stringify(held), schema).state;
  state = logDay(state, 0, 0, (row) => { row.reps = 1; });
  state = logDay(state, 1, 0, (row) => { row.reps = 1; });
  assert.equal(loadOf(state, "bench"), 100);
  assert.notEqual(state.working.bench.lastOutcome, "backoff");
});

test("kilogram defaults and a logged load above the prescription", () => {
  const plan = minimalPlan();
  plan.unit = "kg";
  plan.program.weeks.push(structuredClone(plan.program.weeks[0]));
  plan.program.weeks[1].week = 2;
  plan.program.weeks[1].days[0].id = "d2";
  for (const week of plan.program.weeks) {
    const exercise = week.days[0].exercises[0];
    exercise.sets[0].load = 60;
  }
  let state = importPlan(emptyState(), JSON.stringify(plan), schema).state;
  state = logDay(state, 0, 0, (row) => { row.load = 62.5; });
  assert.equal(loadOf(state, "bench"), 65);

  const dumbbell = structuredClone(plan);
  for (const week of dumbbell.program.weeks) {
    const exercise = week.days[0].exercises[0];
    exercise.id = "row";
    exercise.name = "Dumbbell Row";
    exercise.equipment = "dumbbell";
    exercise.sets[0].load = 20;
  }
  state = importPlan(emptyState(), JSON.stringify(dumbbell), schema).state;
  state = logDay(state, 0, 0);
  assert.equal(loadOf(state, "row"), 22);

  const machine = structuredClone(plan);
  machine.unit = "lb";
  for (const week of machine.program.weeks) {
    const exercise = week.days[0].exercises[0];
    exercise.id = "press";
    exercise.name = "Leg Press";
    exercise.equipment = "machine";
    exercise.sets[0].load = 200;
  }
  state = importPlan(emptyState(), JSON.stringify(machine), schema).state;
  state = logDay(state, 0, 0);
  assert.equal(loadOf(state, "press"), 210);
});

test("warm-up rows do not decide the outcome, and bodyweight adds a rep", () => {
  const plan = planWith({
    sets: [
      { set: "W1", reps: "5", load: 45, restSec: 60 },
      { set: 1, reps: "5", load: 135, rpe: 8, restSec: 180 },
    ],
  });
  let state = importPlan(emptyState(), JSON.stringify(plan), schema).state;
  const view = targetsForDay(state, 0, 0);
  const performed = view.queue.filter((item) => item.required || item.warmup).map((item) => ({
    exerciseId: item.exerciseId,
    set: item.setId,
    reps: item.warmup ? 0 : top(item.targetReps),
    load: item.targetLoad,
    rpe: item.targetRpe,
  }));
  state = finishSession(state, { weekIndex: 0, dayIndex: 0, performed, at: "2026-11-16T15:00:00.000Z" }).state;
  assert.equal(state.working.bench.lastOutcome, "progress");
  assert.equal(loadOf(state, "bench"), 140);

  const chin = planWith({
    id: "chin",
    name: "Chin-up",
    equipment: "bodyweight",
    sets: [
      { set: 1, reps: "5-8", load: null, rpe: 8, restSec: 90 },
      { set: 2, reps: "5-8", load: null, rpe: 8, restSec: 90 },
    ],
  });
  state = importPlan(emptyState(), JSON.stringify(chin), schema).state;
  state = logDay(state, 0, 0);
  assert.equal(repsOf(state, "chin"), "6-9");
  state = logDay(state, 1, 0, (row) => { row.reps = 1; });
  state = {
    ...state,
    working: {
      ...state.working,
      chin: { ...state.working.chin, missStreak: 1, lastOutcome: "miss" },
    },
  };
  const third = minimalPlan();
  third.program.weeks = [structuredClone(chin.program.weeks[0]), structuredClone(chin.program.weeks[0]), structuredClone(chin.program.weeks[0])];
  third.program.weeks[1].week = 2;
  third.program.weeks[1].days[0].id = "d2";
  third.program.weeks[2].week = 3;
  third.program.weeks[2].days[0].id = "d3";
  third.program.weeks.forEach((week, index) => {
    Object.assign(week.days[0].exercises[0], chin.program.weeks[0].days[0].exercises[0]);
    week.days[0].exercises[0] = structuredClone(chin.program.weeks[0].days[0].exercises[0]);
  });
  state = importPlan(emptyState(), JSON.stringify(third), schema).state;
  state = logDay(state, 0, 0, (row) => { row.reps = 1; });
  state = logDay(state, 1, 0, (row) => { row.reps = 1; });
  assert.equal(state.working.chin.lastOutcome, "backoff");
  assert.equal(repsOf(state, "chin"), "4-7");
});

test("one close set among hits holds the load", () => {
  const plan = planWith({
    sets: [
      { set: 1, reps: "5", load: 100, rpe: 8, restSec: 120 },
      { set: 2, reps: "5", load: 100, rpe: 8, restSec: 120 },
    ],
  });
  let state = importPlan(emptyState(), JSON.stringify(plan), schema).state;
  state = logDay(state, 0, 0, (row) => {
    if (row.set === 2) row.reps = 4;
  });
  assert.equal(state.working.bench.lastOutcome, "hold");
  assert.equal(loadOf(state, "bench", "1"), 100);
  assert.equal(loadOf(state, "bench", "2"), 100);
});
