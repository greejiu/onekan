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
console.log(JSON.stringify(rows, null, 2));
const unexpected = rows.filter((row) => !row.allowed);
console.log(`unexpected direct oneKan state references: ${unexpected.length}`);
for (const row of unexpected) console.log(`${row.file}:${row.line}: ${row.text}`);
