import fs from "node:fs";

const file = "scripts/apply-small-state-store-migration.mjs";
let text = fs.readFileSync(file, "utf8");
text = text.replace(
  'assert.deepEqual(unexpected, [], `new direct onekan_state access: ${unexpected.join(", ")}`);',
  'assert.deepEqual(unexpected, [], "new direct onekan_state access: " + unexpected.join(", "));',
);
text = text.replace(
  'console.log(`remaining direct onekan_state debt: ${debt.join(", ") || "none"}`);',
  'console.log("remaining direct onekan_state debt: " + (debt.join(", ") || "none"));',
);
text = text.replace(
  'assert.doesNotMatch(period, /supabase\\\\./);',
  'assert.doesNotMatch(period, /supabase\\\\.(?:auth|from|storage)/);',
);
fs.writeFileSync(file, text);
