import { emptyState } from "./session.mjs";

export const STORAGE_KEY = "bhc.byo-ai.v1";

export function loadState(storage) {
  const empty = emptyState();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return empty;
    return {
      ...empty,
      ...data,
      log: Array.isArray(data.log) ? data.log : [],
      working: data.working && typeof data.working === "object" ? data.working : {},
      draft: data.draft && typeof data.draft === "object" ? data.draft : null,
      focus: data.focus && typeof data.focus === "object" ? data.focus : null,
    };
  } catch {
    return empty;
  }
}

export function saveState(storage, state) {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}
