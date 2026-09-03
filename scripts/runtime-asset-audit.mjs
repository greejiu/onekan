import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const normalize = (p) => p.replaceAll("\\", "/").replace(/^\.\//, "").split("?")[0].split("#")[0];
const exists = (p) => fs.existsSync(path.join(root, p));

function listFiles(dir, ext) {
  const out = [];
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = normalize(path.join(dir, entry.name));
    if (entry.isDirectory()) out.push(...listFiles(rel, ext));
    else if (entry.isFile() && rel.endsWith(ext)) out.push(rel);
  }
  return out.sort();
}

function resolveLocal(fromFile, raw) {
  const clean = raw.split("?")[0].split("#")[0];
  if (!clean || /^(?:https?:|data:|blob:|\/\/)/.test(clean)) return null;
  if (!/\.(?:js|css)$/.test(clean)) return null;
  const base = clean.startsWith("/")
    ? clean.slice(1)
    : path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), clean));
  return normalize(base);
}

function extractRefs(file, text) {
  const refs = new Set();
  const patterns = [
    /(?:src|href)\s*=\s*["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g,
    /(?:import\s*(?:\([^)]*?\)|[^;]*?from\s*)|export\s+[^;]*?from\s*)["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g,
    /["'`]((?:\.\.?\/|\/)[^"'`\s]+\.(?:js|css)(?:\?[^"'`\s]*)?)["'`]/g,
  ];
  for (const re of patterns) {
    for (const match of text.matchAll(re)) {
      const ref = resolveLocal(file, match[1]);
      if (ref && exists(ref)) refs.add(ref);
    }
  }
  return refs;
}

const allJs = listFiles("js", ".js");
const allCss = listFiles("css", ".css");
const reachable = new Set();
const queue = [];

function add(file) {
  file = normalize(file);
  if (!exists(file) || reachable.has(file)) return;
  reachable.add(file);
  queue.push(file);
}

const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
for (const ref of extractRefs("index.html", index)) add(ref);

while (queue.length) {
  const file = queue.shift();
  if (!/\.(?:js|css)$/.test(file)) continue;
  const text = fs.readFileSync(path.join(root, file), "utf8");
  for (const ref of extractRefs(file, text)) add(ref);
}

const unreachableJs = allJs.filter((f) => !reachable.has(f));
const unreachableCss = allCss.filter((f) => !reachable.has(f));

console.log(`reachable assets: ${reachable.size}`);
console.log("\nUNREACHABLE JS");
for (const f of unreachableJs) console.log(f);
console.log("\nUNREACHABLE CSS");
for (const f of unreachableCss) console.log(f);
console.log(`\ncounts: js=${unreachableJs.length}, css=${unreachableCss.length}`);
