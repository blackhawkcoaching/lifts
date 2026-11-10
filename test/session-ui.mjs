// Phone-width check of per-set rest, a note-paired superset, and the round timer.
//   NODE_PATH=/tmp/probe/node_modules node test/session-ui.mjs
import { createServer } from 'http';
import { createRequire } from 'module';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { extname } from 'path';

const probeRequire = createRequire(existsSync('/tmp/probe/package.json') ? '/tmp/probe/package.json' : import.meta.url);
const puppeteer = probeRequire('puppeteer-core');
const LiftPlan = createRequire(import.meta.url)('../plan.js');

const ROOT = new URL('..', import.meta.url).pathname;
const html = readFileSync(ROOT + 'index.html');
const planJs = readFileSync(ROOT + 'plan.js');
const sw = readFileSync(ROOT + 'sw.js');
const manifest = readFileSync(ROOT + 'manifest.webmanifest');
const KEY = 'testkeytestkey12';
const OUT = '/opt/cursor/artifacts';
const posted = [];
mkdirSync(OUT, { recursive: true });

const HEAD = ['Date', 'Session', 'Order', 'Exercise', 'Set', 'TargetWeight', 'TargetReps', 'Note', 'RestSec'];
const catalog = {
  'bench press': { type: 'barbell', bar: 45, inc: 5 },
  'db romanian deadlift': { type: 'dumbbell', bar: 0, inc: 2.5 },
  'db reverse fly': { type: 'dumbbell', bar: 0, inc: 2.5 }
};
const exercises = LiftPlan.rowsToSession(HEAD, [
  ['2026-11-16', 'Lift A', 2, 'Bench Press', 1, 160, 3, 'Heavy top triple. Rest 180s.', 180],
  ['2026-11-16', 'Lift A', 2, 'Bench Press', 2, 130, '8-12', 'Backoff hypertrophy volume.', 90],
  ['2026-11-16', 'Lift A', 2, 'Bench Press', 3, 130, '8-12', '', 90],
  ['2026-11-16', 'Lift A', 2, 'Bench Press', 4, 130, '8-12', '', 90],
  ['2026-11-16', 'Lift A', 4, 'DB Romanian Deadlift', 1, 35, '10-12', 'Superset A with DB Reverse Fly; 35s per hand, slow 3-sec lowering', 60],
  ['2026-11-16', 'Lift A', 4, 'DB Romanian Deadlift', 2, 35, '10-12', '', 60],
  ['2026-11-16', 'Lift A', 5, 'DB Reverse Fly', 1, 16, '12-15', 'Superset A with DB Romanian Deadlift.', 60],
  ['2026-11-16', 'Lift A', 5, 'DB Reverse Fly', 2, 16, '12-15', '', 60]
], { date: '2026-11-16', catalog: catalog, bar: 45 });
const rdl = exercises.filter(function (g) { return g.exercise === 'DB Romanian Deadlift'; })[0];
rdl.warmups = [{ set: 'W1', targetWeight: 135, targetReps: '5', note: '', prescribed: false }];

const boot = {
  date: '2026-11-16', today: '2026-11-10', dates: ['2026-11-16'],
  settings: { goal_weight: 183, rest_main_sec: 180, rest_accessory_sec: 90, rest_warmup_sec: 60, bar_weight: 45, plates: '45,35,25,10,5,2.5', show_warmups: 'Y' },
  exercises: [
    { name: 'Bench Press', type: 'barbell', bar: 45, inc: 5, plateMath: true, rest: 180, chart: true, aliases: [] },
    { name: 'DB Romanian Deadlift', type: 'dumbbell', bar: 0, inc: 2.5, plateMath: false, rest: 60, chart: false, aliases: ['db rdl'] },
    { name: 'DB Reverse Fly', type: 'dumbbell', bar: 0, inc: 2.5, plateMath: false, rest: 90, chart: false, aliases: [] }
  ],
  weights: [], last: {},
  session: { session: 'Lift A', title: 'Lift A (hypertrophy)', note: '', showWarmups: true, exercises: exercises }
};

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const server = createServer(function (req, res) {
  const u = new URL(req.url, 'http://127.0.0.1');
  const file = u.pathname === '/' ? '/index.html' : u.pathname;
  const body = file === '/index.html' ? html : file === '/plan.js' ? planJs : file === '/sw.js' ? sw : file === '/manifest.webmanifest' ? manifest : null;
  if (!body) { res.statusCode = 404; res.end('no'); return; }
  const type = extname(file) === '.js' ? 'text/javascript' : extname(file) === '.webmanifest' ? 'application/manifest+json' : 'text/html; charset=utf-8';
  res.setHeader('content-type', type);
  res.end(body);
});
await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
const port = server.address().port;

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', function (err) { errors.push(err.message); });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await page.setRequestInterception(true);
  page.on('request', function (req) {
    const u = req.url();
    if (u.indexOf('script.google.com') !== -1) {
      if (req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}');
        (body.items || []).forEach(function (i) { posted.push(i); });
        const ids = (body.items || []).map(function (i) { return i.clientId; });
        req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ ok: true, data: ids }) });
        return;
      }
      req.respond({
        status: 200, contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
        body: JSON.stringify({ ok: true, data: boot })
      });
      return;
    }
    if (u.indexOf('http://127.0.0.1:' + port) === 0) req.continue();
    else req.respond({ status: 404, body: '' });
  });
  await page.goto('http://127.0.0.1:' + port + '/#k=' + KEY, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForFunction(function () { return document.getElementById('sTitle').textContent.indexOf('Lift A') === 0; }, { timeout: 8000 });
  const opened = await page.evaluate(function () {
    var text = document.getElementById('exList').innerText;
    return {
      text: text,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      timer: document.getElementById('timer').className
    };
  });
  assert(!errors.length, 'page error ' + errors.join(' | '));
  assert(opened.overflow <= 1, 'horizontal overflow ' + opened.overflow);
  assert(opened.text.indexOf('135') === -1, 'dumbbell auto warm-up was shown');
  assert(opened.text.indexOf('empty bar') !== -1, 'barbell bench warm-ups missing');
  assert(opened.text.indexOf('Superset A') !== -1, 'superset missing');
  assert(opened.text.indexOf('rest per set') !== -1, 'bench rest pill ' + opened.text);
  assert(opened.text.indexOf('rest 3m') !== -1 && opened.text.indexOf('rest 1.5m') !== -1, 'per-set labels ' + opened.text);
  assert(opened.text.indexOf('35s per hand') !== -1, 'coaching note stripped too far');
  assert(opened.timer === '', 'timer started before any set');

  await page.click('#wuToggle');
  await page.waitForFunction(function () { return document.getElementById('wuToggle').textContent.indexOf('hidden') !== -1; });
  await page.evaluate(function () {
    var h = Array.prototype.filter.call(document.querySelectorAll('h2'), function (n) { return n.textContent === 'Bench Press'; })[0];
    var y = h.getBoundingClientRect().top + window.scrollY - document.querySelector('header').offsetHeight - 8;
    window.scrollTo(0, Math.max(0, y));
  });
  await page.screenshot({ path: OUT + '/phone_bench_rest.png' });

  await page.evaluate(function () {
    var h = Array.prototype.filter.call(document.querySelectorAll('h2'), function (n) { return n.textContent === 'Superset A'; })[0];
    var y = h.getBoundingClientRect().top + window.scrollY - document.querySelector('header').offsetHeight - 8;
    window.scrollTo(0, Math.max(0, y));
  });
  await page.screenshot({ path: OUT + '/phone_superset.png' });

  await page.click('.set[data-ex="DB Romanian Deadlift"][data-set="1"] .chk');
  await page.waitForFunction(function () {
    return !!document.querySelector('.set[data-ex="DB Romanian Deadlift"][data-set="1"].done');
  });
  const mid = await page.evaluate(function () { return document.getElementById('timer').className; });
  assert(mid === '', 'rest started after only A1: ' + mid);

  await page.click('.set[data-ex="DB Reverse Fly"][data-set="1"] .chk');
  await page.waitForFunction(function () {
    return document.getElementById('timer').className.indexOf('show') !== -1 && document.getElementById('tLbl').textContent.indexOf('Superset A') !== -1;
  });
  const done = await page.evaluate(function () {
    return {
      label: document.getElementById('tLbl').textContent,
      val: document.getElementById('tVal').textContent,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  });
  assert(/^0?1:00$|^0:59$/.test(done.val), 'timer ' + done.val);
  assert(done.overflow <= 1, 'overflow after log ' + done.overflow);
  await page.evaluate(function () {
    var h = Array.prototype.filter.call(document.querySelectorAll('h2'), function (n) { return n.textContent === 'Superset A'; })[0];
    var y = h.getBoundingClientRect().top + window.scrollY - document.querySelector('header').offsetHeight - 8;
    window.scrollTo(0, Math.max(0, y));
  });
  await page.screenshot({ path: OUT + '/phone_rest_timer.png' });
  const logged = posted.filter(function (i) { return !i.deleted; });
  assert(logged.some(function (i) { return i.exercise === 'DB Romanian Deadlift' && Number(i.set) === 1 && i.notes === ''; }), 'rdl log ' + JSON.stringify(logged));
  assert(logged.some(function (i) { return i.exercise === 'DB Reverse Fly' && Number(i.set) === 1 && i.reps === 12 && i.notes === ''; }), 'fly log ' + JSON.stringify(logged));
  console.log('session ui ok', done.label, done.val);
} finally {
  await browser.close();
  server.close();
}
