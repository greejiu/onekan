import fs from "node:fs";
import path from "node:path";

const before = 'from "\\.\\/supabase\\.js";';
const after = 'from "\\.\\/supabase\\.js(?:\\?v=\\d+)?";';
let changed = 0;
for (const name of fs.readdirSync("scripts").filter((value) => value.endsWith("-regression.mjs"))) {
  const file = path.join("scripts", name);
  const source = fs.readFileSync(file, "utf8");
  const next = source.split(before).join(after);
  if (next === source) continue;
  fs.writeFileSync(file, next);
  changed += 1;
  console.log(`relaxed versioned supabase import assertion: ${file}`);
}
console.log(`relaxed ${changed} regression file(s)`);
