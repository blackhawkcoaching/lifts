import { validateAgainstSchema } from "./schema-validate.mjs";
import { isWarmup, lookup1rm, parseReps } from "./progression.mjs";

const BANNED_KEYS = new Set([
  "meals",
  "meal",
  "foods",
  "food",
  "calories",
  "calorie",
  "kcal",
  "nutrition",
  "macros",
  "macro",
  "diet",
  "bodyfat",
  "bodyweightkg",
  "bodyweightlb",
  "weighin",
  "weighins",
  "scaleweight",
]);

export function stripFence(text) {
  const trimmed = String(text ?? "").trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

export function describeLocation(doc, instancePath) {
  if (!doc || typeof doc !== "object" || !instancePath) return "";
  const parts = instancePath.split("/").filter(Boolean).map((part) => {
    try {
      return decodeURIComponent(part.replace(/~1/g, "/").replace(/~0/g, "~"));
    } catch {
      return part;
    }
  });
  let node = doc;
  const bits = [];
  for (let i = 0; i < parts.length; i += 1) {
    const key = parts[i];
    const parentKey = i > 0 ? parts[i - 1] : "";
    if (node == null || typeof node !== "object") break;
    const next = node[key];
    if (parentKey === "weeks" && next && typeof next === "object") {
      bits.push(`Week ${next.week ?? Number(key) + 1}`);
    } else if (parentKey === "days" && next && typeof next === "object") {
      bits.push(next.name || `Day ${Number(key) + 1}`);
    } else if (parentKey === "exercises" && next && typeof next === "object") {
      bits.push(next.name || `Exercise ${Number(key) + 1}`);
    } else if (parentKey === "sets" && next && typeof next === "object") {
      bits.push(`set ${next.set ?? Number(key) + 1}`);
    }
    node = next;
  }
  return bits.join(" · ");
}

function humanize(error) {
  const path = error.instancePath || "";
  const field = path.split("/").filter(Boolean).pop() || "";

  if (error.keyword === "required") {
    const hints = {
      format: 'Add "format": "liftplan".',
      version: 'Add "version": "0.1".',
      name: "Give the plan a name.",
      unit: 'Set "unit" to "lb" or "kg".',
      program: "Add a program with a weeks array.",
      weeks: "Add at least one week.",
      days: "Each week needs a days array.",
      exercises: "Each day needs an exercises array.",
      sets: "Each exercise needs a sets array.",
      id: 'Add an id such as "bench". Use the same id for that exercise every week.',
      order: "Add order as 1, 2, 3, and so on.",
      equipment: "Add equipment: barbell, dumbbell, machine, or bodyweight.",
      reps: 'Add reps as text, such as "5" or "8-10".',
      restSec: "Add restSec, the seconds to rest after this set.",
      set: "Add set as a number (1, 2, 3) or a warm-up id like W1.",
      week: "Number the week, starting at 1.",
    };
    return hints[error.missing] || `Add the missing field "${error.missing}".`;
  }
  if (error.keyword === "const") {
    if (field === "format") {
      return `This file should be a liftplan. Set "format" to "liftplan" (it is ${JSON.stringify(error.actual)}).`;
    }
    if (field === "version") {
      return `This app reads liftplan version 0.1. The file says ${JSON.stringify(error.actual)}.`;
    }
    if (field === "when") return 'Progression "when" must be "allSetsHitTarget".';
    return `This value must be ${JSON.stringify(error.expected)}.`;
  }
  if (error.keyword === "enum") {
    if (field === "equipment") return "Equipment must be barbell, dumbbell, machine, or bodyweight.";
    if (field === "unit") return 'Unit must be "lb" or "kg".';
    if (field === "weekday") return "Weekday must be mon, tue, wed, thu, fri, sat, or sun.";
    if (field === "ifMiss") return 'ifMiss must be "hold" or "backoff".';
    return `Use one of: ${error.expected.join(", ")}.`;
  }
  if (error.keyword === "type" || error.keyword === "integer") {
    if (field === "reps") return 'Reps must be text, such as "5" or "8-10", not a bare number.';
    if (field === "restSec") return "restSec must be a whole number of seconds.";
    if (field === "load") return "Load must be a number, or null when the set uses percent of 1RM or bodyweight.";
    if (field === "rpe") return "RPE must be a number from 1 to 10, or null.";
    if (field === "percent1rm") return "percent1rm must be a number, or null.";
    if (field === "version") return 'Version must be the text "0.1".';
    if (error.keyword === "integer") return "Use a whole number here.";
    const expected = [].concat(error.expected).join(" or ");
    return `Expected ${expected}.`;
  }
  if (error.keyword === "pattern") {
    if (field === "reps") return 'Reps must look like "5" or "8-10".';
    if (field === "id") return 'Use an id of lowercase letters, numbers, and dashes, such as "bench" or "db-row".';
    if (field === "set") return "A warm-up set id looks like W1 or W2.";
    return "This value is not in the expected shape.";
  }
  if (error.keyword === "anyOf") {
    if (field === "set") return "Set must be a number (1, 2, 3) or a warm-up id like W1.";
    if (field === "superset") return 'Superset must be a short label such as "A", or null.';
    return "This value does not match the allowed shapes.";
  }
  if (error.keyword === "minItems") {
    if (field === "weeks") return "Add at least one week.";
    if (field === "days") return "Each week needs at least one day.";
    if (field === "exercises") return "Each day needs at least one exercise.";
    if (field === "sets") return "Each exercise needs at least one set.";
    return "This list needs at least one item.";
  }
  if (error.keyword === "minLength") {
    if (field === "name") return "Give this a name.";
    if (field === "id") return "Give this an id.";
    return "This text is empty.";
  }
  if (error.keyword === "minimum" || error.keyword === "exclusiveMinimum") {
    if (field === "rpe") return "RPE must be from 1 to 10.";
    if (field === "percent1rm") return "percent1rm must be greater than 0 and at most 100.";
    if (field === "restSec") return "restSec cannot be negative.";
    return `The smallest allowed value is ${error.limit}.`;
  }
  if (error.keyword === "maximum") {
    if (field === "rpe") return "RPE must be from 1 to 10.";
    if (field === "percent1rm") return "percent1rm must be at most 100.";
    if (field === "restSec") return "restSec must be 1800 seconds (30 minutes) or less.";
    return `The largest allowed value is ${error.limit}.`;
  }
  return "This part of the plan needs a fix.";
}

export function friendlyErrors(doc, schemaErrors) {
  return schemaErrors.map((error) => {
    const where = describeLocation(doc, error.instancePath);
    const sentence = humanize(error);
    return where ? `${where}: ${sentence}` : sentence;
  });
}

function walkKeys(value, visit) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => walkKeys(item, visit));
    return;
  }
  for (const key of Object.keys(value)) {
    visit(key);
    walkKeys(value[key], visit);
  }
}

function extraRules(plan) {
  const errors = [];
  const warnings = [];
  const banned = [];
  walkKeys(plan, (key) => {
    if (BANNED_KEYS.has(String(key).toLowerCase())) banned.push(key);
  });
  if (banned.length) {
    errors.push("This app logs workouts only, so it will not import meal, calorie, or diet data. Remove those fields and try again.");
  }

  const dayIds = new Set();
  const weekNumbers = new Set();
  for (const week of plan.program?.weeks || []) {
    if (weekNumbers.has(week.week)) errors.push(`Week number ${week.week} is used more than once.`);
    weekNumbers.add(week.week);
    for (const day of week.days || []) {
      const where = `Week ${week.week} · ${day.name || day.id}`;
      if (dayIds.has(day.id)) errors.push(`${where}: day id "${day.id}" is already used. Each day needs its own id.`);
      dayIds.add(day.id);
      const exerciseIds = new Set();
      const supersets = new Map();
      for (const exercise of day.exercises || []) {
        if (exerciseIds.has(exercise.id)) {
          errors.push(`${where}: ${exercise.name} uses id "${exercise.id}", which is already on this day.`);
        }
        exerciseIds.add(exercise.id);
        if (exercise.superset) {
          supersets.set(exercise.superset, (supersets.get(exercise.superset) || 0) + 1);
        }
        const setIds = new Set();
        for (const set of exercise.sets || []) {
          const setKey = String(set.set);
          if (setIds.has(setKey)) {
            errors.push(`${where} · ${exercise.name}: set ${setKey} is listed twice.`);
          }
          setIds.add(setKey);
          const reps = parseReps(set.reps);
          if (reps && String(set.reps).includes("-") && Number(String(set.reps).split("-")[0]) > Number(String(set.reps).split("-").pop())) {
            errors.push(`${where} · ${exercise.name} · set ${setKey}: write the rep range low to high, such as "8-10".`);
          }
          if (!isWarmup(set) && exercise.equipment !== "bodyweight") {
            const hasLoad = typeof set.load === "number";
            const hasPercent = typeof set.percent1rm === "number";
            if (!hasLoad && !hasPercent) {
              errors.push(`${where} · ${exercise.name} · set ${setKey}: add a load, or a percent1rm with a matching oneRepMaxes entry.`);
            }
          }
          if (typeof set.percent1rm === "number" && lookup1rm(plan, exercise) == null) {
            errors.push(`${where} · ${exercise.name} uses ${set.percent1rm}% of 1RM, but oneRepMaxes has no entry named "${exercise.name}". Add one, or put a load on the set instead.`);
          }
        }
        if (exercise.equipment !== "barbell" && (exercise.sets || []).some(isWarmup)) {
          warnings.push(`${exercise.name} includes warm-up sets. They will be shown, but this app only suggests empty-bar warm-ups for barbell work.`);
        }
      }
      for (const [label, count] of supersets) {
        if (count < 2) {
          warnings.push(`${where}: superset "${label}" has only one exercise. It will be logged as straight sets.`);
        }
      }
    }
  }
  return { errors, warnings };
}

export function previewPlan(plan) {
  const days = [];
  let sets = 0;
  let exerciseRows = 0;
  const equipment = new Set();
  const ids = new Set();
  for (const week of plan.program.weeks) {
    for (const day of week.days) {
      let daySets = 0;
      const supersets = new Set();
      for (const exercise of day.exercises) {
        exerciseRows += 1;
        ids.add(exercise.id);
        equipment.add(exercise.equipment);
        daySets += exercise.sets.length;
        if (exercise.superset) supersets.add(exercise.superset);
      }
      sets += daySets;
      days.push({
        week: week.week,
        id: day.id,
        name: day.name,
        weekday: day.weekday || null,
        exercises: day.exercises.length,
        sets: daySets,
        supersets: [...supersets],
      });
    }
  }
  return {
    name: plan.name,
    unit: plan.unit,
    weeks: plan.program.weeks.length,
    sessions: days.length,
    exerciseRows,
    uniqueExercises: ids.size,
    sets,
    equipment: [...equipment],
    days,
  };
}

export function parseAndValidate(text, schema) {
  let data;
  try {
    data = JSON.parse(stripFence(text));
  } catch (error) {
    return {
      ok: false,
      errors: [`This is not valid JSON (${error.message}). Paste the whole plan, from the opening { to the closing }.`],
      warnings: [],
    };
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return {
      ok: false,
      errors: ["A liftplan is a JSON object { ... }, not a list or a single value."],
      warnings: [],
    };
  }
  const schemaErrors = validateAgainstSchema(data, schema);
  if (schemaErrors.length) {
    return {
      ok: false,
      errors: friendlyErrors(data, schemaErrors).slice(0, 20),
      warnings: [],
    };
  }
  const extra = extraRules(data);
  if (extra.errors.length) {
    return { ok: false, errors: extra.errors.slice(0, 20), warnings: extra.warnings };
  }
  return { ok: true, plan: data, errors: [], warnings: extra.warnings, preview: previewPlan(data) };
}

export function importPlan(state, text, schema) {
  const result = parseAndValidate(text, schema);
  if (!result.ok) return { ...result, state };
  return {
    ...result,
    state: {
      ...state,
      plan: result.plan,
      importedAt: new Date().toISOString(),
      working: {},
      draft: null,
      focus: null,
      log: Array.isArray(state?.log) ? state.log : [],
    },
  };
}
