import {
  advanceExercise,
  isWarmup,
  resolveLoad,
  rulesFor,
  suggestWarmups,
} from "./progression.mjs";

export function emptyState() {
  return {
    version: 1,
    plan: null,
    importedAt: null,
    log: [],
    working: {},
    draft: null,
    focus: null,
  };
}

export function weekdayKey(date) {
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][date.getDay()];
}

function isLogged(state, weekIndex, dayIndex) {
  return state.log.some((entry) => entry.weekIndex === weekIndex && entry.dayIndex === dayIndex);
}

export function locateToday(state, date) {
  const plan = state?.plan;
  if (!plan) return null;
  if (state.draft && Number.isInteger(state.draft.weekIndex)) {
    return { weekIndex: state.draft.weekIndex, dayIndex: state.draft.dayIndex, reason: "draft" };
  }
  const key = weekdayKey(date);
  const weeks = plan.program.weeks;
  for (let weekIndex = 0; weekIndex < weeks.length; weekIndex += 1) {
    const days = weeks[weekIndex].days;
    const unlogged = days
      .map((day, dayIndex) => ({ day, dayIndex }))
      .filter(({ dayIndex }) => !isLogged(state, weekIndex, dayIndex));
    if (unlogged.length === 0) continue;
    const today = unlogged.find(({ day }) => day.weekday === key);
    if (today) return { weekIndex, dayIndex: today.dayIndex, reason: "weekday" };
    return { weekIndex, dayIndex: unlogged[0].dayIndex, reason: "next" };
  }
  const lastWeek = weeks.length - 1;
  const lastDay = weeks[lastWeek].days.length - 1;
  return { weekIndex: lastWeek, dayIndex: lastDay, reason: "done" };
}

function targetFor(plan, exercise, set, ctx) {
  const key = String(set.set);
  if (ctx.prescribed) {
    const saved = ctx.prescribed.find((row) => (
      row.exerciseId === exercise.id && String(row.set) === key
    ));
    if (saved) return { load: saved.load ?? null, reps: saved.reps, rpe: saved.rpe ?? null };
  }
  if (ctx.useWorking && !isWarmup(set)) {
    const working = ctx.working?.[exercise.id];
    if (working?.loads && Object.prototype.hasOwnProperty.call(working.loads, key)) {
      return {
        load: working.loads[key],
        reps: working.reps?.[key] || set.reps,
        rpe: typeof set.rpe === "number" ? set.rpe : null,
      };
    }
  }
  return {
    load: resolveLoad(set, exercise, plan),
    reps: set.reps,
    rpe: typeof set.rpe === "number" ? set.rpe : null,
  };
}

function makeItem(exercise, entry, extra) {
  const set = entry.set;
  const warmup = Boolean(entry.suggested) || isWarmup(set);
  return {
    exerciseId: exercise.id,
    exerciseName: exercise.name,
    equipment: exercise.equipment,
    setId: set.set,
    warmup,
    suggested: Boolean(entry.suggested),
    required: !warmup,
    targetReps: entry.target.reps,
    targetLoad: entry.target.load,
    targetRpe: entry.target.rpe,
    restSec: extra.restSec,
    restAfter: extra.restAfter,
    superset: extra.superset,
    round: extra.round,
    note: set.note || null,
  };
}

function straightEntries(plan, exercise, ctx) {
  const entries = [];
  const firstWork = exercise.sets.find((set) => !isWarmup(set));
  const firstTarget = firstWork ? targetFor(plan, exercise, firstWork, ctx) : null;
  const allowSuggest = ctx.useWorking !== false && !ctx.prescribed;
  if (allowSuggest && !exercise.sets.some(isWarmup)) {
    for (const suggestion of suggestWarmups(exercise, plan.unit, firstTarget?.load)) {
      entries.push({
        set: suggestion,
        target: { load: suggestion.load, reps: suggestion.reps, rpe: null },
        suggested: true,
        restSec: suggestion.restSec,
      });
    }
  }
  for (const set of exercise.sets) {
    entries.push({
      set,
      target: targetFor(plan, exercise, set, ctx),
      suggested: false,
      restSec: set.restSec,
    });
  }
  return entries;
}

export function buildQueue(plan, day, ctx = {}) {
  const exercises = [...day.exercises].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const blocks = [];
  const seen = new Set();
  for (const exercise of exercises) {
    if (exercise.superset) {
      if (seen.has(exercise.superset)) continue;
      seen.add(exercise.superset);
      const members = exercises.filter((item) => item.superset === exercise.superset);
      blocks.push({
        type: members.length > 1 ? "superset" : "straight",
        superset: members.length > 1 ? exercise.superset : null,
        exercises: members,
      });
    } else {
      blocks.push({ type: "straight", superset: null, exercises: [exercise] });
    }
  }

  const queue = [];
  for (const block of blocks) {
    if (block.type === "straight") {
      const exercise = block.exercises[0];
      for (const entry of straightEntries(plan, exercise, ctx)) {
        queue.push(makeItem(exercise, entry, {
          restAfter: true,
          restSec: entry.restSec || 0,
          superset: null,
          round: null,
        }));
      }
      continue;
    }
    const prepared = block.exercises.map((exercise) => ({
      exercise,
      sets: exercise.sets.map((set) => ({ set, target: targetFor(plan, exercise, set, ctx) })),
    }));
    const maxSets = Math.max(...prepared.map((item) => item.sets.length));
    for (let roundIndex = 0; roundIndex < maxSets; roundIndex += 1) {
      const round = [];
      for (const item of prepared) {
        if (roundIndex < item.sets.length) {
          round.push({ exercise: item.exercise, entry: item.sets[roundIndex] });
        }
      }
      const restSec = Math.max(...round.map((item) => Number(item.entry.set.restSec) || 0));
      round.forEach((item, index) => {
        const last = index === round.length - 1;
        queue.push(makeItem(item.exercise, {
          set: item.entry.set,
          target: item.entry.target,
          suggested: false,
        }, {
          restAfter: last,
          restSec: last ? restSec : 0,
          superset: block.superset,
          round: roundIndex + 1,
        }));
      });
    }
  }
  if (queue.length) {
    queue[queue.length - 1] = { ...queue[queue.length - 1], restAfter: false, restSec: 0 };
  }
  return queue;
}

export function targetsForDay(state, weekIndex, dayIndex) {
  const plan = state.plan;
  const week = plan.program.weeks[weekIndex];
  const day = week.days[dayIndex];
  const logged = state.log.find((entry) => entry.weekIndex === weekIndex && entry.dayIndex === dayIndex) || null;
  const queue = buildQueue(plan, day, {
    working: state.working,
    prescribed: logged?.prescribed || null,
    useWorking: !logged,
  });
  if (logged) {
    for (const item of queue) {
      const hit = logged.performed.find((row) => (
        row.exerciseId === item.exerciseId && String(row.set) === String(item.setId)
      ));
      if (hit) item.actual = { reps: hit.reps, load: hit.load, rpe: hit.rpe };
    }
  }
  return {
    week,
    day,
    weekIndex,
    dayIndex,
    queue,
    logged: Boolean(logged),
    results: logged?.results || null,
  };
}

function makeLogId() {
  return `log-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function nextCursor(plan, weekIndex, dayIndex) {
  const weeks = plan.program.weeks;
  if (dayIndex + 1 < weeks[weekIndex].days.length) {
    return { weekIndex, dayIndex: dayIndex + 1, complete: false };
  }
  if (weekIndex + 1 < weeks.length) {
    return { weekIndex: weekIndex + 1, dayIndex: 0, complete: false };
  }
  return { weekIndex, dayIndex, complete: true };
}

export function finishSession(state, { weekIndex, dayIndex, performed, at }) {
  if (!state?.plan) return { ok: false, state, errors: ["Import a plan before logging."] };
  const week = state.plan.program.weeks[weekIndex];
  const day = week?.days?.[dayIndex];
  if (!day) return { ok: false, state, errors: ["That session is not in the plan."] };
  if (isLogged(state, weekIndex, dayIndex)) {
    return { ok: false, state, errors: ["This session is already logged."] };
  }

  const view = targetsForDay(state, weekIndex, dayIndex);
  const working = { ...state.working };
  const results = [];
  const prescribed = [];
  const rows = performed || [];

  for (const exercise of [...day.exercises].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    const rules = rulesFor(state.plan, exercise);
    const workItems = [];
    for (const set of exercise.sets) {
      if (isWarmup(set)) continue;
      const item = view.queue.find((entry) => (
        entry.exerciseId === exercise.id && String(entry.setId) === String(set.set) && entry.required
      ));
      const done = rows.find((row) => (
        row.exerciseId === exercise.id && String(row.set) === String(set.set)
      )) || null;
      const targetReps = item?.targetReps ?? set.reps;
      const targetLoad = item ? item.targetLoad : resolveLoad(set, exercise, state.plan);
      const targetRpe = item ? item.targetRpe : (typeof set.rpe === "number" ? set.rpe : null);
      prescribed.push({
        exerciseId: exercise.id,
        set: set.set,
        reps: targetReps,
        load: targetLoad,
        rpe: targetRpe,
      });
      workItems.push({ setId: set.set, targetReps, targetLoad, targetRpe, performed: done });
    }
    const next = advanceExercise(exercise, workItems, rules, working[exercise.id]);
    working[exercise.id] = next;
    results.push({
      exerciseId: exercise.id,
      name: exercise.name,
      outcome: next.lastOutcome,
      missStreak: next.missStreak,
    });
  }

  const cursor = nextCursor(state.plan, weekIndex, dayIndex);
  const entry = {
    id: makeLogId(),
    at: at || new Date().toISOString(),
    weekIndex,
    dayIndex,
    dayId: day.id,
    performed: rows,
    prescribed,
    results,
  };

  return {
    ok: true,
    state: {
      ...state,
      working,
      draft: null,
      focus: { weekIndex: cursor.weekIndex, dayIndex: cursor.dayIndex },
      log: [...state.log, entry],
    },
  };
}

export function eachExercise(plan) {
  const seen = new Set();
  const rows = [];
  for (const week of plan.program.weeks) {
    for (const day of week.days) {
      const exercises = [...day.exercises].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      for (const exercise of exercises) {
        if (seen.has(exercise.id)) continue;
        seen.add(exercise.id);
        rows.push({ exercise, week, day });
      }
    }
  }
  return rows;
}

export function progressionRows(state) {
  if (!state?.plan) return [];
  return eachExercise(state.plan).map(({ exercise }) => {
    const working = state.working[exercise.id] || null;
    const first = firstWorkingTargets(state.plan, exercise);
    return {
      id: exercise.id,
      name: exercise.name,
      equipment: exercise.equipment,
      unit: state.plan.unit,
      lastOutcome: working?.lastOutcome || null,
      missStreak: working?.missStreak || 0,
      previous: working?.previous || first,
      next: working ? { loads: working.loads, reps: working.reps } : null,
      rules: rulesFor(state.plan, exercise),
    };
  });
}

function firstWorkingTargets(plan, exercise) {
  const loads = {};
  const reps = {};
  for (const set of exercise.sets) {
    if (isWarmup(set)) continue;
    const key = String(set.set);
    loads[key] = resolveLoad(set, exercise, plan);
    reps[key] = set.reps;
  }
  return { loads, reps };
}

export function overviewCards(day, queue) {
  const byId = new Map();
  for (const item of queue) {
    if (!byId.has(item.exerciseId)) byId.set(item.exerciseId, []);
    byId.get(item.exerciseId).push(item);
  }
  const exercises = [...day.exercises].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const cards = [];
  const seen = new Set();
  for (const exercise of exercises) {
    if (exercise.superset) {
      const key = `ss:${exercise.superset}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const members = exercises.filter((item) => item.superset === exercise.superset);
      const paired = members.length > 1;
      cards.push({
        type: paired ? "superset" : "straight",
        superset: paired ? exercise.superset : null,
        members: members.map((member) => summarizeMember(member, byId.get(member.id) || [], queue)),
      });
    } else {
      cards.push({
        type: "straight",
        superset: null,
        members: [summarizeMember(exercise, byId.get(exercise.id) || [], queue)],
      });
    }
  }
  return cards;
}

function summarizeMember(exercise, items, queue) {
  const required = items.filter((item) => item.required);
  const suggested = items.filter((item) => item.suggested);
  const roundRest = exercise.superset
    ? queue.find((item) => item.superset === exercise.superset && item.restAfter && item.restSec > 0)
    : null;
  const ownRest = required.reduce((max, item) => Math.max(max, item.restSec || 0), 0);
  return {
    id: exercise.id,
    name: exercise.name,
    equipment: exercise.equipment,
    note: exercise.note || null,
    sets: required.length,
    reps: [...new Set(required.map((item) => item.targetReps))],
    loads: [...new Set(required.map((item) => item.targetLoad))],
    rpe: required.find((item) => typeof item.targetRpe === "number")?.targetRpe ?? null,
    restSec: roundRest ? roundRest.restSec : ownRest,
    suggested,
  };
}
