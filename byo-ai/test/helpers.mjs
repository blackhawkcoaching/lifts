import { readFileSync } from "node:fs";

export function readJson(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

export function readText(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

export const schema = readJson("../schema/liftplan-0.1.schema.json");
export const sampleText = readText("../samples/full-body-2-week.json");
export const sample = JSON.parse(sampleText);

export function minimalPlan(mutate) {
  const plan = {
    format: "liftplan",
    version: "0.1",
    name: "Test",
    unit: "lb",
    program: {
      weeks: [
        {
          week: 1,
          days: [
            {
              id: "d1",
              name: "Day 1",
              exercises: [
                {
                  id: "bench",
                  order: 1,
                  name: "Bench Press",
                  equipment: "barbell",
                  sets: [
                    { set: 1, reps: "5", load: 100, rpe: 8, restSec: 180 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
  if (mutate) mutate(plan);
  return plan;
}
