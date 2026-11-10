/* Lift plan rules shared by the phone page (script src) and Apps Script (paste as PlanLogic.gs).
   ES5 on purpose: Apps Script and the page both load it as classic script.

   Superset rest: after a round is complete, the timer uses the RestSec of the LAST
   exercise in that round (highest plan order — A2 in a pair, A3 in a triple).
   If that set's RestSec is blank, the timer uses the larger resolved rest among
   the sets that were actually in the round. Rest does not start between stations.
*/
var LiftPlan = (function () {
  function numericRest(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function hasOwnRest(set) {
    return !!(set && numericRest(set.rest) != null);
  }

  /* "Rest 180s" written in a Note. Used only when the payload has no rest field
     (the current Apps Script collapses RestSec onto the exercise). A real rest
     field, including an explicit blank, wins over this text. */
  function noteRestSeconds(note) {
    var m = String(note || '').match(/\brest\s+(\d+(?:\.\d+)?)\s*s\b/i);
    return m ? Number(m[1]) : null;
  }

  function ownRest(set) {
    if (!set) return null;
    if (hasOwnRest(set)) return numericRest(set.rest);
    if (!Object.prototype.hasOwnProperty.call(set, 'rest')) return noteRestSeconds(set.note);
    return null;
  }

  function normLetter(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return '';
    return s.toUpperCase();
  }

  function normName(v) {
    return String(v == null ? '' : v).trim().toLowerCase();
  }

  function isDumbbellExercise(name, type) {
    var t = String(type == null ? '' : type).trim().toLowerCase();
    if (t === 'dumbbell' || t === 'db') return true;
    if (t) return false;
    return /^(db|dumbbell)\b/i.test(String(name || '').trim());
  }

  function indexHeaders(headers) {
    var map = {};
    (headers || []).forEach(function (h, i) {
      var k = String(h == null ? '' : h).trim().toLowerCase();
      if (k && map[k] == null) map[k] = i;
    });
    return map;
  }

  function cell(row, map, key) {
    var i = map[String(key).toLowerCase()];
    if (i == null || !row || i >= row.length) return '';
    var v = row[i];
    return v == null ? '' : v;
  }

  function headerMissing(map, key) {
    return map[String(key).toLowerCase()] == null;
  }

  function ymd(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date && !isNaN(v.getTime())) {
      var m = v.getMonth() + 1, d = v.getDate();
      return v.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
    }
    var s = String(v).trim();
    var iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return iso[1] + '-' + ('0' + iso[2]).slice(-2) + '-' + ('0' + iso[3]).slice(-2);
    var us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (us) return us[3] + '-' + ('0' + us[1]).slice(-2) + '-' + ('0' + us[2]).slice(-2);
    return s.slice(0, 10);
  }

  function parseCsv(text) {
    var rows = [], row = [], cur = '', i = 0, q = false;
    text = String(text || '').replace(/^\uFEFF/, '');
    while (i < text.length) {
      var c = text.charAt(i);
      if (q) {
        if (c === '"') {
          if (text.charAt(i + 1) === '"') { cur += '"'; i += 2; continue; }
          q = false; i++; continue;
        }
        cur += c; i++; continue;
      }
      if (c === '"') { q = true; i++; continue; }
      if (c === ',') { row.push(cur); cur = ''; i++; continue; }
      if (c === '\n' || c === '\r') {
        if (c === '\r' && text.charAt(i + 1) === '\n') i++;
        row.push(cur); rows.push(row); row = []; cur = ''; i++; continue;
      }
      cur += c; i++;
    }
    if (cur.length || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return String(x).trim() !== ''; }); });
  }

  function restForSet(sets, index, opts) {
    opts = opts || {};
    sets = sets || [];
    var x = sets[index] || {};
    var direct = ownRest(x);
    if (direct != null) return direct;
    var i;
    for (i = index - 1; i >= 0; i--) {
      if (hasOwnRest(sets[i])) return numericRest(sets[i].rest);
    }
    var ex = numericRest(opts.exerciseRest);
    if (ex != null) return ex;
    var cat = numericRest(opts.catalogRest);
    if (cat != null) return cat;
    var fallback = numericRest(opts.typeDefault);
    return fallback == null ? 90 : fallback;
  }

  function restsVary(sets, opts) {
    sets = sets || [];
    if (!sets.length) return false;
    var first = restForSet(sets, 0, opts), i;
    for (i = 1; i < sets.length; i++) if (restForSet(sets, i, opts) !== first) return true;
    return false;
  }

  function formatRest(sec) {
    var n = numericRest(sec);
    if (n == null) return '';
    var tenths = Math.round(n / 60 * 10) / 10;
    return tenths + 'm';
  }

  function namesMatch(a, b, aliases) {
    var na = normName(a), nb = normName(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    var lists = [];
    if (aliases && aliases[na]) lists.push(aliases[na]);
    if (aliases && aliases[nb] && aliases[nb] !== aliases[na]) lists.push(aliases[nb]);
    var i, j;
    for (i = 0; i < lists.length; i++) {
      var hasA = false, hasB = false, list = lists[i];
      for (j = 0; j < list.length; j++) {
        var al = normName(list[j]);
        if (al === na) hasA = true;
        if (al === nb) hasB = true;
      }
      if (hasA && hasB) return true;
    }
    return false;
  }

  function firstSupersetNote(g) {
    var sets = (g && g.sets) || [], i;
    for (i = 0; i < sets.length; i++) {
      var m = String(sets[i].note || '').match(/superset\s+([A-Za-z0-9]+)\s+with\s+([^.;\n]+)/i);
      if (m) return { letter: m[1].toUpperCase(), partner: m[2].replace(/[\s.]+$/g, '').trim() };
    }
    return null;
  }

  function displayNote(note) {
    return String(note || '')
      .replace(/superset\s+[A-Za-z0-9]+\s+with\s+[^.;\n]+[.;]?/ig, '')
      .replace(/\s+/g, ' ')
      .replace(/^[\s,;.:-]+|[\s,;.:-]+$/g, '')
      .trim();
  }

  function assignLetters(exercises, opts) {
    opts = opts || {};
    var aliases = opts.aliases || {};
    var column = exercises.map(function (g) { return normLetter(g && g.superset); });
    var anyColumn = exercises.some(function (g) {
      return g && Object.prototype.hasOwnProperty.call(g, 'superset') && normLetter(g.superset);
    });
    if (anyColumn) return column;
    var letters = exercises.map(function () { return ''; });
    exercises.forEach(function (g, i) {
      var parsed = firstSupersetNote(g);
      if (!parsed) return;
      if (!letters[i]) letters[i] = parsed.letter;
      exercises.forEach(function (other, j) {
        if (j !== i && !letters[j] && namesMatch(other.exercise, parsed.partner, aliases)) letters[j] = parsed.letter;
      });
    });
    return letters;
  }

  function sessionBlocks(exercises, opts) {
    exercises = exercises || [];
    var letters = assignLetters(exercises, opts);
    var used = {}, blocks = [], i, j;
    for (i = 0; i < exercises.length; i++) {
      if (used[i]) continue;
      var letter = letters[i];
      if (!letter) {
        blocks.push({ kind: 'single', letter: '', indexes: [i] });
        used[i] = 1;
        continue;
      }
      var indexes = [];
      for (j = i; j < exercises.length; j++) {
        if (!used[j] && letters[j] === letter) { indexes.push(j); used[j] = 1; }
      }
      if (indexes.length < 2) blocks.push({ kind: 'single', letter: '', indexes: indexes });
      else blocks.push({ kind: 'superset', letter: letter, indexes: indexes });
    }
    return blocks;
  }

  function roundIsComplete(exercises, indexes, roundIndex) {
    var any = false, all = true, i;
    for (i = 0; i < indexes.length; i++) {
      var g = exercises[indexes[i]];
      var x = g && g.sets && g.sets[roundIndex];
      if (!x) continue;
      any = true;
      if (!x.done) all = false;
    }
    return any && all;
  }

  function roundRestSeconds(exercises, indexes, roundIndex, optsFor) {
    var present = [], i;
    for (i = 0; i < indexes.length; i++) {
      var g = exercises[indexes[i]];
      if (g && g.sets && g.sets[roundIndex]) present.push(g);
    }
    if (!present.length) return 0;
    var last = present[present.length - 1];
    var owned = ownRest(last.sets[roundIndex]);
    if (owned != null) return owned;
    var max = null;
    for (i = 0; i < present.length; i++) {
      var r = restForSet(present[i].sets, roundIndex, optsFor(present[i]));
      if (max == null || r > max) max = r;
    }
    return max == null ? 0 : max;
  }

  function blockFor(exercises, gi, opts) {
    var blocks = sessionBlocks(exercises, opts), i, j;
    for (i = 0; i < blocks.length; i++) {
      for (j = 0; j < blocks[i].indexes.length; j++) if (blocks[i].indexes[j] === gi) return blocks[i];
    }
    return null;
  }

  function workRestAction(exercises, gi, setIndex, isWarmup, optsFor, blockOpts) {
    var g = exercises[gi];
    if (!g) return { start: false, seconds: 0, label: '' };
    if (isWarmup) return { start: true, warmup: true, seconds: 0, label: g.exercise + ' warm-up' };
    var block = blockFor(exercises, gi, blockOpts);
    if (!block || block.kind !== 'superset') {
      return { start: true, warmup: false, seconds: restForSet(g.sets, setIndex, optsFor(g)), label: g.exercise };
    }
    if (!roundIsComplete(exercises, block.indexes, setIndex)) return { start: false, warmup: false, seconds: 0, label: '' };
    return {
      start: true,
      warmup: false,
      seconds: roundRestSeconds(exercises, block.indexes, setIndex, optsFor),
      label: 'Superset ' + block.letter
    };
  }

  function visibleWarmups(warmups, name, type) {
    var rows = warmups || [];
    if (!isDumbbellExercise(name, type)) return rows.slice();
    return rows.filter(function (x) { return x && x.prescribed === true; });
  }

  function roundTo(weight, inc) {
    inc = inc || 5;
    return Math.round(weight / inc) * inc;
  }

  function warmupKind(name, type) {
    if (isDumbbellExercise(name, type)) return '';
    var n = normName(name);
    if (n === 'chin-up' || n === 'chin-ups' || n === 'chinup') return 'chin';
    if (n === 'squat' || n === 'bench press' || n === 'seated press') return 'barbell';
    if (n === 'deadlift' || /\bdeadlift\b/.test(n)) return 'deadlift';
    return '';
  }

  function buildAutoWarmups(name, type, firstWeight, bar, inc) {
    var kind = warmupKind(name, type);
    if (!kind) return [];
    if (kind === 'chin') {
      return [{ set: 'W1', targetWeight: '', targetReps: '2-3', note: 'Band-assisted or scap pulls', prescribed: false }];
    }
    var w = numericRest(firstWeight);
    if (w == null || w <= 0) return [];
    bar = numericRest(bar);
    if (bar == null) bar = 45;
    inc = numericRest(inc) || (normName(name) === 'seated press' ? 2.5 : 5);
    var steps = [];
    if (kind === 'deadlift') steps.push({ w: 135, reps: '5' });
    else steps.push({ w: bar, reps: '8-10' });
    steps.push({ w: roundTo(w * 0.4, inc), reps: '5' });
    steps.push({ w: roundTo(w * 0.6, inc), reps: '3' });
    steps.push({ w: roundTo(w * 0.8, inc), reps: '2' });
    var kept = [], prev = 0, i;
    for (i = 0; i < steps.length; i++) {
      var step = steps[i];
      if (!(step.w > 0)) continue;
      if (i > 0 && (step.w <= prev || step.w <= bar || step.w >= w)) continue;
      if (i === 0 && kind !== 'deadlift' && step.w < bar) continue;
      kept.push(step);
      prev = step.w;
    }
    return kept.map(function (s, n) {
      return { set: 'W' + (n + 1), targetWeight: s.w, targetReps: s.reps, note: '', prescribed: false };
    });
  }

  function isWarmupSetId(set) {
    return /^W\d+$/i.test(String(set == null ? '' : set).trim());
  }

  function numOrBlank(v) {
    if (v == null || v === '') return '';
    var n = Number(v);
    return isFinite(n) ? n : v;
  }

  /* Build one session's exercises from sheet rows. Columns are found by header
     name, so a Superset column can sit anywhere. If that header is absent the
     exercises omit `superset` and the page falls back to "Superset X with Y" notes.
     Per-set `rest` is the cell value, or null when the cell is blank. `exercise.rest`
     stays the last non-blank RestSec so an older page keeps its current behavior. */
  function rowsToSession(headerRow, dataRows, ctx) {
    ctx = ctx || {};
    var map = indexHeaders(headerRow);
    var hasSuperset = !headerMissing(map, 'superset');
    var catalog = ctx.catalog || {};
    var groups = {};
    var order = [];
    (dataRows || []).forEach(function (row) {
      if (ctx.date && ymd(cell(row, map, 'date')) !== ymd(ctx.date)) return;
      var exercise = String(cell(row, map, 'exercise')).trim();
      if (!exercise || normName(exercise) === '@session') return;
      var setId = cell(row, map, 'set');
      var key = String(cell(row, map, 'order')) + '\n' + normName(exercise);
      if (!groups[key]) {
        groups[key] = {
          order: Number(cell(row, map, 'order')) || 0,
          exercise: exercise,
          sets: [],
          warmups: [],
          rest: null,
          _rests: []
        };
        if (hasSuperset) groups[key].superset = '';
        order.push(key);
      }
      var g = groups[key];
      var rest = numericRest(cell(row, map, 'restsec'));
      var item = {
        set: isWarmupSetId(setId) ? String(setId).toUpperCase() : numOrBlank(setId),
        targetWeight: numOrBlank(cell(row, map, 'targetweight')),
        targetReps: cell(row, map, 'targetreps'),
        note: cell(row, map, 'note')
      };
      if (!headerMissing(map, 'restsec')) item.rest = rest;
      if (hasSuperset) {
        var letter = normLetter(cell(row, map, 'superset'));
        if (letter && !g.superset) g.superset = letter;
      }
      if (isWarmupSetId(setId)) {
        item.prescribed = true;
        g.warmups.push(item);
      } else {
        if (rest != null) g._rests.push(rest);
        g.sets.push(item);
      }
    });
    order.sort(function (a, b) { return groups[a].order - groups[b].order; });
    return order.map(function (key) {
      var g = groups[key];
      g.sets.sort(function (a, b) { return Number(a.set) - Number(b.set); });
      g.warmups.sort(function (a, b) { return String(a.set).localeCompare(String(b.set)); });
      if (g._rests.length) g.rest = g._rests[g._rests.length - 1];
      delete g._rests;
      delete g.order;
      var info = catalog[normName(g.exercise)] || {};
      if (!g.warmups.length) {
        var first = null, i;
        for (i = 0; i < g.sets.length; i++) {
          var tw = numericRest(g.sets[i].targetWeight);
          if (tw != null && tw > 0) { first = tw; break; }
        }
        g.warmups = buildAutoWarmups(g.exercise, info.type, first, info.bar != null ? info.bar : ctx.bar, info.inc);
      }
      return g;
    });
  }

  return {
    numericRest: numericRest,
    noteRestSeconds: noteRestSeconds,
    isDumbbellExercise: isDumbbellExercise,
    indexHeaders: indexHeaders,
    cell: cell,
    ymd: ymd,
    parseCsv: parseCsv,
    restForSet: restForSet,
    restsVary: restsVary,
    formatRest: formatRest,
    displayNote: displayNote,
    sessionBlocks: sessionBlocks,
    roundIsComplete: roundIsComplete,
    roundRestSeconds: roundRestSeconds,
    workRestAction: workRestAction,
    visibleWarmups: visibleWarmups,
    buildAutoWarmups: buildAutoWarmups,
    rowsToSession: rowsToSession,
    isWarmupSetId: isWarmupSetId
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = LiftPlan;
