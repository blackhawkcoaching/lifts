// Launch catch-up and the workout picker, against a mocked Apps Script.
// Run from the repo root:
//   npm install --prefix /tmp/probe puppeteer-core
//   NODE_PATH=/tmp/probe/node_modules node test/catchup.mjs
import { createServer } from 'http';
import { createRequire } from 'module';
import { readFileSync, existsSync } from 'fs';
import { extname } from 'path';

const require = createRequire(existsSync('/tmp/probe/package.json') ? '/tmp/probe/package.json' : import.meta.url);
const puppeteer = require('puppeteer-core');

const ROOT = new URL('..', import.meta.url).pathname;
const html = readFileSync(ROOT + 'index.html');
const sw = readFileSync(ROOT + 'sw.js');
const manifest = readFileSync(ROOT + 'manifest.webmanifest');
const icon180 = readFileSync(ROOT + 'icon-180.png');
const icon512 = readFileSync(ROOT + 'icon-512.png');
const KEY = 'testkeytestkey12';
const SHOTS = '/opt/cursor/artifacts/screenshots';

const PLAN = [
  { date: '2026-10-20', session: 'Lift Old', title: 'Ancient miss', exercise: 'Squat' },
  { date: '2026-10-28', session: 'Lift B', title: 'Lift B: Squat / Press', exercise: 'Squat' },
  { date: '2026-10-30', session: 'Lift C', title: 'Lift C: Deadlift / Bench / Chins', exercise: 'Deadlift' },
  { date: '2026-11-02', session: 'Lift A', title: 'Lift A: Squat / Bench / Chins', exercise: 'Squat' },
  { date: '2026-11-06', session: 'Lift C', title: 'Lift C next', exercise: 'Deadlift' }
];

function bootFor(date, today, status) {
  const plan = PLAN.find(function (p) { return p.date === date; });
  const st = (status && status[date]) || {};
  const dates = PLAN.map(function (p) { return p.date; });
  const exercises = (!plan || st.empty) ? [] : [{
    exercise: plan.exercise, rest: 180,
    sets: [{ set: 1, targetWeight: 200, targetReps: '5', note: '', done: st.work ? { weight: 200, reps: 5, clientId: 'work' } : null }],
    warmups: [{ set: 'W1', targetWeight: 45, targetReps: '8', note: '', done: st.warm ? { weight: 45, reps: 8, clientId: 'warm' } : null }]
  }];
  return {
    date: date, today: today, dates: dates,
    settings: { goal_weight: 183, rest_main_sec: 180, rest_accessory_sec: 90, rest_warmup_sec: 60, bar_weight: 45, plates: '45,35,25,10,5,2.5', show_warmups: 'Y' },
    exercises: [
      { name: 'Squat', type: 'barbell', bar: 45, inc: 5, plateMath: true, rest: 180, chart: true, aliases: [] },
      { name: 'Deadlift', type: 'barbell', bar: 45, inc: 5, plateMath: true, rest: 180, chart: true, aliases: [] }
    ],
    weights: [], last: {},
    session: { session: plan ? plan.session : '', title: plan && !st.empty ? plan.title : (st.title || ''), note: '', showWarmups: true, exercises: exercises }
  };
}

function payload(date, scenario) {
  const today = scenario.today;
  if (!date) {
    const todayPlan = PLAN.find(function (p) { return p.date === today; });
    if (!todayPlan) return bootFor(today, today, Object.assign({}, scenario.status, (function () { const o = {}; o[today] = { empty: true, title: 'Saturday empty' }; return o; })()));
    return bootFor(today, today, scenario.status);
  }
  return bootFor(date, today, scenario.status);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function listen(handler) {
  const server = createServer(handler);
  await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
  return server;
}

async function appServer() {
  const server = await listen(function (req, res) {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname === '/start') {
      const cache = {
        date: '2026-10-31', today: '2026-10-31', dates: PLAN.map(function (p) { return p.date; }),
        settings: { goal_weight: 183, bar_weight: 45, plates: '45', show_warmups: 'Y' },
        exercises: [], weights: [], last: {},
        session: { session: '', title: 'Cached Saturday', note: '', showWarmups: true, exercises: [] }
      };
      const seed = 'localStorage.setItem("lt_boot_auto", ' + JSON.stringify(JSON.stringify(cache)) + ');';
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end('<!doctype html><meta charset="utf-8"><script>localStorage.clear();localStorage.setItem("lt_key",' + JSON.stringify(JSON.stringify(KEY)) + ');' + seed + 'location.replace("/#k=' + KEY + '");</script>');
      return;
    }
    const file = u.pathname === '/' ? '/index.html' : u.pathname;
    const body = file === '/index.html' ? html : file === '/sw.js' ? sw : file === '/manifest.webmanifest' ? manifest : file === '/icon-180.png' ? icon180 : file === '/icon-512.png' ? icon512 : null;
    if (!body) { res.statusCode = 404; res.end('no'); return; }
    const type = extname(file) === '.png' ? 'image/png' : extname(file) === '.js' ? 'text/javascript' : extname(file) === '.webmanifest' ? 'application/manifest+json' : 'text/html; charset=utf-8';
    res.setHeader('content-type', type);
    res.end(body);
  });
  return { server: server, port: server.address().port };
}

async function openApp(browser, port, scenario) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await page.setRequestInterception(true);
  page.on('request', function (req) {
    const u = req.url();
    if (u.indexOf('/exec') !== -1 && u.indexOf('script.google.com') !== -1) {
      const url = new URL(u);
      const date = url.searchParams.get('date');
      scenario.calls.push(date || '(none)');
      if (scenario.failOnce && scenario.failOnce[date || ''] && !scenario.failed[date || '']) {
        scenario.failed[date || ''] = 1;
        req.respond({ status: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: 'nope' });
        return;
      }
      const delay = (scenario.delay && scenario.delay[date || '']) || 0;
      setTimeout(function () {
        req.respond({
          status: 200,
          contentType: 'application/json',
          headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
          body: JSON.stringify({ ok: true, data: url.searchParams.get('api') === 'history' ? { weights: [], lifts: {}, goal: 183 } : payload(date, scenario) })
        }).catch(function () {});
      }, delay);
      return;
    }
    if (u.indexOf('http://127.0.0.1:' + port) === 0) req.continue();
    else req.respond({ status: 404, body: '' });
  });
  page.on('pageerror', function (err) { console.log('PAGEERROR', err.message); });
  const path = scenario.seedCache ? '/start' : '/#k=' + KEY;
  await page.goto('http://127.0.0.1:' + port + path, { waitUntil: 'domcontentloaded', timeout: 15000 });
  return { ctx: ctx, page: page };
}

async function waitFor(page, pred, ms) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < (ms || 8000)) {
    try {
      last = await page.evaluate(function () {
        return {
          title: document.getElementById('sTitle').textContent,
          date: document.getElementById('sDate').textContent,
          sdate: window.S && S.date,
          manual: window.S && S.manual,
          picker: document.getElementById('picker').className,
          pick: document.getElementById('pickerList').innerText
        };
      });
    } catch (e) { last = { title: String(e) }; }
    if (pred(last)) return last;
    await new Promise(function (r) { setTimeout(r, 40); });
  }
  throw new Error('timed out: ' + JSON.stringify(last));
}

async function shot(page, name) {
  await page.screenshot({ path: SHOTS + '/' + name + '.png' });
}

async function runUi(browser) {
  const hosted = await appServer();
  const port = hosted.port;
  async function scenario(name, extra) {
    const s = Object.assign({ today: '2026-10-31', status: {}, calls: [], failed: {}, delay: {}, failOnce: {} }, extra || {});
    const opened = await openApp(browser, port, s);
    return { name: name, s: s, page: opened.page, ctx: opened.ctx };
  }

  // Saturday, Friday has only a warm-up logged (no work sets). Wednesday is logged.
  // The old catch-up treated the warm-up as "done" and stayed on Saturday.
  {
    const t = await scenario('missed-friday', { status: { '2026-10-28': { work: true }, '2026-10-30': { warm: true }, '2026-10-20': { work: false } } });
    const st = await waitFor(t.page, function (x) { return x.sdate === '2026-10-30' && x.title.indexOf('Lift C') === 0; });
    assert(st.date.indexOf('missed') !== -1 && st.date.indexOf('not logged') !== -1, 'friday label ' + st.date);
    await shot(t.page, 'missed-friday');
    await t.page.click('#pickBtn');
    const picked = await waitFor(t.page, function (x) { return x.pick.indexOf('Not logged') !== -1 && x.pick.indexOf('Logged') !== -1; });
    assert(picked.picker.indexOf('hidden') === -1, 'picker should be open');
    const rows = await t.page.$$eval('.pick-row', function (els) { return els.map(function (e) { return e.getAttribute('data-date') + ' ' + e.textContent; }); });
    assert(rows.some(function (r) { return r.indexOf('2026-10-30') === 0 && r.indexOf('Not logged') !== -1; }), 'friday row ' + rows.join(' || '));
    assert(rows.some(function (r) { return r.indexOf('2026-10-28') === 0 && r.indexOf('Logged') !== -1; }), 'wednesday row ' + rows.join(' || '));
    await shot(t.page, 'session-picker');
    await t.page.click('.pick-row[data-date="2026-11-02"]');
    const moved = await waitFor(t.page, function (x) { return x.sdate === '2026-11-02' && x.title.indexOf('Lift A') === 0; });
    assert(moved.manual === true, 'manual choice should stick');
    await new Promise(function (r) { setTimeout(r, 400); });
    const still = await t.page.evaluate(function () { return { sdate: S.date, title: document.getElementById('sTitle').textContent }; });
    assert(still.sdate === '2026-11-02' && still.title.indexOf('Lift A') === 0, 'picker choice overwritten: ' + JSON.stringify(still));
    const rules = await t.page.evaluate(function () {
      function mini(date, logged, empty) {
        return { date: date, today: '2026-10-31', session: { session: 'Lift', title: date, exercises: empty ? [] : [{ exercise: 'Squat', sets: [{ set: 1, done: logged ? { weight: 1, reps: 1 } : null }], warmups: [{ set: 'W1', done: { weight: 1, reps: 1 } }] }] } };
      }
      const dates = ['2026-10-20', '2026-10-24', '2026-10-28', '2026-10-30', '2026-11-02'];
      const boundary = chooseLaunchBoot('2026-10-31', dates, {
        '2026-10-20': mini('2026-10-20', false),
        '2026-10-24': mini('2026-10-24', false),
        '2026-10-28': mini('2026-10-28', true),
        '2026-10-30': mini('2026-10-30', false),
        '2026-11-02': mini('2026-11-02', false)
      });
      const bothOpen = chooseLaunchBoot('2026-10-31', dates, {
        '2026-10-28': mini('2026-10-28', false),
        '2026-10-30': mini('2026-10-30', false),
        '2026-11-02': mini('2026-11-02', false)
      });
      const allLogged = chooseLaunchBoot('2026-10-31', dates, {
        '2026-10-28': mini('2026-10-28', true),
        '2026-10-30': mini('2026-10-30', true),
        '2026-11-02': mini('2026-11-02', false)
      });
      const todayLogged = chooseLaunchBoot('2026-11-02', ['2026-10-30', '2026-11-02', '2026-11-06'], {
        '2026-10-30': mini('2026-10-30', true),
        '2026-11-02': mini('2026-11-02', true),
        '2026-11-06': mini('2026-11-06', false)
      });
      store.set('lt_queue', [{ date: '2026-10-30', session: 'Lift', set: 'W1', reps: 5 }]);
      const warmQueue = hasWorkLogged(mini('2026-10-30', false));
      store.set('lt_queue', [{ date: '2026-10-30', session: 'Lift', set: 1, reps: 5 }]);
      const workQueue = hasWorkLogged(mini('2026-10-30', false));
      store.set('lt_queue', []);
      return {
        boundary: boundary.boot && boundary.boot.date,
        week: addDays('2026-10-31', -7),
        both: bothOpen.boot && bothOpen.boot.date,
        next: allLogged.boot && allLogged.boot.date,
        today: todayLogged.boot && todayLogged.boot.date,
        warmQueue: warmQueue,
        workQueue: workQueue
      };
    });
    assert(rules.week === '2026-10-24', 'week window ' + rules.week);
    assert(rules.boundary === '2026-10-24', '7-day boundary landed on ' + rules.boundary);
    assert(rules.both === '2026-10-28', 'earliest miss ' + rules.both);
    assert(rules.next === '2026-11-02', 'fall forward ' + rules.next);
    assert(rules.today === '2026-11-02', 'logged today ' + rules.today);
    assert(rules.warmQueue === false && rules.workQueue === true, 'queue ' + JSON.stringify(rules));
    await t.ctx.close();
    console.log('ok', t.name);
  }

  // Everything in the last week is logged, and Saturday has no plan: open Monday's Lift A.
  {
    const t = await scenario('all-logged', { status: { '2026-10-20': { work: true }, '2026-10-28': { work: true }, '2026-10-30': { work: true }, '2026-11-02': { work: false } } });
    const st = await waitFor(t.page, function (x) { return x.sdate === '2026-11-02'; });
    assert(st.title.indexOf('Lift A') === 0, st.title);
    assert(st.date.indexOf('today') === -1, 'should not claim today: ' + st.date);
    assert(st.date.indexOf('not logged') !== -1, st.date);
    await shot(t.page, 'next-session-when-caught-up');
    await t.ctx.close();
    console.log('ok', t.name);
  }

  // Today itself is planned and already logged: stay on today, don't skip ahead.
  {
    const t = await scenario('today-logged', {
      today: '2026-11-02',
      status: { '2026-10-28': { work: true }, '2026-10-30': { work: true }, '2026-11-02': { work: true }, '2026-11-06': { work: false } }
    });
    const st = await waitFor(t.page, function (x) { return x.sdate === '2026-11-02' && x.date.indexOf('logged') !== -1; });
    assert(st.date.indexOf('today') !== -1, st.date);
    assert(st.title.indexOf('Lift A') === 0, st.title);
    await t.ctx.close();
    console.log('ok', t.name);
  }

  // Two misses: land on the earlier one (Wednesday), not Friday.
  {
    const t = await scenario('earliest', { status: { '2026-10-28': { work: false }, '2026-10-30': { work: false } } });
    const st = await waitFor(t.page, function (x) { return x.sdate === '2026-10-28'; });
    assert(st.title.indexOf('Lift B') === 0, st.title);
    await t.ctx.close();
    console.log('ok', t.name);
  }

  // A miss older than 7 days does not stick. Next planned session is shown.
  {
    const t = await scenario('ancient', { status: { '2026-10-20': { work: false }, '2026-10-28': { work: true }, '2026-10-30': { work: true }, '2026-11-02': { work: false } } });
    const st = await waitFor(t.page, function (x) { return x.title !== 'Loading…' && x.title !== 'Finding your workout…' && x.sdate; });
    assert(st.sdate === '2026-11-02', 'ancient miss stuck: ' + JSON.stringify(st));
    await t.ctx.close();
    console.log('ok', t.name);
  }

  // A single failed lookup is retried; Friday still wins.
  {
    const t = await scenario('retry', { status: { '2026-10-28': { work: true }, '2026-10-30': { work: false } }, failOnce: { '2026-10-30': true } });
    const st = await waitFor(t.page, function (x) { return x.sdate === '2026-10-30'; });
    assert(st.title.indexOf('Lift C') === 0, st.title);
    assert(t.s.calls.filter(function (c) { return c === '2026-10-30'; }).length >= 2, 'expected a retry, calls ' + t.s.calls.join(','));
    await t.ctx.close();
    console.log('ok', t.name);
  }

  hosted.server.close();
}

async function runManual(browser) {
  const hosted = await appServer();
  const scenario = {
    today: '2026-10-31',
    status: { '2026-10-28': { work: true }, '2026-10-30': { work: false }, '2026-11-02': { work: false } },
    delay: { '2026-10-30': 1500 },
    failOnce: {},
    calls: [],
    failed: {},
    seedCache: true
  };
  const opened = await openApp(browser, hosted.port, scenario);
  await opened.page.waitForFunction(function () { return window.S && S.catalog && S.catalog.dates; }, { timeout: 8000 });
  const mid = await opened.page.evaluate(function () { return document.getElementById('sTitle').textContent; });
  assert(mid !== 'Cached Saturday', 'cached today was painted as the launch session: ' + mid);
  await opened.page.click('#pickBtn');
  await opened.page.waitForSelector('.pick-row[data-date="2026-11-02"]');
  await opened.page.click('.pick-row[data-date="2026-11-02"]');
  const st = await waitFor(opened.page, function (x) { return x.sdate === '2026-11-02' && x.title.indexOf('Lift A') === 0; });
  await new Promise(function (r) { setTimeout(r, 1800); });
  const still = await opened.page.evaluate(function () { return { sdate: S.date, title: document.getElementById('sTitle').textContent, manual: S.manual }; });
  assert(still.sdate === '2026-11-02' && still.title.indexOf('Lift A') === 0 && still.manual === true, 'late catch-up overwrote the pick: ' + JSON.stringify(still));
  assert(st.title.indexOf('Lift A') === 0, st.title);
  await opened.ctx.close();
  hosted.server.close();
  console.log('ok manual-during-search');
}

async function runSw() {
  let shell = 'SHELL-V1';
  const server = await listen(function (req, res) {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname === '/sw.js') { res.setHeader('content-type', 'text/javascript'); res.end(sw); return; }
    if (u.pathname === '/sw-harness.html') {
      res.setHeader('content-type', 'text/html');
      res.end('<!doctype html><title>sw</title><script>navigator.serviceWorker.register("/sw.js",{updateViaCache:"none"});</script>');
      return;
    }
    if (u.pathname === '/' || u.pathname === '/index.html') { res.setHeader('content-type', 'text/html'); res.setHeader('cache-control', 'max-age=600'); res.end(shell); return; }
    if (u.pathname === '/manifest.webmanifest') { res.setHeader('content-type', 'application/manifest+json'); res.end(manifest); return; }
    if (u.pathname === '/icon-180.png') { res.setHeader('content-type', 'image/png'); res.end(icon180); return; }
    if (u.pathname === '/icon-512.png') { res.setHeader('content-type', 'image/png'); res.end(icon512); return; }
    res.statusCode = 404; res.end('no');
  });
  const port = server.address().port;
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:' + port + '/sw-harness.html', { waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 30; i++) {
    try {
      const ok = await page.evaluate(function () { return !!(navigator.serviceWorker && navigator.serviceWorker.controller); });
      if (ok) break;
    } catch (e) {}
    if (i === 29) throw new Error('service worker did not take control');
    await new Promise(function (r) { setTimeout(r, 200); });
  }
  await new Promise(function (r) { setTimeout(r, 300); });
  const keys = await page.evaluate(function () { return caches.keys(); });
  assert(keys.indexOf('lifts-shell-v3') !== -1, 'cache version ' + keys.join(','));
  await page.setOfflineMode(true);
  const offline = await page.evaluate(function () { return fetch('/index.html').then(function (r) { return r.text(); }); });
  assert(offline === 'SHELL-V1', 'offline shell ' + offline);
  await page.setOfflineMode(false);
  shell = 'SHELL-V2';
  const online = await page.evaluate(function () { return fetch('/index.html', { cache: 'reload' }).then(function (r) { return r.text(); }); });
  assert(online === 'SHELL-V2', 'online shell stayed cached: ' + online);
  await browser.close();
  server.close();
  console.log('ok service-worker');
}

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  await runUi(browser);
  await runManual(browser);
  await runSw();
} finally {
  await browser.close();
}
console.log('all passed');
