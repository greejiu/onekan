import assert from "node:assert/strict";
import fs from "node:fs";

const index = fs.readFileSync("index.html", "utf8");
const stats = fs.readFileSync("js/tracking-stats.js", "utf8");
const css = fs.readFileSync("css/tracking-stats.css", "utf8");

assert.match(index, /id="page-reports"[\s\S]*?id="reportsPageRoot"/, "the reports page must expose a real render root");
assert.doesNotMatch(index, /리포트 기능은 다음 단계에서 채울게요/, "the reports placeholder must be removed");
assert.match(stats, /reports:\s*\{\s*group:\s*"project",\s*period:\s*"week"\s*\}/, "reports must default to a useful weekly project view");
assert.match(stats, /function reportSummary\(/, "reports must summarize existing oneKan activity data");
assert.match(stats, /renderReports\(latestRawState\)/, "reports must refresh with the shared state snapshot");
assert.match(stats, /onekanStateStore\.read\(/, "reports must use the shared state store instead of direct oneKan state access");
assert.match(stats, /data-stats-context="reports"/, "report period and grouping controls must use their own view state");
assert.match(css, /\.uw-report-metrics\{/, "report summary cards must be styled");
assert.match(css, /\.uw-report-chart\.month\{/, "the monthly activity chart must support its wider date range");
assert.match(css, /@media\(max-width:600px\)/, "the reports page must keep the existing mobile breakpoint");

console.log("reports page regression: ok");
