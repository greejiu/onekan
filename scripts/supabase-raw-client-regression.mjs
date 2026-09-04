import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("js/supabase.js", "utf8");
assert.match(source, /import \{ createOnekanStateStore \} from "\.\/state-store\.js\?v=\d+";/);
assert.match(source, /export const supabase = rawSupabase;/);
assert.match(source, /export const onekanStateStore = createOnekanStateStore\(rawSupabase\);/);
assert.doesNotMatch(source, /createStateStoreClient/);
assert.doesNotMatch(source, /stateStoreClient\.client/);
console.log("supabase raw client regression: ok");
