import { mkdir } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const outDir = process.argv[2] || new URL("../shots/", import.meta.url).pathname;
const base = process.argv[3] || "http://127.0.0.1:8765/";
await mkdir(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/usr/local/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars", "--force-device-scale-factor=1"],
});

const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });

async function shot(name) {
  const file = `${outDir.replace(/\/$/, "")}/${name}.png`;
  await page.screenshot({ path: file, fullPage: false });
  console.log(file);
}

try {
  await page.goto(base, { waitUntil: "networkidle0" });
  await page.waitForSelector("[data-nav='plan']");
  await page.click("[data-nav='plan']");
  await page.click("[data-action='load-sample']");
  await page.waitForFunction(() => document.querySelector("#plan-json")?.value.includes('"liftplan"'));
  await page.click("[data-action='validate']");
  await page.waitForSelector(".ok");
  await shot("byo-ai-import");

  await page.$eval("[data-action='save-plan']", (el) => el.click());
  await page.waitForFunction(() => document.querySelector("h1")?.textContent === "Pull and Curl");
  await page.waitForFunction(() => !document.querySelector(".toast"));
  await shot("byo-ai-today");

  await page.$eval("[data-action='start-log']", (el) => el.click());
  await page.waitForSelector("[data-action='log-set']");
  await page.click("[data-action='log-set']");
  await page.click("[data-action='log-set']");
  await page.waitForSelector("#rest-clock");
  const rest = await page.$eval(".timer p", (node) => node.textContent);
  if (!/one rest for the round/i.test(rest)) throw new Error(`Unexpected rest copy: ${rest}`);
  await shot("byo-ai-rest-timer");

  await page.evaluate(async () => {
    const { importPlan } = await import("./src/liftplan.mjs");
    const { emptyState, finishSession, targetsForDay } = await import("./src/session.mjs");
    const { parseReps } = await import("./src/progression.mjs");
    const schema = await fetch("./schema/liftplan-0.1.schema.json").then((res) => res.json());
    const sample = await fetch("./samples/full-body-2-week.json").then((res) => res.text());
    const top = (reps) => parseReps(reps).max;
    let state = importPlan(emptyState(), sample, schema).state;
    const days = [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]];
    const dates = [
      "2026-11-16T15:00:00.000Z",
      "2026-11-18T15:00:00.000Z",
      "2026-11-20T15:00:00.000Z",
      "2026-11-23T15:00:00.000Z",
      "2026-11-25T15:00:00.000Z",
      "2026-11-27T15:00:00.000Z",
    ];
    days.forEach(([weekIndex, dayIndex], index) => {
      const view = targetsForDay(state, weekIndex, dayIndex);
      const performed = view.queue.filter((item) => item.required).map((item) => {
        const row = {
          exerciseId: item.exerciseId,
          set: item.setId,
          reps: top(item.targetReps),
          load: item.targetLoad,
          rpe: item.targetRpe ?? 8,
        };
        if (index === 1 && row.exerciseId === "rdl") row.reps = 7;
        if ((index === 1 || index === 4) && row.exerciseId === "ohp") row.reps = 3;
        return row;
      });
      const result = finishSession(state, { weekIndex, dayIndex, performed, at: dates[index] });
      if (!result.ok) throw new Error(result.errors.join(" "));
      state = result.state;
    });
    localStorage.setItem("bhc.byo-ai.v1", JSON.stringify(state));
  });
  await page.reload({ waitUntil: "networkidle0" });
  await page.click("[data-nav='progress']");
  await page.waitForFunction(() => document.body.textContent.includes("Overhead Press") && document.body.textContent.includes("Deload"));
  await shot("byo-ai-progress");
} finally {
  await browser.close();
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
