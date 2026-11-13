/** Load math and the progression rules documented in SPEC.md. */

export const DEFAULT_INCREMENTS = {
  lb: { barbell: 5, dumbbell: 2.5, machine: 10, bodyweight: 0 },
  kg: { barbell: 2.5, dumbbell: 2, machine: 5, bodyweight: 0 },
};

export const DEFAULT_RULES = {
  holdWithinReps: 1,
  holdRpeOver: 1,
  afterMisses: 2,
  dropPercent: 10,
  ifMiss: "backoff",
};

export function clean(n) {
  return Math.round(n * 1000) / 1000;
}

function toMilli(n) {
  return Math.round(n * 1000);
}

export function roundToStep(value, step) {
  if (!step) return clean(value);
  const v = toMilli(value);
  const s = toMilli(step);
  return clean((Math.round(v / s) * s) / 1000);
}

export function roundDownToStep(value, step) {
  if (!step) return clean(value);
  const v = toMilli(value);
  const s = toMilli(step);
  return clean((Math.floor(v / s) * s) / 1000);
}

export function isWarmup(set) {
  if (!set || typeof set !== "object") return false;
  if (set.warmup === true) return true;
  return typeof set.set === "string" && /^W\d+$/.test(set.set);
}

export function parseReps(reps) {
  const match = String(reps ?? "").trim().match(/^(\d+)\s*(?:-\s*(\d+))?$/);
  if (!match) return null;
  const a = Number(match[1]);
  const b = match[2] != null ? Number(match[2]) : a;
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

export function formatReps(min, max) {
  const lo = Math.round(min);
  const hi = Math.round(max);
  if (lo === hi) return String(lo);
  return `${lo}-${hi}`;
}

export function incrementsFor(plan) {
  const unit = plan?.unit === "kg" ? "kg" : "lb";
  const over = plan?.program?.progressionDefaults?.increments || {};
  const known = {};
  for (const key of ["barbell", "dumbbell", "machine", "bodyweight"]) {
    if (typeof over[key] === "number" && over[key] >= 0) known[key] = over[key];
  }
  return { ...DEFAULT_INCREMENTS[unit], ...known };
}

export function rulesFor(plan, exercise) {
  const defaults = plan?.program?.progressionDefaults || {};
  const own = exercise?.progression || {};
  const inc = incrementsFor(plan);
  const equipment = exercise?.equipment;
  const equipmentStep = equipment && equipment !== "bodyweight" ? inc[equipment] : 0;
  const pick = (ownValue, defaultValue, fallback) => (
    ownValue != null ? ownValue : defaultValue != null ? defaultValue : fallback
  );
  return {
    addLoad: own.addLoad != null ? own.addLoad : equipmentStep,
    weightedBodyweightStep: inc.dumbbell,
    holdWithinReps: pick(own.holdWithinReps, defaults.holdWithinReps, DEFAULT_RULES.holdWithinReps),
    holdRpeOver: pick(own.holdRpeOver, defaults.holdRpeOver, DEFAULT_RULES.holdRpeOver),
    afterMisses: pick(own.backoff?.afterMisses, defaults.backoff?.afterMisses, DEFAULT_RULES.afterMisses),
    dropPercent: pick(own.backoff?.dropPercent, defaults.backoff?.dropPercent, DEFAULT_RULES.dropPercent),
    ifMiss: own.ifMiss || defaults.ifMiss || DEFAULT_RULES.ifMiss,
    increments: inc,
  };
}

export function lookup1rm(plan, exercise) {
  const table = plan?.oneRepMaxes;
  if (!table || typeof table !== "object") return null;
  if (typeof table[exercise.name] === "number") return table[exercise.name];
  if (typeof table[exercise.id] === "number") return table[exercise.id];
  return null;
}

export function resolveLoad(set, exercise, plan) {
  if (typeof set?.load === "number") return set.load;
  if (typeof set?.percent1rm === "number") {
    const max = lookup1rm(plan, exercise);
    if (max == null) return null;
    const step = incrementsFor(plan)[exercise.equipment] || 0;
    return roundToStep(max * (set.percent1rm / 100), step);
  }
  return null;
}

export function suggestWarmups(exercise, unit, firstWorkingLoad) {
  if (!exercise || exercise.equipment !== "barbell") return [];
  if ((exercise.sets || []).some(isWarmup)) return [];
  if (typeof firstWorkingLoad !== "number" || firstWorkingLoad <= 0) return [];
  const bar = unit === "kg" ? 20 : 45;
  const step = unit === "kg" ? 2.5 : 5;
  const out = [];
  if (firstWorkingLoad > bar) {
    out.push({ set: "W1", reps: "5", load: bar, restSec: 60, suggested: true, note: "Suggested empty bar" });
  }
  const mid = roundToStep(firstWorkingLoad * 0.5, step);
  if (mid > bar && mid < firstWorkingLoad) {
    out.push({ set: "W2", reps: "5", load: mid, restSec: 90, suggested: true, note: "Suggested" });
  }
  return out;
}

/**
 * hit: top of the rep target, and RPE at or under target (when both are logged).
 * close: within holdWithinReps of the rep target, or RPE over target but within holdRpeOver.
 * miss: shorter than that, or RPE further over the target than holdRpeOver.
 * A blank logged RPE does not block a rep hit.
 */
export function classifySet(targetReps, targetRpe, performed, rules) {
  const target = parseReps(targetReps);
  const reps = performed?.reps;
  if (!target || typeof reps !== "number" || !Number.isFinite(reps)) return "miss";

  const closeFloor = target.min - rules.holdWithinReps;
  let grade;
  if (reps >= target.max) grade = "hit";
  else if (reps >= closeFloor) grade = "close";
  else grade = "miss";

  if (typeof targetRpe === "number" && typeof performed.rpe === "number") {
    if (performed.rpe > targetRpe + rules.holdRpeOver) return "miss";
    if (performed.rpe > targetRpe && grade === "hit") grade = "close";
  }
  return grade;
}

export function combineGrades(grades) {
  if (!grades.length) return "hold";
  if (grades.some((grade) => grade === "miss")) return "miss";
  if (grades.some((grade) => grade === "close")) return "hold";
  return "progress";
}

export function deload(load, dropPercent, step) {
  const raw = load * (1 - dropPercent / 100);
  if (!step || step <= 0) {
    const next = clean(raw);
    return next < load ? next : load;
  }
  let next = roundDownToStep(raw, step);
  if (next < step) next = step;
  if (next >= load - 1e-6) {
    const stepped = clean(load - step);
    if (stepped >= step && stepped < load - 1e-6) return stepped;
    return load;
  }
  return clean(next);
}

export function advanceLoad(load, outcome, streak, rules, step) {
  if (typeof load !== "number" || !Number.isFinite(load)) return null;
  if (outcome === "progress") return step > 0 ? clean(load + step) : load;
  if (outcome === "hold") return load;
  if (rules.ifMiss === "hold") return load;
  if (streak >= rules.afterMisses) return deload(load, rules.dropPercent, step);
  return load;
}

export function advanceReps(reps, outcome, streak, rules) {
  const target = parseReps(reps);
  if (!target) return reps;
  if (outcome === "progress") return formatReps(target.min + 1, target.max + 1);
  if (outcome === "hold") return String(reps);
  if (rules.ifMiss === "hold") return String(reps);
  if (streak >= rules.afterMisses) {
    const min = Math.max(1, Math.floor(target.min * (1 - rules.dropPercent / 100)));
    const max = Math.max(min, Math.floor(target.max * (1 - rules.dropPercent / 100)));
    const next = formatReps(min, max);
    return next === formatReps(target.min, target.max) ? String(reps) : next;
  }
  return String(reps);
}

function usesRepProgression(exercise, baseLoad) {
  return exercise.equipment === "bodyweight" && (baseLoad == null || baseLoad === 0);
}

/**
 * Apply one logged session of an exercise.
 * Miss streak counts consecutive misses only. A hold or a progressed session clears it.
 * Back-off resets the streak after the load (or the rep target) actually drops.
 */
export function advanceExercise(exercise, workItems, rules, prev = { missStreak: 0 }) {
  const grades = workItems.map((item) => (
    classifySet(item.targetReps, item.targetRpe, item.performed, rules)
  ));
  const outcome = combineGrades(grades);
  let streak = prev?.missStreak || 0;
  if (outcome === "miss") streak += 1;
  else streak = 0;

  const loads = {};
  const reps = {};
  const previous = { loads: {}, reps: {} };
  let changed = false;

  for (const item of workItems) {
    const key = String(item.setId);
    const loggedLoad = typeof item.performed?.load === "number" ? item.performed.load : null;
    const baseLoad = loggedLoad != null ? loggedLoad : (item.targetLoad ?? null);
    previous.loads[key] = baseLoad;
    previous.reps[key] = item.targetReps;

    if (usesRepProgression(exercise, baseLoad)) {
      const nextReps = advanceReps(item.targetReps, outcome, streak, rules);
      reps[key] = nextReps;
      loads[key] = null;
      if (nextReps !== String(item.targetReps)) changed = true;
    } else {
      const step = exercise.equipment === "bodyweight" ? rules.weightedBodyweightStep : rules.addLoad;
      const nextLoad = advanceLoad(baseLoad, outcome, streak, rules, step);
      loads[key] = nextLoad;
      reps[key] = item.targetReps;
      if (typeof nextLoad === "number" && typeof baseLoad === "number" && nextLoad < baseLoad - 1e-6) {
        changed = true;
      }
      if (typeof nextLoad === "number" && typeof baseLoad === "number" && nextLoad > baseLoad + 1e-6) {
        changed = true;
      }
    }
  }

  let lastOutcome = outcome;
  if (outcome === "miss" && rules.ifMiss !== "hold" && streak >= rules.afterMisses) {
    if (changed) {
      lastOutcome = "backoff";
      streak = 0;
    }
  }

  return {
    loads,
    reps,
    previous,
    missStreak: streak,
    lastOutcome,
  };
}
