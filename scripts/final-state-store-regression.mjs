import assert from "node:assert/strict";
import fs from "node:fs";

const backup = fs.readFileSync("js/backup-manager.js", "utf8");
const timeBlocks = fs.readFileSync("js/time-block-v2-settings.js", "utf8");
const tracking = fs.readFileSync("js/tracking-stats.js", "utf8");

assert.match(backup, /onekanStateStore\.read\(\{ userId: user\.id \}\)/, "backup shared read");
assert.match(backup, /stripStateStoreMeta\(stored\)/, "backup strips state-store metadata before history snapshot");
assert.match(backup, /onekanStateStore\.mutate\(/, "backup restore uses shared mutate");
assert.match(backup, /source: "backup-restore"/, "backup restore source");
assert.doesNotMatch(backup, /supabase\.from\(["']onekan_state["']\)/, "backup direct live-state access");
assert.match(backup, /supabase\.from\(["']onekan_state_history["']\)/, "backup history table remains independent");

assert.match(timeBlocks, /onekanStateStore\.read\(/, "time-block settings shared read");
assert.match(timeBlocks, /onekanStateStore\.mutate\(/, "time-block settings shared mutate");
assert.doesNotMatch(timeBlocks, /supabase\.from\(["']onekan_state["']\)/, "time-block direct state access");
assert.doesNotMatch(timeBlocks, /dispatchEvent\(new CustomEvent\("onekan:state-changed"/, "time-block duplicate event");

assert.match(tracking, /onekanStateStore\.read\(/, "tracking stats shared read");
assert.doesNotMatch(tracking, /onekanStateStore\.mutate\(/, "tracking stats stays read-only");
assert.doesNotMatch(tracking, /supabase\.from\(["']onekan_state["']\)/, "tracking stats direct state access");

console.log("final state-store migration regression: ok");
