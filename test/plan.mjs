// Per-set rest, supersets, and dumbbell warm-ups.
//   node test/plan.mjs
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const LiftPlan = require(join(root, 'plan.js'));

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function eq(a, b, msg) {
  var ja = JSON.stringify(a), jb = JSON.stringify(b);
  if (ja !== jb) throw new Error((msg || 'eq') + '\n  got  ' + ja + '\n  want ' + jb);
}

var HEAD = ['Date', 'Session', 'Order', 'Exercise', 'Set', 'TargetWeight', 'TargetReps', 'Note', 'RestSec'];
var CATALOG = {
  squat: { type: 'barbell', bar: 45, inc: 5 },
  'bench press': { type: 'barbell', bar: 45, inc: 5 },
  deadlift: { type: 'barbell', bar: 45, inc: 5 },
  'chin-up': { type: 'bodyweight', bar: 0, inc: 5 },
  'db romanian deadlift': { type: 'dumbbell', bar: 0, inc: 2.5 },
  'db reverse fly': { type: 'dumbbell', bar: 0, inc: 2.5 },
  'db lateral raise': { type: 'dumbbell', bar: 0, inc: 2.5 },
  'hammer curl': { type: 'dumbbell', bar: 0, inc: 2.5 },
  '1-arm db row': { type: 'dumbbell', bar: 0, inc: 2.5 }
};

function benchOpts(exerciseRest) {
  return { exerciseRest: exerciseRest, catalogRest: 180, typeDefault: 180 };
}

// Old server: one rest on the exercise (last RestSec wins → 90) and the heavy-set note.
var oldBench = [
  { set: 1, targetWeight: 160, targetReps: '3', note: 'Heavy top triple. Rest 180s.' },
  { set: 2, targetWeight: 130, targetReps: '8-12', note: 'Backoff hypertrophy volume.' },
  { set: 3, targetWeight: 130, targetReps: '8-12', note: '' },
  { set: 4, targetWeight: 130, targetReps: '8-12', note: '' }
];
eq([0, 1, 2, 3].map(function (i) { return LiftPlan.restForSet(oldBench, i, benchOpts(90)); }), [180, 90, 90, 90], 'note fallback does not leak onto back-offs');

// New server: each set carries its own RestSec. A blank cell inherits the prior set, then the exercise default.
var newBench = [
  { set: 1, rest: 180, note: 'Heavy top triple. Rest 180s.' },
  { set: 2, rest: 90, note: '' },
  { set: 3, rest: null, note: '' },
  { set: 4, rest: 90, note: 'Rest 45s.' }
];
eq([0, 1, 2, 3].map(function (i) { return LiftPlan.restForSet(newBench, i, benchOpts(90)); }), [180, 90, 90, 90], 'blank inherits prior; explicit cell beats the note');
assert(LiftPlan.restsVary(newBench, benchOpts(90)) === true, 'mixed rests vary');
assert(LiftPlan.restsVary([{ rest: 90 }, { rest: null }], benchOpts(90)) === false, 'blank matching prior does not vary');

var allBlank = [{ rest: null }, { rest: null }];
eq(LiftPlan.restForSet(allBlank, 1, { exerciseRest: null, catalogRest: 75, typeDefault: 180 }), 75, 'catalog default');
eq(LiftPlan.restForSet([{ note: '' }], 0, { typeDefault: 90 }), 90, 'settings default');

// Superset column anywhere, including in front of Date. Missing column omits the field.
var WIDE = ['Superset', 'Note', 'RestSec', 'Set', 'Exercise', 'Order', 'Session', 'Date', 'TargetWeight', 'TargetReps'];
function wide(letter, note, rest, set, exercise, order, weight, reps) {
  return [letter, note, rest, set, exercise, order, 'Lift A', '2026-11-16', weight, reps];
}
var parsed = LiftPlan.rowsToSession(WIDE, [
  wide('', 'Warm up first.', 120, 1, 'Squat', 1, 185, '8-10'),
  wide('', '', 120, 2, 'Squat', 1, 185, '8-10'),
  wide('A', 'Superset A with DB Reverse Fly; slow lower', 60, 1, 'DB Romanian Deadlift', 4, 35, '10-12'),
  wide('A', '', '', 2, 'DB Romanian Deadlift', 4, 35, '10-12'),
  wide('A', 'Superset A with DB Romanian Deadlift.', 90, 1, 'DB Reverse Fly', 5, 16, '12-15'),
  wide('B', 'Superset B with Hammer Curl.', 60, 1, 'DB Lateral Raise', 6, 16.5, '12-15'),
  wide('', 'ignored because the column is in use', 60, 1, 'Hammer Curl', 7, 30, '8-12')
], { date: '2026-11-16', catalog: CATALOG, bar: 45 });
eq(parsed.map(function (g) { return g.exercise + ':' + (g.superset || '-'); }), [
  'Squat:-', 'DB Romanian Deadlift:A', 'DB Reverse Fly:A', 'DB Lateral Raise:B', 'Hammer Curl:-'
], 'header position does not matter');
eq(parsed[1].sets.map(function (s) { return s.rest; }), [60, null], 'blank RestSec stays null');
eq(parsed[1].rest, 60, 'exercise.rest remains last non-blank for old pages');
assert(parsed[0].warmups.length > 0 && parsed[0].warmups[0].set === 'W1', 'squat still gets auto warm-ups');
assert(parsed[0].warmups.some(function (w) { return w.targetWeight === 45; }), 'squat opens with the empty bar');
eq(parsed[1].warmups, [], 'dumbbell romanian deadlift gets no auto warm-ups');
eq(parsed[2].warmups, [], 'dumbbell fly gets no auto warm-ups');

var blocks = LiftPlan.sessionBlocks(parsed);
eq(blocks.map(function (b) { return b.kind + (b.letter || '') + ':' + b.indexes.join('+'); }), [
  'single:0', 'supersetA:1+2', 'single:3', 'single:4'
], 'column letter pairs only the filled rows');
eq(LiftPlan.roundRestSeconds(parsed, blocks[1].indexes, 0, function () { return benchOpts(0); }), 90, 'round rest is the last exercise, not the larger');
parsed[2].sets[0].rest = null;
eq(LiftPlan.roundRestSeconds(parsed, blocks[1].indexes, 0, function (g) {
  return { exerciseRest: g.rest, catalogRest: 60, typeDefault: 90 };
}), 90, 'blank last station uses the larger resolved rest');
parsed[2].sets[0].rest = 90;

// No Superset column: notes pair the Monday accessories, including a partner whose own note is blank.
var noted = LiftPlan.rowsToSession(HEAD, [
  ['2026-11-16', 'Lift A', 4, 'DB Romanian Deadlift', 1, 35, '10-12', 'Superset A with DB Reverse Fly; 35s per hand, slow 3-sec lowering', 60],
  ['2026-11-16', 'Lift A', 4, 'DB Romanian Deadlift', 2, 35, '10-12', '', 60],
  ['2026-11-16', 'Lift A', 5, 'DB Reverse Fly', 1, 16, '12-15', '', 60],
  ['2026-11-16', 'Lift A', 6, 'DB Lateral Raise', 1, 16.5, '12-15', 'Superset B with Hammer Curl.', 60],
  ['2026-11-16', 'Lift A', 7, 'Hammer Curl', 1, 30, '8-12', 'Superset B with DB Lateral Raise. Rest 60s after the round.', 60],
  ['2026-11-16', 'Lift A', 2, 'Bench Press', 1, 160, 3, 'Heavy top triple. Rest 180s.', 180],
  ['2026-11-16', 'Lift A', 2, 'Bench Press', 2, 130, '8-12', '', 90]
], { date: '2026-11-16', catalog: CATALOG });
assert(noted.every(function (g) { return !Object.prototype.hasOwnProperty.call(g, 'superset'); }), 'missing column does not invent superset');
var noteBlocks = LiftPlan.sessionBlocks(noted);
eq(noteBlocks.map(function (b) { return b.kind + (b.letter || ''); }), ['single', 'supersetA', 'supersetB'], 'notes pair both supersets and leave bench alone');
var rdl = noted.filter(function (g) { return g.exercise === 'DB Romanian Deadlift'; })[0];
eq(LiftPlan.displayNote(rdl.sets[0].note), '35s per hand, slow 3-sec lowering', 'coaching after the superset clause stays');
eq(LiftPlan.displayNote('Superset B with DB Lateral Raise. Rest 60s after the round.'), 'Rest 60s after the round', 'rest sentence stays');

// Logging stays per exercise. Completing only A1 does not start the round rest.
var exercises = ['DB Romanian Deadlift', 'DB Reverse Fly'].map(function (name) {
  var g = noted.filter(function (x) { return x.exercise === name; })[0];
  return { exercise: g.exercise, rest: g.rest, sets: g.sets.map(function (s) { return { set: s.set, rest: s.rest, note: s.note, done: null }; }) };
});
var optsFor = function (g) { return { exerciseRest: g.rest, catalogRest: 60, typeDefault: 90 }; };
var alone = LiftPlan.workRestAction(exercises, 0, 0, false, optsFor);
assert(alone.start === false, 'first station does not start rest');
exercises[0].sets[0].done = { weight: 35, reps: 10 };
exercises[1].sets[0].done = { weight: 16, reps: 12 };
var both = LiftPlan.workRestAction(exercises, 1, 0, false, optsFor);
assert(both.start === true && both.seconds === 60 && both.label === 'Superset A', 'round rest ' + JSON.stringify(both));
var flyOnly = LiftPlan.rowsToSession(HEAD, [
  ['2026-11-16', 'Lift A', 5, 'DB Reverse Fly', 1, 16, '12-15', '', '']
], { date: '2026-11-16', catalog: CATALOG });
eq(LiftPlan.restForSet(flyOnly[0].sets, 0, { exerciseRest: flyOnly[0].rest, catalogRest: 90, typeDefault: 90 }), 90, 'blank column uses the exercise default');

// Warm-ups: real deadlift keeps the 135 opener. Dumbbell type and a DB/Dumbbell prefix do not.
var dl = LiftPlan.buildAutoWarmups('Deadlift', 'barbell', 220, 45, 5);
eq(dl.map(function (w) { return w.targetWeight + 'x' + w.targetReps; }), ['135x5', '175x2'], 'deadlift ladder drops steps under 135');
assert(dl.every(function (w) { return w.prescribed === false; }), 'auto warm-ups are not prescribed');
eq(LiftPlan.buildAutoWarmups('DB Romanian Deadlift', 'dumbbell', 35, 0, 2.5), [], 'type dumbbell skips');
eq(LiftPlan.buildAutoWarmups('DB Romanian Deadlift', '', 35, 45, 5), [], 'DB prefix skips when type is missing');
eq(LiftPlan.buildAutoWarmups('Dumbbell Romanian Deadlift', null, 35, 45, 5), [], 'Dumbbell prefix skips');
var bare = LiftPlan.buildAutoWarmups('Romanian Deadlift', '', 100, 45, 5);
assert(bare.length > 0 && bare[0].targetWeight === 135, 'a barbell deadlift variation still warms up');
eq(LiftPlan.buildAutoWarmups('1-Arm DB Row', 'dumbbell', 35, 0, 2.5), [], 'catalog dumbbell row skips');
var chin = LiftPlan.buildAutoWarmups('Chin-up', 'bodyweight', '', 0, 5);
eq(chin.map(function (w) { return w.set + ':' + w.targetReps; }), ['W1:2-3'], 'chin-up keeps one easy set');
var squat = LiftPlan.buildAutoWarmups('Squat', 'barbell', 185, 45, 5);
eq(squat.map(function (w) { return w.targetWeight; }), [45, 75, 110, 150], 'squat percentages round to 5');
var press = LiftPlan.buildAutoWarmups('Seated Press', 'barbell', 95, 45, 2.5);
eq(press.map(function (w) { return w.targetWeight; }), [45, 57.5, 75], 'press rounds to 2.5 and drops 40% under the bar');

var prescribed = LiftPlan.rowsToSession(HEAD, [
  ['2026-11-16', 'Lift A', 4, 'DB Romanian Deadlift', 'W1', 20, 8, 'Easy hinge', ''],
  ['2026-11-16', 'Lift A', 4, 'DB Romanian Deadlift', 1, 35, '10-12', '', 60]
], { date: '2026-11-16', catalog: CATALOG });
eq(prescribed[0].warmups.map(function (w) { return w.targetWeight; }), [20], 'a planned W row replaces auto warm-ups');
assert(prescribed[0].warmups[0].prescribed === true, 'planned warm-up is marked');
eq(LiftPlan.visibleWarmups([{ set: 'W1', targetWeight: 135 }], 'DB Romanian Deadlift', 'dumbbell'), [], 'page hides server auto warm-ups for dumbbells');
eq(LiftPlan.visibleWarmups(prescribed[0].warmups, 'DB Romanian Deadlift', 'dumbbell').length, 1, 'page keeps a prescribed dumbbell warm-up');
eq(LiftPlan.visibleWarmups([{ set: 'W1', targetWeight: 135 }], 'Deadlift', 'barbell').length, 1, 'barbell warm-ups stay');

// Quoted commas survive, and an @session row is not an exercise. Other dates are ignored.
var csv = LiftPlan.parseCsv('Date,Session,Order,Exercise,Set,TargetWeight,TargetReps,Note,RestSec,Title\n' +
  '2026-11-16,Lift A,0,@session,,,"First hypertrophy-block session, post-sick.",,Lift A\n' +
  '2026-11-16,Lift A,1,Squat,1,185,8-10,"Cut back, if you feel off.",120,\n' +
  '2026-11-02,Lift A,1,Squat,1,220,5,,180,\n');
assert(csv.length === 4, 'csv rows ' + csv.length);
var only = LiftPlan.rowsToSession(csv[0], csv.slice(1), { date: '2026-11-16', catalog: CATALOG });
eq(only.map(function (g) { return g.exercise; }), ['Squat'], 'session marker and other dates drop out');
eq(only[0].sets[0].note, 'Cut back, if you feel off.', 'quoted comma stays in the note');

var reordered = LiftPlan.indexHeaders(['RestSec', 'Exercise', 'Set']);
assert(reordered.restsec === 0 && reordered.exercise === 1 && reordered.set === 2, 'headers index by name');

const code = readFileSync(join(root, 'Code.gs'), 'utf8');
assert(code.indexOf('LiftPlan.rowsToSession') !== -1, 'Code.gs should build sessions with LiftPlan');
assert(code.indexOf("map[key]") !== -1, 'Code.gs writes by header name');
assert(code.indexOf('PlanLogic.gs') !== -1, 'Code.gs should name the pasted plan file');

console.log('plan ok');
