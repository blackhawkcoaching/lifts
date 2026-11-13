import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("the service worker only caches files that exist", () => {
  const source = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  const assets = [...source.matchAll(/"(\.\/[^"]+)"/g)].map((match) => match[1]);
  assert.ok(assets.length >= 10);
  for (const asset of assets) {
    if (asset === "./") continue;
    const file = new URL(`../${asset.slice(2)}`, import.meta.url);
    assert.equal(existsSync(file), true, asset);
  }
});

test("the app shell does not grow a diet or nutrition feature", () => {
  const ui = [
    readFileSync(new URL("../app.js", import.meta.url), "utf8"),
    readFileSync(new URL("../index.html", import.meta.url), "utf8"),
  ].join("\n");
  assert.doesNotMatch(ui, /nutrition|calorie|macro|meal plan|food log|body fat|weigh-in/i);
});
