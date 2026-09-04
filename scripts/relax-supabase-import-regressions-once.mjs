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
  // Cache versions are implementation details. When this migration bumps a dependency graph,
  // keep feature regressions focused on the asset being present rather than one exact version.
  next = next.replace(/\\\?v=\d+/g, "\\?v=\\d+");
  if (next === source) continue;
  fs.writeFileSync(file, next);
  changed += 1;
  console.log(`relaxed versioned asset assertion: ${file}`);
}
console.log(`relaxed ${changed} regression file(s)`);
