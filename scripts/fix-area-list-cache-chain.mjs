import { execFileSync } from "node:child_process";

const base = process.env.CACHE_BASE || "origin/main";
const processed = new Set(["js/task-area-list.js", "js/habit-area-list.js"]);

function changedAssets() {
  const output = execFileSync("git", ["diff", "--name-only", base], { encoding: "utf8" });
  return output
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) => /^(?:js|css)\/[^/]+\.(?:js|css)$/.test(value));
}

for (let round = 0; round < 12; round += 1) {
  const pending = changedAssets().filter((path) => !processed.has(path));
  if (!pending.length) break;
  console.log(`cache chain round ${round + 1}: ${pending.join(", ")}`);
  execFileSync(process.execPath, ["scripts/cache-buster-regression.mjs", "--bump", ...pending], { stdio: "inherit" });
  pending.forEach((path) => processed.add(path));
}

const leftovers = changedAssets().filter((path) => !processed.has(path));
if (leftovers.length) throw new Error(`cache dependency chain did not converge: ${leftovers.join(", ")}`);

execFileSync(process.execPath, ["scripts/cache-buster-regression.mjs", "--check-diff", base], { stdio: "inherit" });
console.log("area list cache dependency chain: ok");
