/* Lift Tracker web app — Google Apps Script bound to the Lift Tracker spreadsheet.

   The phone page is GitHub Pages. This script is the private JSON API.
   PlanLogic.gs must be the repo file plan.js pasted unchanged (it defines LiftPlan).
   Columns are read and written by header name, so Superset can sit in any column.
   If that header is missing, sessions still load and the page pairs exercises from
   notes that say "Superset A with ...".

   Redeploy (do this in the browser; merging the GitHub PR does not update this script):
   1. Spreadsheet → Extensions → Apps Script.
   2. Add PlanLogic.gs with the contents of plan.js. Replace Code.gs with this file.
      Keep the existing Script property ACCESS_KEY. Do not generate a new key.
   3. Deploy → Manage deployments → edit the current web app → New version → Deploy.
      Leave "Execute as: Me" and "Who has access: Anyone". The /exec URL stays the same.
   4. Run installTriggers once if hourly plan-inbox import stops.

   Rest after a superset round uses the last exercise in the round (see plan.js).
*/

function doGet(e) {
  return handle_((e && e.parameter) || {}, null);
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData && e.postData.contents || '{}'); } catch (err) { body = {}; }
  return handle_(body, body);
}

function handle_(q, body) {
  try {
    if (typeof LiftPlan === 'undefined') return json_({ ok: false, error: 'Add PlanLogic.gs (plan.js) to this project' });
    if (!auth_(q.k)) return json_({ ok: false, error: 'bad key' });
    var api = String(q.api || '');
    if (api === 'bootstrap') return json_({ ok: true, data: bootstrap_(q.date || '') });
    if (api === 'history') return json_({ ok: true, data: history_() });
    if (api === 'logSets') return json_({ ok: true, data: logSets_(body && body.items) });
    if (api === 'logWeight') return json_({ ok: true, data: logWeight_(body && body.item) });
    return json_({ ok: false, error: 'unknown api' });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function showMyLink() {
  var key = PropertiesService.getScriptProperties().getProperty('ACCESS_KEY') || '';
  var url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (err) {}
  Logger.log(url + '#k=' + key);
}

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'importPlanInbox') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('importPlanInbox').timeBased().everyHours(1).create();
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function auth_(k) {
  var key = PropertiesService.getScriptProperties().getProperty('ACCESS_KEY');
  return !!(key && String(k || '') === String(key));
}

function ss_() {
  var active = SpreadsheetApp.getActive();
  if (active) return active;
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID') || '14RfQ_GYzAlHecdYSTUzB8B_GuQ-qc1klz1yY5Z-qd1o';
  return SpreadsheetApp.openById(id);
}

function tz_() {
  try { return ss_().getSpreadsheetTimeZone(); } catch (err) { return Session.getScriptTimeZone(); }
}

function today_() {
  return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Missing tab ' + name);
  return sh;
}

function table_(name) {
  var values = sheet_(name).getDataRange().getValues();
  if (!values.length) return { header: [], rows: [], map: {} };
  return { header: values[0], rows: values.slice(1), map: LiftPlan.indexHeaders(values[0]) };
}

function ymdCell_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  return LiftPlan.ymd(v);
}

function readSettings_() {
  var t = table_('Settings');
  var out = {};
  t.rows.forEach(function (row) {
    var k = String(LiftPlan.cell(row, t.map, 'key') || '').trim();
    if (!k) return;
    out[k] = LiftPlan.cell(row, t.map, 'value');
  });
  ['goal_weight', 'rest_main_sec', 'rest_accessory_sec', 'rest_warmup_sec', 'bar_weight'].forEach(function (k) {
    if (out[k] === '' || out[k] == null) return;
    var n = Number(out[k]);
    if (isFinite(n)) out[k] = n;
  });
  return out;
}

function readCatalog_() {
  var t = table_('Exercises');
  var list = [], byName = {};
  t.rows.forEach(function (row) {
    var name = String(LiftPlan.cell(row, t.map, 'name') || '').trim();
    if (!name) return;
    var aliases = String(LiftPlan.cell(row, t.map, 'aliases') || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var info = {
      name: name,
      type: String(LiftPlan.cell(row, t.map, 'type') || '').trim().toLowerCase(),
      bar: Number(LiftPlan.cell(row, t.map, 'barweight')) || 0,
      inc: Number(LiftPlan.cell(row, t.map, 'increment')) || 0,
      plateMath: /^y/i.test(String(LiftPlan.cell(row, t.map, 'platemath') || '')),
      rest: LiftPlan.numericRest(LiftPlan.cell(row, t.map, 'restsec')),
      chart: /^y/i.test(String(LiftPlan.cell(row, t.map, 'chart') || '')),
      aliases: aliases
    };
    list.push(info);
    byName[name.toLowerCase()] = info;
    aliases.forEach(function (a) { byName[a.toLowerCase()] = info; });
  });
  return { list: list, byName: byName };
}

function readLogs_() {
  var t = table_('Log');
  return t.rows.map(function (row) {
    return {
      ts: String(LiftPlan.cell(row, t.map, 'timestamp') || ''),
      date: ymdCell_(LiftPlan.cell(row, t.map, 'date')),
      session: LiftPlan.cell(row, t.map, 'session'),
      exercise: String(LiftPlan.cell(row, t.map, 'exercise') || '').trim(),
      set: LiftPlan.cell(row, t.map, 'set'),
      weight: LiftPlan.cell(row, t.map, 'weight'),
      reps: LiftPlan.cell(row, t.map, 'reps'),
      notes: LiftPlan.cell(row, t.map, 'notes'),
      clientId: String(LiftPlan.cell(row, t.map, 'clientid') || '')
    };
  }).filter(function (r) { return r.exercise && r.reps !== '' && r.reps != null; });
}

function readWeights_() {
  var t = table_('Weight');
  return t.rows.map(function (row) {
    var lb = Number(LiftPlan.cell(row, t.map, 'lb'));
    return { date: ymdCell_(LiftPlan.cell(row, t.map, 'date')), lb: lb, note: LiftPlan.cell(row, t.map, 'note') };
  }).filter(function (r) { return r.date && isFinite(r.lb) && r.lb > 0; });
}

function readSessions_() {
  var t = table_('Sessions');
  var out = {};
  t.rows.forEach(function (row) {
    var d = ymdCell_(LiftPlan.cell(row, t.map, 'date'));
    if (!d) return;
    out[d] = {
      session: LiftPlan.cell(row, t.map, 'session'),
      title: LiftPlan.cell(row, t.map, 'title'),
      note: LiftPlan.cell(row, t.map, 'note')
    };
  });
  return out;
}

function bootstrap_(date) {
  try { importPlanInbox(); } catch (err) {}
  var settings = readSettings_();
  var catalog = readCatalog_();
  var plan = table_('Plan');
  var rows = plan.rows.map(function (row) {
    var copy = row.slice();
    if (plan.map.date != null && copy[plan.map.date] instanceof Date) copy[plan.map.date] = ymdCell_(copy[plan.map.date]);
    return copy;
  });
  var dates = [], seen = {};
  rows.forEach(function (row) {
    var d = LiftPlan.ymd(LiftPlan.cell(row, plan.map, 'date'));
    if (d && !seen[d]) { seen[d] = 1; dates.push(d); }
  });
  dates.sort();
  var today = today_();
  var want = date ? LiftPlan.ymd(date) : today;
  var exercises = LiftPlan.rowsToSession(plan.header, rows, {
    date: want,
    catalog: catalog.byName,
    bar: Number(settings.bar_weight) || 45
  });
  attachDone_(exercises, want);
  var sess = readSessions_()[want] || {};
  var sessionName = sess.session || '';
  if (!sessionName) {
    rows.forEach(function (row) {
      if (sessionName) return;
      if (LiftPlan.ymd(LiftPlan.cell(row, plan.map, 'date')) !== want) return;
      var ex = String(LiftPlan.cell(row, plan.map, 'exercise') || '').trim().toLowerCase();
      if (!ex || ex === '@session') return;
      sessionName = LiftPlan.cell(row, plan.map, 'session');
    });
  }
  return {
    date: want,
    today: today,
    dates: dates,
    settings: settings,
    exercises: catalog.list,
    weights: readWeights_(),
    last: lastFor_(exercises, want, catalog),
    session: {
      session: sessionName,
      title: sess.title || '',
      note: sess.note || '',
      showWarmups: String(settings.show_warmups || 'Y').toUpperCase() !== 'N',
      exercises: exercises
    }
  };
}

function attachDone_(exercises, date) {
  var logs = readLogs_().filter(function (r) { return r.date === date; });
  exercises.forEach(function (g) {
    ['sets', 'warmups'].forEach(function (key) {
      (g[key] || []).forEach(function (x) {
        var hit = null;
        logs.forEach(function (row) {
          if (row.exercise.toLowerCase() !== String(g.exercise).toLowerCase()) return;
          if (String(row.set).toUpperCase() !== String(x.set).toUpperCase()) return;
          if (!hit || String(row.ts) > String(hit.ts)) hit = row;
        });
        x.done = hit ? { clientId: hit.clientId, weight: hit.weight === '' ? '' : Number(hit.weight), reps: Number(hit.reps) } : null;
      });
    });
  });
}

function lastFor_(exercises, date) {
  var logs = readLogs_().filter(function (r) {
    return r.date && r.date < date && !LiftPlan.isWarmupSetId(r.set);
  });
  var out = {};
  exercises.forEach(function (g) {
    var rows = logs.filter(function (r) { return r.exercise.toLowerCase() === String(g.exercise).toLowerCase(); });
    if (!rows.length) return;
    var latest = rows.map(function (r) { return r.date; }).sort().pop();
    out[g.exercise] = {
      date: latest,
      sets: rows.filter(function (r) { return r.date === latest; }).map(function (r) {
        return { weight: r.weight === '' ? '' : Number(r.weight), reps: Number(r.reps), notes: r.notes || '' };
      })
    };
  });
  return out;
}

function history_() {
  var settings = readSettings_();
  var catalog = readCatalog_();
  var byDay = {};
  readLogs_().forEach(function (r) {
    if (LiftPlan.isWarmupSetId(r.set)) return;
    var info = catalog.byName[r.exercise.toLowerCase()];
    if (!info || !info.chart) return;
    var key = info.name + '\n' + r.date;
    if (!byDay[key]) byDay[key] = { name: info.name, date: r.date, plateMath: info.plateMath, sets: [] };
    byDay[key].sets.push(r);
  });
  var lifts = {};
  Object.keys(byDay).forEach(function (key) {
    var day = byDay[key];
    var top = 0, topReps = 0, bestReps = 0, total = 0, e1 = 0;
    day.sets.forEach(function (s) {
      var w = Number(s.weight), reps = Number(s.reps);
      if (!isFinite(reps) || reps <= 0) return;
      total += reps;
      if (reps > bestReps) bestReps = reps;
      if (isFinite(w) && w > 0) {
        if (w > top || (w === top && reps > topReps)) { top = w; topReps = reps; }
        var est = Math.round(w * (1 + reps / 30));
        if (est > e1) e1 = est;
      }
    });
    if (!lifts[day.name]) lifts[day.name] = [];
    lifts[day.name].push({ date: day.date, top: top, topReps: topReps, e1rm: e1, bestReps: bestReps, totalReps: total });
  });
  Object.keys(lifts).forEach(function (name) { lifts[name].sort(function (a, b) { return a.date < b.date ? -1 : 1; }); });
  return { weights: readWeights_(), lifts: lifts, goal: Number(settings.goal_weight) || 183 };
}

function logSets_(items) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheet_('Log');
    var values = sh.getDataRange().getValues();
    if (!values.length) {
      values = [['Timestamp', 'Date', 'Session', 'Exercise', 'Set', 'Weight', 'Reps', 'RPE', 'Notes', 'ClientId']];
      sh.getRange(1, 1, 1, values[0].length).setValues(values);
    }
    var map = LiftPlan.indexHeaders(values[0]);
    var ids = [];
    (items || []).forEach(function (item) {
      if (!item || !item.clientId) return;
      var rowIndex = findClient_(values, map, item.clientId);
      if (item.deleted && rowIndex < 0) { ids.push(String(item.clientId)); return; }
      var width = values[0].length;
      var row = rowIndex < 0 ? emptyRow_(width) : values[rowIndex].slice();
      put_(row, map, 'clientid', String(item.clientId));
      put_(row, map, 'timestamp', Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss'));
      if (item.deleted) {
        put_(row, map, 'weight', '');
        put_(row, map, 'reps', '');
        put_(row, map, 'rpe', '');
        put_(row, map, 'notes', '');
      } else {
        put_(row, map, 'date', LiftPlan.ymd(item.date));
        put_(row, map, 'session', item.session || '');
        put_(row, map, 'exercise', item.exercise || '');
        put_(row, map, 'set', item.set == null ? '' : item.set);
        put_(row, map, 'weight', item.weight === '' || item.weight == null ? '' : item.weight);
        put_(row, map, 'reps', item.reps);
        put_(row, map, 'notes', item.notes || '');
      }
      if (rowIndex < 0) {
        sh.appendRow(row);
        values.push(row);
      } else {
        sh.getRange(rowIndex + 1, 1, 1, width).setValues([row]);
        values[rowIndex] = row;
      }
      ids.push(String(item.clientId));
    });
    return ids;
  } finally {
    lock.releaseLock();
  }
}

function logWeight_(item) {
  if (!item) throw new Error('missing weight');
  var sh = sheet_('Weight');
  var values = sh.getDataRange().getValues();
  var map = LiftPlan.indexHeaders(values[0] || []);
  var date = LiftPlan.ymd(item.date);
  var found = -1, i;
  for (i = 1; i < values.length; i++) {
    if (ymdCell_(LiftPlan.cell(values[i], map, 'date')) === date) found = i;
  }
  var width = values[0].length;
  var row = found < 0 ? emptyRow_(width) : values[found].slice();
  put_(row, map, 'date', date);
  put_(row, map, 'lb', item.lb);
  if (found < 0) sh.appendRow(row);
  else sh.getRange(found + 1, 1, 1, width).setValues([row]);
  return { date: date, lb: item.lb };
}

function findClient_(values, map, clientId) {
  var want = String(clientId);
  var i;
  for (i = 1; i < values.length; i++) {
    if (String(LiftPlan.cell(values[i], map, 'clientid')) === want) return i;
  }
  return -1;
}

function emptyRow_(n) {
  var row = [], i;
  for (i = 0; i < n; i++) row.push('');
  return row;
}

function put_(row, map, key, value) {
  var i = map[key];
  if (i == null) return;
  row[i] = value == null ? '' : value;
}

/* Plan inbox: a CSV dropped in the Lift Tracker folder replaces Plan rows for
   the dates it contains. Log is never touched. Sessions update only for dates
   that include an @session row. A Superset column in the CSV is added at the
   end of the header row when the sheet does not have one yet. */
function importPlanInbox() {
  var settings = {};
  try { settings = readSettings_(); } catch (err) {}
  var folderId = settings.plan_inbox_folder_id || PropertiesService.getScriptProperties().getProperty('PLAN_INBOX_FOLDER_ID') || '1v7ZPjuE7Q0lkXfqBGB2tXa8gNlsfIzHR';
  var folder = DriveApp.getFolderById(folderId);
  var files = folder.getFiles();
  while (files.hasNext()) {
    var file = files.next();
    var name = file.getName();
    if (/^imported-plan-/i.test(name)) continue;
    if (!/\.csv$/i.test(name) && file.getMimeType() !== MimeType.CSV && file.getMimeType() !== 'text/csv') continue;
    var table = LiftPlan.parseCsv(file.getBlob().getDataAsString());
    if (applyPlanTable_(table)) file.setName('imported-plan-' + name);
  }
}

function applyPlanTable_(table) {
  if (!table || table.length < 2) return false;
  var csvMap = LiftPlan.indexHeaders(table[0]);
  if (csvMap.date == null || csvMap.exercise == null) return false;
  var dates = {};
  var sessions = {};
  var planRows = [];
  table.slice(1).forEach(function (row) {
    var d = LiftPlan.ymd(LiftPlan.cell(row, csvMap, 'date'));
    if (!d) return;
    dates[d] = 1;
    var exercise = String(LiftPlan.cell(row, csvMap, 'exercise') || '').trim();
    if (exercise.toLowerCase() === '@session') {
      sessions[d] = {
        date: d,
        session: LiftPlan.cell(row, csvMap, 'session'),
        title: csvMap.title == null ? '' : LiftPlan.cell(row, csvMap, 'title'),
        note: LiftPlan.cell(row, csvMap, 'note')
      };
      return;
    }
    if (exercise) planRows.push(row);
  });
  var dateList = Object.keys(dates);
  if (!dateList.length) return false;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var plan = sheet_('Plan');
    var values = plan.getDataRange().getValues();
    var header = values[0].slice();
    if (csvMap.superset != null && LiftPlan.indexHeaders(header).superset == null) {
      header.push('Superset');
      plan.getRange(1, 1, 1, header.length).setValues([header]);
    }
    var map = LiftPlan.indexHeaders(header);
    var r;
    for (r = values.length - 1; r >= 1; r--) {
      if (dates[ymdCell_(LiftPlan.cell(values[r], map, 'date'))]) plan.deleteRow(r + 1);
    }
    planRows.forEach(function (csvRow) {
      var row = emptyRow_(header.length);
      Object.keys(map).forEach(function (key) {
        if (csvMap[key] == null) return;
        var v = csvRow[csvMap[key]];
        if (key === 'date') v = LiftPlan.ymd(v);
        row[map[key]] = v == null ? '' : v;
      });
      plan.appendRow(row);
    });
    if (Object.keys(sessions).length) writeSessions_(sessions);
    return true;
  } finally {
    lock.releaseLock();
  }
}

function writeSessions_(sessions) {
  var sh = sheet_('Sessions');
  var values = sh.getDataRange().getValues();
  var header = values[0];
  var map = LiftPlan.indexHeaders(header);
  var r;
  for (r = values.length - 1; r >= 1; r--) {
    var d = ymdCell_(LiftPlan.cell(values[r], map, 'date'));
    if (sessions[d]) sh.deleteRow(r + 1);
  }
  Object.keys(sessions).forEach(function (d) {
    var s = sessions[d];
    var row = emptyRow_(header.length);
    put_(row, map, 'date', s.date);
    put_(row, map, 'session', s.session);
    put_(row, map, 'title', s.title);
    put_(row, map, 'note', s.note);
    sh.appendRow(row);
  });
}
