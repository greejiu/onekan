import fs from "node:fs";
import path from "node:path";

const dir = "js";
const allowed = new Set(["state-store.js", "supabase.js"]);
const rows = [];
for (const name of fs.readdirSync(dir).filter((value) => value.endsWith(".js")).sort()) {
  const text = fs.readFileSync(path.join(dir, name), "utf8");
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.includes("onekan_state")) return;
    rows.push({ file: `js/${name}`, line: index + 1, allowed: allowed.has(name), text: line.trim() });
  });
}
const unexpected = rows.filter((row) => !row.allowed);
const report = { generatedAt: new Date().toISOString(), totalReferences: rows.length, unexpectedCount: unexpected.length, rows };
fs.mkdirSync("claude", { recursive: true });
fs.writeFileSync("claude/state-store-direct-access-audit.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
