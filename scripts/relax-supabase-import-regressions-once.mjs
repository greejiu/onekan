import fs from "node:fs";
import path from "node:path";

const replacements = [
  ['from "\\.\\/supabase\\.js";', 'from "\\.\\/supabase\\.js(?:\\?v=\\d+)?";'],
  ['supabase\\.js"', 'supabase\\.js(?:\\?v=\\d+)?"'],
];
let changed = 0;
for (const name of fs.readdirSync("scripts").filter((value) => value.endsWith("-regression.mjs"))) {
  const file = path.join("scripts", name);
  const source = fs.readFileSync(file, "utf8");
  let next = source;
  for (const [before, after] of replacements) next = next.split(before).join(after);
  if (next === source) continue;
  fs.writeFileSync(file, next);
  changed += 1;
  console.log(`relaxed versioned supabase import assertion: ${file}`);
}
console.log(`relaxed ${changed} regression file(s)`);
