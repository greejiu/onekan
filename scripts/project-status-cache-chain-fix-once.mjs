import fs from "node:fs";

const jsFiles = fs.readdirSync("js").filter((name) => name.endsWith(".js"));
for (const file of jsFiles) {
  const path = `js/${file}`;
  const before = fs.readFileSync(path, "utf8");
  const after = before.replaceAll('./project-status-automation.js?v=2', './project-status-automation.js?v=3');
  if (after !== before) fs.writeFileSync(path, after);
}

const indexPath = "index.html";
let index = fs.readFileSync(indexPath, "utf8");
const replacements = [
  ['./js/direction-context-extension.js?v=5', './js/direction-context-extension.js?v=6'],
  ['./js/project-context-extension.js?v=8', './js/project-context-extension.js?v=9'],
  ['./js/project-direction-tabs.js?v=11', './js/project-direction-tabs.js?v=12'],
  ['./js/project-status.js?v=13', './js/project-status.js?v=14'],
];
for (const [before, after] of replacements) {
  if (!index.includes(before)) throw new Error(`index cache target missing: ${before}`);
  index = index.replace(before, after);
}
fs.writeFileSync(indexPath, index);

const scriptReplacements = [
  ["direction-context-extension\\.js\\?v=5", "direction-context-extension\\.js\\?v=6"],
  ["direction-context-extension.js?v=5", "direction-context-extension.js?v=6"],
  ["project-context-extension\\.js\\?v=8", "project-context-extension\\.js\\?v=9"],
  ["project-context-extension.js?v=8", "project-context-extension.js?v=9"],
  ["project-direction-tabs\\.js\\?v=11", "project-direction-tabs\\.js\\?v=12"],
  ["project-direction-tabs.js?v=11", "project-direction-tabs.js?v=12"],
  ["project-status\\.js\\?v=13", "project-status\\.js\\?v=14"],
  ["project-status.js?v=13", "project-status.js?v=14"],
];
for (const file of fs.readdirSync("scripts").filter((name) => name.endsWith(".mjs"))) {
  const path = `scripts/${file}`;
  if (path === "scripts/project-status-cache-chain-fix-once.mjs") continue;
  const before = fs.readFileSync(path, "utf8");
  let after = before;
  for (const [from, to] of scriptReplacements) after = after.replaceAll(from, to);
  if (after !== before) fs.writeFileSync(path, after);
}

fs.rmSync("scripts/project-status-cache-chain-fix-once.mjs");
fs.rmSync(".github/workflows/project-status-cache-chain-fix-once.yml");
console.log("project status cache dependency chain refreshed");
