import fs from "fs";
import path from "path";

function fixMojibake(text) {
  const replacements = new Map([
    ["â€™", "’"],
    ["â€œ", "“"],
    ["â€�", "”"],
    ["â€“", "–"],
    ["â€”", "—"],
    ["â€¦", "…"],
    ["Â ", " "],
  ]);

  let output = text;
  for (const [from, to] of replacements) output = output.split(from).join(to);
  return output;
}

function folderNameToTitle(folderName) {
  const spaced = folderName.replace(/_/g, " ").trim();
  return spaced.length ? spaced : "Untitled";
}

function folderNameToSlug(folderName) {
  return folderName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function inferTags(title, answer) {
  const text = `${title}\n${answer}`.toLowerCase();
  const tags = new Set();
  const rules = [
    { k: ["patreon", "subscriber", "subscription"], t: "patreon" },
    { k: ["premium", "prime", "tier"], t: "premium" },
    { k: ["role", "roles"], t: "roles" },
    { k: ["prefix"], t: "prefix" },
    { k: ["shortcut", "shortcuts"], t: "shortcuts" },
    { k: ["spotify"], t: "spotify" },
    { k: ["autoplay"], t: "autoplay" },
    { k: ["permissions", "permission"], t: "permissions" },
    { k: ["refund"], t: "refund" },
    { k: ["setup"], t: "setup" },
  ];
  for (const { k, t } of rules) {
    if (k.some((kw) => text.includes(kw))) tags.add(t);
  }
  return [...tags];
}

function cleanExportText(raw) {
  const fixed = fixMojibake(raw).replace(/\r\n/g, "\n");
  const lines = fixed.split("\n");

  let startIndex = 0;
  while (startIndex < lines.length) {
    const line = lines[startIndex].trim();
    const isEmpty = line.length === 0;
    const looksLikeDiscordHeader =
      /^@.+\(.+\)$/.test(line) ||
      /^@.+\]\s*\(.+\)$/.test(line) ||
      /^\[.+\]\s*\(.+\)$/.test(line);
    if (!isEmpty && !looksLikeDiscordHeader) break;
    startIndex++;
  }

  const body = lines.slice(startIndex).join("\n").trim();
  return body.replace(/\n{3,}/g, "\n\n");
}

function getSourceDir() {
  const preferred = path.resolve("faq", "raw");
  const legacy = path.resolve("bulk-export");
  if (fs.existsSync(preferred)) return preferred;
  if (fs.existsSync(legacy)) return legacy;
  throw new Error(`No FAQ export directory found at ${preferred} or ${legacy}`);
}

function pickBestPageFile(dirPath) {
  const files = fs.readdirSync(dirPath).filter((f) => f.toLowerCase().endsWith(".txt"));
  const page1 = files.find((f) => /-page-1\.txt$/i.test(f));
  if (page1) return page1;
  return files.sort((a, b) => a.localeCompare(b))[0] ?? null;
}

function main() {
  const srcDir = getSourceDir();
  const outPath = path.resolve("src", "faq", "faq.json");

  const entries = [];
  const folders = fs.readdirSync(srcDir, { withFileTypes: true }).filter((d) => d.isDirectory());

  for (const folder of folders) {
    const folderPath = path.join(srcDir, folder.name);
    const bestFile = pickBestPageFile(folderPath);
    if (!bestFile) continue;

    const rawText = fs.readFileSync(path.join(folderPath, bestFile), "utf8");
    const answer = cleanExportText(rawText);
    if (!answer) continue;

    const title = folderNameToTitle(folder.name);
    const slug = folderNameToSlug(folder.name);
    entries.push({
      slug,
      title,
      answer,
      tags: inferTags(title, answer),
    });
  }

  entries.sort((a, b) => a.slug.localeCompare(b.slug));

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(entries, null, 2) + "\n", "utf8");
  console.log(`Wrote ${entries.length} FAQ entries to ${outPath}`);
}

main();
