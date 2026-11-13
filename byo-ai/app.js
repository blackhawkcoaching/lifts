import { esc, formatClock, formatDate, formatNum, formatRepsLabel, WEEKDAY_LABEL, WEEKDAY_SHORT } from "./src/format.mjs";
import { importPlan, parseAndValidate } from "./src/liftplan.mjs";
import { clean, incrementsFor, parseReps } from "./src/progression.mjs";
import { PROMPT } from "./src/prompt.mjs";
import { finishSession, locateToday, overviewCards, progressionRows, targetsForDay } from "./src/session.mjs";
import { loadState, saveState } from "./src/store.mjs";

const root = document.querySelector("#app");
const schema = await fetch(new URL("./schema/liftplan-0.1.schema.json", import.meta.url)).then((res) => {
  if (!res.ok) throw new Error("schema");
  return res.json();
});

let state = loadState(localStorage);
let view = "today";
let planPane = "import";
let importText = "";
let report = null;
let entry = { key: "", reps: 5, load: null, rpe: 8 };
let toast = "";
let toastTimer = 0;

function persist() {
  saveState(localStorage, state);
}

function flash(message) {
  toast = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast = "";
    render();
  }, 2200);
  render();
}

function focused() {
  if (!state.plan) return null;
  const weeks = state.plan.program.weeks;
  if (state.focus && weeks[state.focus.weekIndex]?.days[state.focus.dayIndex]) return state.focus;
  return locateToday(state, new Date());
}

function sessionView(focus = focused()) {
  if (!focus || !state.plan) return null;
  return targetsForDay(state, focus.weekIndex, focus.dayIndex);
}

function brand() {
  return `
    <header class="top">
      <div class="brand">
        <svg viewBox="0 0 36 36" aria-hidden="true">
          <rect x="1" y="1" width="34" height="34" rx="8" fill="#141414"/>
          <path d="M9 25 L18 9 L27 25" fill="none" stroke="#fffcf8" stroke-width="1.7"/>
          <path d="M12.5 25 L18 15 L23.5 25" fill="none" stroke="#fffcf8" stroke-width="1.7"/>
          <circle cx="18" cy="25.5" r="1.3" fill="#7c3a2d"/>
        </svg>
        <div>
          <p class="word">BLACK HAWK</p>
          <p class="sub">Coaching · workout log</p>
        </div>
      </div>
      <p class="disclaimer">Not medical or coaching advice. Your AI writes the plan. You train at your own risk.</p>
    </header>`;
}

function nav() {
  const current = view === "log" ? "today" : view;
  const item = (id, label) => `<button type="button" data-nav="${id}" class="${current === id ? "on" : ""}">${label}</button>`;
  return `<nav class="nav">${item("today", "Today")}${item("progress", "Progress")}${item("plan", "Plan")}</nav>`;
}

function toastHtml() {
  return toast ? `<div class="toast" role="status">${esc(toast)}</div>` : "";
}

function loadText(values, equipment, unit) {
  const nums = values.filter((value) => typeof value === "number");
  if (!nums.length) return "Bodyweight";
  const uniq = [...new Set(nums.map((value) => clean(value)))].sort((a, b) => a - b);
  const text = uniq.length === 1 ? formatNum(uniq[0]) : `${formatNum(uniq[0])}–${formatNum(uniq[uniq.length - 1])}`;
  return equipment === "dumbbell" ? `${text} ${unit} each` : `${text} ${unit}`;
}

function repsText(reps) {
  if (!reps.length) return "";
  return reps.map(formatRepsLabel).join(" / ");
}

function renderToday() {
  if (!state.plan) {
    return `
      <section class="empty">
        <p class="kicker">${esc(formatDate(new Date()))}</p>
        <h1>Bring your own plan</h1>
        <p class="lede">Write the workout you want, paste the prompt into your AI, then bring the JSON back here. The log stays on this phone.</p>
        <div class="stack">
          <button type="button" class="primary" data-action="open-prompt">Copy the prompt</button>
          <button type="button" class="ghost" data-action="open-import">Import a plan</button>
        </div>
      </section>`;
  }

  const focus = focused();
  const data = sessionView(focus);
  const weeks = state.plan.program.weeks;
  const week = weeks[focus.weekIndex];
  const cards = overviewCards(data.day, data.queue);
  const unit = state.plan.unit;
  const reason = state.focus ? "session" : locateToday(state, new Date())?.reason;
  const kicker = reason === "weekday" || !state.focus
    ? formatDate(new Date())
    : `Week ${week.week}`;

  const pills = week.days.map((day, dayIndex) => {
    const on = dayIndex === focus.dayIndex;
    const logged = state.log.some((entry) => entry.weekIndex === focus.weekIndex && entry.dayIndex === dayIndex);
    const label = day.weekday ? WEEKDAY_SHORT[day.weekday] : `Day ${dayIndex + 1}`;
    return `<button type="button" class="pill${on ? " on" : ""}" data-action="focus-day" data-week="${focus.weekIndex}" data-day="${dayIndex}">${label}${logged ? "<small>Logged</small>" : ""}</button>`;
  }).join("");

  const cardHtml = cards.map((card) => {
    const lifts = card.members.map((member) => {
      const warm = member.suggested.map((item) => `${formatNum(item.targetLoad)} × ${formatRepsLabel(item.targetReps)}`).join(", ");
      return `
        <div class="lift">
          <p class="eq">${esc(member.equipment)}</p>
          <h2>${esc(member.name)}</h2>
          <p class="meta">${member.sets} × ${esc(repsText(member.reps))} · ${esc(loadText(member.loads, member.equipment, unit))}${member.rpe != null ? ` · RPE ${esc(formatNum(member.rpe))}` : ""}</p>
          <p class="meta">${card.type === "superset" ? "One rest per round" : "Rest"} · ${esc(String(member.restSec))}s</p>
          ${member.note ? `<p class="note">${esc(member.note)}</p>` : ""}
          ${warm ? `<p class="warm">Suggested barbell warm-up: ${esc(warm)}</p>` : ""}
        </div>`;
    }).join("");
    return `<article class="card${card.type === "superset" ? " ss" : ""}">${card.type === "superset" ? `<p class="ss-label">Superset ${esc(card.superset)}</p>` : ""}${lifts}</article>`;
  }).join("");

  const action = data.logged
    ? `<div class="stack"><button type="button" class="ghost" data-nav="progress">Session logged · view progress</button></div>`
    : `<div class="dock"><button type="button" class="primary" data-action="start-log">Log this session</button></div>`;

  return `
    <p class="kicker">${esc(kicker)}</p>
    <h1>${esc(data.day.name)}</h1>
    <p class="lede">${esc(WEEKDAY_LABEL[data.day.weekday] || "Session")} · Week ${esc(week.week)} · ${esc(state.plan.name)}</p>
    <div class="weekbar">
      <button type="button" class="iconbtn" data-action="shift-week" data-dir="-1" aria-label="Previous week" ${focus.weekIndex === 0 ? "disabled" : ""}>‹</button>
      <div class="grow">Week ${esc(week.week)} of ${weeks.length}</div>
      <button type="button" class="iconbtn" data-action="shift-week" data-dir="1" aria-label="Next week" ${focus.weekIndex === weeks.length - 1 ? "disabled" : ""}>›</button>
    </div>
    <div class="pills">${pills}</div>
    ${data.day.note ? `<p class="lede">${esc(data.day.note)}</p>` : ""}
    ${cardHtml}
    ${action}`;
}

function draftQueue() {
  if (!state.draft || !state.plan) return null;
  return targetsForDay(state, state.draft.weekIndex, state.draft.dayIndex);
}

function syncEntry(item, index) {
  const key = String(index);
  if (entry.key === key) return;
  entry = {
    key,
    reps: parseReps(item.targetReps)?.max ?? 5,
    load: item.targetLoad,
    rpe: item.targetRpe ?? 8,
  };
}

function readEntry() {
  const reps = document.getElementById("in-reps");
  const load = document.getElementById("in-load");
  const rpe = document.getElementById("in-rpe");
  if (reps && reps.value !== "") entry.reps = Number(reps.value);
  if (load && load.value !== "") entry.load = Number(load.value);
  if (rpe && rpe.value !== "") entry.rpe = Number(rpe.value);
}

function renderLog() {
  const data = draftQueue();
  if (!data) return renderToday();
  const queue = data.queue;
  const index = state.draft.index;
  const required = queue.filter((item) => item.required);
  const doneRequired = required.filter((item) => state.draft.performed.some((row) => (
    row.exerciseId === item.exerciseId && String(row.set) === String(item.setId)
  ))).length;
  const resting = state.draft.restUntil && state.draft.restUntil > Date.now() - 500;
  const left = state.draft.restUntil ? (state.draft.restUntil - Date.now()) / 1000 : 0;
  const last = state.draft.performed.at(-1);
  const lastItem = last && queue.find((item) => item.exerciseId === last.exerciseId && String(item.setId) === String(last.set));
  const just = last ? `Just logged · ${lastItem?.exerciseName || last.exerciseId} · ${last.reps} × ${last.load == null ? "bodyweight" : `${formatNum(last.load)} ${state.plan.unit}`}${last.rpe != null ? ` · RPE ${formatNum(last.rpe)}` : ""}` : "";

  let body;
  if (index >= queue.length) {
    body = `
      <h1>Session ready to save</h1>
      <p class="lede">${doneRequired} of ${required.length} working sets logged.</p>
      <div class="stack"><button type="button" class="primary" data-action="finish">Finish session</button></div>`;
  } else {
    const item = queue[index];
    syncEntry(item, index);
    const same = queue.filter((entryItem) => entryItem.exerciseId === item.exerciseId && entryItem.required);
    const setNo = same.findIndex((entryItem) => entryItem === item) + 1;
    const roundCount = item.superset ? Math.max(...queue.filter((entryItem) => entryItem.superset === item.superset).map((entryItem) => entryItem.round || 1)) : null;
    const title = item.suggested ? "Suggested warm-up" : item.exerciseName;
    const context = item.superset
      ? `Superset ${esc(item.superset)} · round ${item.round} of ${roundCount}`
      : item.suggested ? "Barbell only · not counted for progression" : `Set ${setNo || 1} of ${same.length}`;
    const loadField = item.equipment === "bodyweight" && (entry.load == null || entry.load === 0)
      ? `<div class="field"><span>Load</span><div class="bw">Bodyweight</div></div>`
      : `<div class="field"><span>Load · ${esc(state.plan.unit)}${item.equipment === "dumbbell" ? " each" : ""}</span>
          <div class="stepper">
            <button type="button" data-action="step" data-field="load" data-dir="-1" aria-label="Less weight">−</button>
            <input id="in-load" type="number" inputmode="decimal" step="any" value="${entry.load ?? ""}" aria-label="Load">
            <button type="button" data-action="step" data-field="load" data-dir="1" aria-label="More weight">+</button>
          </div></div>`;
    body = `
      <p class="kicker">${esc(data.day.name)}</p>
      <h1>${esc(title)}</h1>
      <p class="progress-line">${esc(context)} · ${doneRequired} of ${required.length} working sets</p>
      <p class="target">Target ${esc(formatRepsLabel(item.targetReps))}${item.targetLoad == null ? "" : ` · ${esc(loadText([item.targetLoad], item.equipment, state.plan.unit))}`}${item.targetRpe != null ? ` · RPE ${esc(formatNum(item.targetRpe))}` : ""}</p>
      <div class="field"><span>Reps</span>
        <div class="stepper">
          <button type="button" data-action="step" data-field="reps" data-dir="-1" aria-label="Fewer reps">−</button>
          <input id="in-reps" type="number" inputmode="numeric" step="1" value="${esc(entry.reps)}" aria-label="Reps">
          <button type="button" data-action="step" data-field="reps" data-dir="1" aria-label="More reps">+</button>
        </div>
      </div>
      ${loadField}
      <div class="field"><span>RPE</span>
        <div class="stepper">
          <button type="button" data-action="step" data-field="rpe" data-dir="-1" aria-label="Lower RPE">−</button>
          <input id="in-rpe" type="number" inputmode="decimal" step="0.5" value="${esc(entry.rpe)}" aria-label="RPE">
          <button type="button" data-action="step" data-field="rpe" data-dir="1" aria-label="Higher RPE">+</button>
        </div>
      </div>
      <div class="stack">
        <button type="button" class="primary" data-action="log-set">${item.suggested ? "Log warm-up" : "Log set"}</button>
        ${item.suggested ? `<button type="button" class="ghost" data-action="skip-suggested">Skip warm-up</button>` : ""}
      </div>`;
  }

  const timer = resting ? `
    <section class="timer" aria-live="polite">
      <div class="row"><div class="lbl" id="rest-state">${left <= 0 ? "Rest done" : "Rest"}</div><div class="clock${left <= 0 ? " done" : ""}" id="rest-clock">${left <= 0 ? "0:00" : formatClock(left)}</div></div>
      <p>${esc(state.draft.restNote || "Rest")}</p>
      <div class="row2">
        <button type="button" data-action="add-rest">+30s</button>
        <button type="button" class="primary" data-action="skip-rest">${left <= 0 ? "Continue" : "Skip"}</button>
      </div>
    </section>` : "";

  return `<section class="logger">${timer}${body}${just ? `<p class="just">${esc(just)}</p>` : ""}</section>`;
}

function bagText(bag, equipment, unit) {
  if (!bag) return "—";
  const loads = Object.values(bag.loads || {}).filter((value) => typeof value === "number");
  if (loads.length) return loadText(loads, equipment, unit);
  const reps = Object.values(bag.reps || {}).filter(Boolean);
  if (reps.length) return formatRepsLabel(reps[0]);
  return equipment === "bodyweight" ? "Bodyweight" : "—";
}

function renderProgress() {
  if (!state.plan) return renderToday();
  const rows = progressionRows(state);
  const inc = incrementsFor(state.plan);
  const unit = state.plan.unit;
  const deloads = rows.filter((row) => row.lastOutcome === "backoff");
  const callouts = deloads.map((row) => `
    <article class="card callout">
      <p class="tag backoff">Deload</p>
      <strong>${esc(row.name)}</strong>
      <p class="loads">${esc(bagText(row.previous, row.equipment, unit))} → ${esc(bagText(row.next, row.equipment, unit))}</p>
      <p class="fine">Repeated misses. Load dropped about ${esc(formatNum(row.rules.dropPercent))}% and the miss streak reset.</p>
    </article>`).join("");
  const list = rows.map((row) => {
    const outcome = row.lastOutcome;
    const label = outcome === "progress" ? "Added load" : outcome === "hold" ? "Held" : outcome === "miss" ? "Missed" : outcome === "backoff" ? "Deload" : "Not logged yet";
    const next = row.next ? bagText(row.next, row.equipment, unit) : bagText(row.previous, row.equipment, unit);
    const prev = bagText(row.previous, row.equipment, unit);
    const arrow = outcome ? `${prev} → ${next}` : next;
    let fine = "";
    if (outcome === "miss" && row.missStreak > 0 && row.missStreak < row.rules.afterMisses) {
      fine = `${row.missStreak} miss in a row. One more drops about ${formatNum(row.rules.dropPercent)}%.`;
    } else if (outcome === "progress" && row.equipment === "dumbbell") {
      fine = `Dumbbells move ${formatNum(inc.dumbbell)} ${unit} per hand.`;
    } else if (outcome === "progress" && row.equipment === "bodyweight") {
      fine = "Bodyweight work adds a rep when every set hits.";
    } else if (!outcome) {
      fine = "Logs change this after the session is finished.";
    }
    return `
      <article class="card">
        <p class="tag ${esc(outcome || "")}">${esc(label)}</p>
        <h2>${esc(row.name)}</h2>
        <p class="eq">${esc(row.equipment)}</p>
        <p class="loads">${esc(arrow)}</p>
        ${fine ? `<p class="fine">${esc(fine)}</p>` : ""}
      </article>`;
  }).join("");

  return `
    <p class="kicker">Progress</p>
    <h1>${state.log.length ? `${state.log.length} session${state.log.length === 1 ? "" : "s"} logged` : "Nothing logged yet"}</h1>
    <p class="rules">Add load when every working set hits the top reps at or under the target RPE. Hold within ${esc(formatNum(rows[0]?.rules.holdWithinReps ?? 1))} rep or ${esc(formatNum(rows[0]?.rules.holdRpeOver ?? 1))} RPE. After ${esc(String(rows[0]?.rules.afterMisses ?? 2))} misses in a row, drop about ${esc(formatNum(rows[0]?.rules.dropPercent ?? 10))}%. Jumps: barbell ${esc(formatNum(inc.barbell))} ${esc(unit)}, dumbbell ${esc(formatNum(inc.dumbbell))} ${esc(unit)} each hand, machine ${esc(formatNum(inc.machine))} ${esc(unit)}.</p>
    ${callouts}
    ${list}`;
}

function renderPlan() {
  const panes = `
    <div class="panes">
      <button type="button" class="pill${planPane === "import" ? " on" : ""}" data-action="plan-pane" data-pane="import">Import</button>
      <button type="button" class="pill${planPane === "prompt" ? " on" : ""}" data-action="plan-pane" data-pane="prompt">Prompt</button>
    </div>`;
  if (planPane === "prompt") {
    return `
      ${panes}
      <h1>Prompt</h1>
      <p class="lede">Copy this into ChatGPT, Claude, Grok, Gemini, or any other AI. Under it, describe the training you want. Paste the JSON it returns into Import. This app does not call an AI.</p>
      <div class="stack"><button type="button" class="primary" data-action="copy-prompt">Copy prompt</button></div>
      <pre class="prompt">${esc(PROMPT)}</pre>`;
  }

  const preview = report?.ok ? report.preview : null;
  const days = preview ? preview.days.map((day) => `
    <div class="dayline"><strong>Wk ${esc(day.week)} · ${esc(day.weekday ? WEEKDAY_SHORT[day.weekday] : day.name)}</strong><span>${esc(day.name)} · ${day.exercises} lifts</span></div>`).join("") : "";
  const errors = report && !report.ok ? `<div class="errors">${report.errors.map((error) => `<p>${esc(error)}</p>`).join("")}</div>` : "";
  const warnings = report?.warnings?.length ? `<div class="warnings">${report.warnings.map((warning) => `<p>${esc(warning)}</p>`).join("")}</div>` : "";
  const previewHtml = preview ? `
    <article class="card" id="report">
      <div class="preview-head"><h2>${esc(preview.name)}</h2><span class="ok">Valid</span></div>
      <p class="meta">${esc(preview.unit)} · ${preview.weeks} weeks · ${preview.sessions} sessions · ${preview.sets} sets</p>
      ${days}
    </article>
    <div class="stack"><button type="button" class="primary" data-action="save-plan">Save on this phone</button></div>` : "";

  return `
    ${panes}
    <h1>Import</h1>
    <p class="lede">Paste the JSON your AI returned. A broken file is refused, and the log is kept.</p>
    <textarea id="plan-json" spellcheck="false" aria-label="Plan JSON">${esc(importText)}</textarea>
    <div class="stack">
      <button type="button" class="primary" data-action="validate">Check plan</button>
      <button type="button" class="ghost" data-action="load-sample">Use the included sample</button>
    </div>
    ${errors}
    ${warnings}
    ${previewHtml}
    <p class="fineprint">liftplan 0.1 · stored in this browser · nothing is uploaded · workout logging only</p>`;
}

function render() {
  const page = view === "log" ? renderLog() : view === "progress" ? renderProgress() : view === "plan" ? renderPlan() : renderToday();
  const docked = view === "today" && state.plan && !sessionView()?.logged;
  root.innerHTML = `${brand()}<main class="${docked ? "has-dock" : ""}">${page}</main>${nav()}${toastHtml()}`;
}

function stepSize(item) {
  const table = incrementsFor(state.plan);
  if (item.equipment === "bodyweight") return table.dumbbell || 1;
  return table[item.equipment] || 1;
}

function startLog() {
  const focus = focused();
  if (!focus) {
    view = "plan";
    render();
    return;
  }
  const data = targetsForDay(state, focus.weekIndex, focus.dayIndex);
  if (data.logged) {
    flash("That session is already logged.");
    return;
  }
  const sameDraft = state.draft && state.draft.weekIndex === focus.weekIndex && state.draft.dayIndex === focus.dayIndex;
  state.draft = sameDraft ? state.draft : {
    weekIndex: focus.weekIndex,
    dayIndex: focus.dayIndex,
    index: 0,
    performed: [],
    restUntil: null,
    restNote: "",
  };
  state.focus = { weekIndex: focus.weekIndex, dayIndex: focus.dayIndex };
  view = "log";
  entry.key = "";
  persist();
  render();
}

function logSet() {
  const data = draftQueue();
  const item = data?.queue[state.draft.index];
  if (!item) return;
  readEntry();
  const row = {
    exerciseId: item.exerciseId,
    set: item.setId,
    reps: entry.reps,
    load: item.equipment === "bodyweight" && (entry.load == null || entry.load === 0) ? null : entry.load,
    rpe: entry.rpe,
  };
  state.draft.performed = [...state.draft.performed, row];
  const nextIndex = state.draft.index + 1;
  if (item.restAfter && item.restSec > 0 && nextIndex < data.queue.length) {
    state.draft.restUntil = Date.now() + item.restSec * 1000;
    state.draft.restNote = item.superset ? `Superset ${item.superset} · one rest for the round` : item.exerciseName;
  } else {
    state.draft.restUntil = null;
    state.draft.restNote = "";
  }
  state.draft.index = nextIndex;
  entry.key = "";
  persist();
  render();
}

async function copyPrompt() {
  try {
    await navigator.clipboard.writeText(PROMPT);
  } catch {
    const area = document.createElement("textarea");
    area.value = PROMPT;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  flash("Prompt copied.");
}

document.body.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action], [data-nav]");
  if (!target || target.disabled) return;
  if (target.dataset.nav) {
    view = target.dataset.nav;
    if (view === "today") state.focus = null;
    if (view === "log") startLog();
    else render();
    return;
  }
  const action = target.dataset.action;
  if (action === "open-import") { view = "plan"; planPane = "import"; render(); }
  if (action === "open-prompt") { view = "plan"; planPane = "prompt"; render(); }
  if (action === "plan-pane") { planPane = target.dataset.pane; render(); }
  if (action === "copy-prompt") copyPrompt();
  if (action === "start-log") startLog();
  if (action === "focus-day") {
    state.focus = { weekIndex: Number(target.dataset.week), dayIndex: Number(target.dataset.day) };
    persist();
    render();
  }
  if (action === "shift-week") {
    const focus = focused();
    const weeks = state.plan.program.weeks;
    const weekIndex = Math.max(0, Math.min(weeks.length - 1, focus.weekIndex + Number(target.dataset.dir)));
    const weekday = weeks[focus.weekIndex].days[focus.dayIndex].weekday;
    let dayIndex = weeks[weekIndex].days.findIndex((day) => day.weekday && day.weekday === weekday);
    if (dayIndex < 0) dayIndex = Math.min(focus.dayIndex, weeks[weekIndex].days.length - 1);
    state.focus = { weekIndex, dayIndex };
    persist();
    render();
  }
  if (action === "step") {
    const data = draftQueue();
    const item = data.queue[state.draft.index];
    readEntry();
    const dir = Number(target.dataset.dir);
    if (target.dataset.field === "reps") entry.reps = Math.max(0, Math.min(50, Math.round(entry.reps + dir)));
    if (target.dataset.field === "rpe") entry.rpe = Math.max(1, Math.min(10, clean(entry.rpe + dir * 0.5)));
    if (target.dataset.field === "load") {
      const base = typeof entry.load === "number" ? entry.load : 0;
      entry.load = Math.max(0, clean(base + dir * stepSize(item)));
    }
    render();
  }
  if (action === "log-set") logSet();
  if (action === "skip-suggested") {
    state.draft.index += 1;
    state.draft.restUntil = null;
    entry.key = "";
    persist();
    render();
  }
  if (action === "skip-rest") {
    state.draft.restUntil = null;
    persist();
    render();
  }
  if (action === "add-rest") {
    const base = Math.max(Date.now(), state.draft.restUntil || Date.now());
    state.draft.restUntil = base + 30000;
    persist();
    render();
  }
  if (action === "finish") {
    const result = finishSession(state, {
      weekIndex: state.draft.weekIndex,
      dayIndex: state.draft.dayIndex,
      performed: state.draft.performed,
      at: new Date().toISOString(),
    });
    if (!result.ok) { flash(result.errors[0]); return; }
    state = result.state;
    view = "progress";
    persist();
    flash("Session saved. Next loads are updated.");
  }
  if (action === "validate") {
    importText = document.getElementById("plan-json")?.value ?? importText;
    report = parseAndValidate(importText, schema);
    render();
  }
  if (action === "save-plan") {
    if (!report?.ok) return;
    const result = importPlan(state, importText, schema);
    if (!result.ok) { report = result; render(); return; }
    state = result.state;
    persist();
    view = "today";
    flash("Plan saved on this phone.");
  }
  if (action === "load-sample") {
    fetch(new URL("./samples/full-body-2-week.json", import.meta.url)).then((res) => res.text()).then((text) => {
      importText = text;
      report = null;
      render();
    });
  }
});

document.body.addEventListener("input", (event) => {
  if (event.target.id !== "plan-json") return;
  importText = event.target.value;
  if (!report) return;
  report = null;
  document.getElementById("report")?.remove();
  document.querySelector(".errors")?.remove();
  document.querySelector(".warnings")?.remove();
});

setInterval(() => {
  const clock = document.getElementById("rest-clock");
  if (!clock || !state.draft?.restUntil) return;
  const left = (state.draft.restUntil - Date.now()) / 1000;
  clock.textContent = left <= 0 ? "0:00" : formatClock(left);
  clock.classList.toggle("done", left <= 0);
  const label = document.getElementById("rest-state");
  if (label) label.textContent = left <= 0 ? "Rest done" : "Rest";
}, 250);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

render();
