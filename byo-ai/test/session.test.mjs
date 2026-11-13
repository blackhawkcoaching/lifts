import assert from "node:assert/strict";
import test from "node:test";
import { importPlan } from "../src/liftplan.mjs";
import { locateToday, overviewCards, targetsForDay } from "../src/session.mjs";
import { emptyState } from "../src/session.mjs";
import { PROMPT } from "../src/prompt.mjs";
import { readText, sampleText, schema } from "./helpers.mjs";

function imported() {
  const result = importPlan(emptyState(), sampleText, schema);
  assert.equal(result.ok, true, result.errors?.join("\n"));
  return result.state;
}

test("supersets alternate and rest once per round, using the longer rest", () => {
  const state = imported();
  const monday = targetsForDay(state, 0, 0);
  const round = monday.queue.filter((item) => item.superset === "A" && item.round === 1);
  assert.deepEqual(round.map((item) => item.exerciseId), ["db-row", "chin"]);
  assert.equal(round[0].restAfter, false);
  assert.equal(round[0].restSec, 0);
  assert.equal(round[1].restAfter, true);
  assert.equal(round[1].restSec, 90);

  const rests = monday.queue.filter((item) => item.superset === "A" && item.restAfter);
  assert.equal(rests.length, 2);
  assert.ok(rests.every((item) => item.restSec === 90));

  const friday = targetsForDay(state, 0, 2);
  const fridayRound = friday.queue.filter((item) => item.superset === "A" && item.round === 1);
  assert.deepEqual(fridayRound.map((item) => item.exerciseId), ["db-bench", "seated-row"]);
  assert.equal(fridayRound[1].restSec, 90);
  assert.equal(friday.queue.at(-1).restAfter, false);
  assert.equal(friday.queue.at(-1).exerciseId, "curl");
  const cards = overviewCards(friday.day, friday.queue);
  const superset = cards.find((card) => card.type === "superset");
  assert.ok(superset.members.every((member) => member.restSec === 90));
  const curl = cards.find((card) => card.members.some((member) => member.id === "curl"));
  assert.equal(curl.members[0].suggested.length, 1);
  assert.equal(curl.members[0].suggested[0].targetLoad, 45);
});

test("barbell work without warm-ups gets empty-bar suggestions; dumbbell work does not", () => {
  const state = imported();
  const monday = targetsForDay(state, 0, 0);
  const benchWarm = monday.queue.filter((item) => item.exerciseId === "bench" && item.suggested);
  assert.deepEqual(benchWarm.map((item) => item.targetLoad), [45, 80]);
  assert.ok(benchWarm.every((item) => item.required === false));
  assert.equal(monday.queue.some((item) => item.exerciseId === "db-row" && item.suggested), false);
  const squatWarm = monday.queue.filter((item) => item.exerciseId === "squat" && item.warmup && !item.suggested);
  assert.deepEqual(squatWarm.map((item) => item.setId), ["W1", "W2"]);
  assert.deepEqual(squatWarm.map((item) => item.targetLoad), [45, 135]);
});

test("today follows the weekday, then the next unlogged session", () => {
  const friday = new Date(2026, 10, 13, 12, 0, 0);
  assert.equal(friday.getDay(), 5);
  const state = imported();
  const located = locateToday(state, friday);
  assert.equal(located.reason, "weekday");
  assert.equal(state.plan.program.weeks[located.weekIndex].days[located.dayIndex].id, "w1-fri");

  const thursday = new Date(2026, 10, 12, 12, 0, 0);
  const next = locateToday(state, thursday);
  assert.equal(next.reason, "next");
  assert.equal(state.plan.program.weeks[next.weekIndex].days[next.dayIndex].weekday, "mon");
});

test("the in-app prompt matches PROMPT.md", () => {
  const file = readText("../PROMPT.md");
  assert.equal(file.trim(), PROMPT.trim());
  assert.match(PROMPT, /liftplan 0\.1/);
  assert.match(PROMPT, /barbell/);
  assert.match(PROMPT, /dumbbell/);
  assert.match(PROMPT, /machine/);
  assert.match(PROMPT, /bodyweight/);
  assert.match(PROMPT, /percent1rm/);
  assert.match(PROMPT, /restSec/);
  assert.match(PROMPT, /superset/);
  assert.doesNotMatch(PROMPT, /calorie tracker|meal plan|macros target/i);
});
