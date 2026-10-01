import fs from "fs";
import path from "path";

const DATA_DIR = path.resolve("data");
const STORE_PATH = path.join(DATA_DIR, "references.json");
const TMP_PATH = path.join(DATA_DIR, "references.json.tmp");

let writeQueue = Promise.resolve();

function withWriteLock(fn) {
  const run = async () => fn();
  writeQueue = writeQueue.then(run, run);
  return writeQueue;
}

function nowIso() {
  return new Date().toISOString();
}

export function isValidReferenceKey(key) {
  return typeof key === "string" && /^[a-z0-9-]{2,64}$/.test(key);
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const out = [];
  for (const tag of tags) {
    if (typeof tag !== "string") continue;
    const cleaned = tag.trim().toLowerCase();
    if (!cleaned) continue;
    if (!/^[a-z0-9-]{1,32}$/.test(cleaned)) continue;
    out.push(cleaned);
  }
  return [...new Set(out)].slice(0, 20);
}

function getDefaultStore() {
  return { version: 1, updatedAt: nowIso(), items: {} };
}

function sanitizeStore(parsed) {
  if (!parsed || typeof parsed !== "object") return getDefaultStore();
  if (parsed.version !== 1) return getDefaultStore();
  if (!parsed.items || typeof parsed.items !== "object") return getDefaultStore();

  const items = {};
  for (const [key, value] of Object.entries(parsed.items)) {
    if (!isValidReferenceKey(key)) continue;
    if (!value || typeof value !== "object") continue;
    if (typeof value.text !== "string") continue;
    items[key] = {
      text: value.text,
      tags: normalizeTags(value.tags),
      createdAt: typeof value.createdAt === "string" ? value.createdAt : nowIso(),
      createdBy: typeof value.createdBy === "string" ? value.createdBy : "unknown",
    };
  }

  return {
    version: 1,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : nowIso(),
    items,
  };
}

export async function loadReferenceStore() {
  try {
    const raw = await fs.promises.readFile(STORE_PATH, "utf8");
    return sanitizeStore(JSON.parse(raw));
  } catch (_error) {
    return getDefaultStore();
  }
}

async function saveReferenceStore(store) {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  const toWrite = JSON.stringify(store, null, 2) + "\n";
  await fs.promises.writeFile(TMP_PATH, toWrite, "utf8");
  await fs.promises.rename(TMP_PATH, STORE_PATH);
}

export async function addReference({ key, text, tags, createdBy }) {
  if (!isValidReferenceKey(key)) {
    throw new Error("Invalid key. Use 2-64 chars: a-z, 0-9, hyphen.");
  }
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Text is required.");
  }
  if (text.length > 1500) {
    throw new Error("Text is too long (max 1500 characters).");
  }

  const safeCreatedBy = typeof createdBy === "string" ? createdBy : "unknown";
  const safeTags = normalizeTags(tags);

  return withWriteLock(async () => {
    const store = await loadReferenceStore();
    if (store.items[key]) throw new Error("Key already exists.");
    store.items[key] = {
      text: text.trim(),
      tags: safeTags,
      createdAt: nowIso(),
      createdBy: safeCreatedBy,
    };
    store.updatedAt = nowIso();
    await saveReferenceStore(store);
    return store.items[key];
  });
}

export async function removeReference({ key }) {
  if (!isValidReferenceKey(key)) {
    throw new Error("Invalid key.");
  }
  return withWriteLock(async () => {
    const store = await loadReferenceStore();
    if (!store.items[key]) return false;
    delete store.items[key];
    store.updatedAt = nowIso();
    await saveReferenceStore(store);
    return true;
  });
}

export async function listReferences({ filter } = {}) {
  const store = await loadReferenceStore();
  const entries = Object.entries(store.items).map(([key, value]) => ({
    key,
    text: value.text,
    tags: Array.isArray(value.tags) ? value.tags : [],
    createdAt: value.createdAt,
    createdBy: value.createdBy,
  }));

  const cleanedFilter = typeof filter === "string" ? filter.trim().toLowerCase() : "";
  const filtered = cleanedFilter
    ? entries.filter((e) => {
        const hay = `${e.key}\n${e.tags.join(",")}\n${e.text}`.toLowerCase();
        return hay.includes(cleanedFilter);
      })
    : entries;

  filtered.sort((a, b) => a.key.localeCompare(b.key));
  return filtered;
}

