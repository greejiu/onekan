import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
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
  const add = (fromFile, raw) => {
    const ref = resolveLocal(fromFile, raw);
    if (ref && exists(ref)) refs.add(ref);
  };

  for (const match of text.matchAll(/(?:src|href)\s*=\s*["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g)) {
    add(file, match[1]);
  }
  for (const match of text.matchAll(/(?:import\s*(?:\([^)]*?\)|[^;]*?from\s*)|export\s+[^;]*?from\s*)["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g)) {
    add(file, match[1]);
  }
  for (const match of text.matchAll(/["'`]((?:\.\.?\/|\/)[^"'`\s]+\.(?:js|css)(?:\?[^"'`\s]*)?)["'`]/g)) {
    add(file, match[1]);
  }
  // link.href/script.src 같은 런타임 DOM 삽입 경로는 모듈 파일이 아니라 문서 URL 기준으로 해석된다.
  for (const match of text.matchAll(/(?:href|src)\s*=\s*["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g)) {
    add("index.html", match[1]);
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
  const text = fs.readFileSync(path.join(root, file), "utf8");
  for (const ref of extractRefs(file, text)) add(ref);
}

const unreachableJs = allJs.filter((file) => !reachable.has(file));
const unreachableCss = allCss.filter((file) => !reachable.has(file));

console.log(`runtime assets reachable: ${reachable.size}`);
if (unreachableJs.length) console.log("unreachable js:\n" + unreachableJs.join("\n"));
if (unreachableCss.length) console.log("unreachable css:\n" + unreachableCss.join("\n"));

assert.deepEqual(unreachableJs, [], "index.html에서 시작한 런타임 그래프에 도달하지 않는 JS가 있습니다.");
assert.deepEqual(unreachableCss, [], "index.html에서 시작한 런타임 그래프에 도달하지 않는 CSS가 있습니다.");
console.log("runtime asset reachability: ok");
