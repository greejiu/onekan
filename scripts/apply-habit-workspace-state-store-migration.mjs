import fs from "node:fs";
import { execFileSync } from "node:child_process";

function replaceOnce(source, search, replacement, label) {
  const index = source.indexOf(search);
  if (index < 0) throw new Error(`pattern not found: ${label}`);
  return source.slice(0, index) + replacement + source.slice(index + search.length);
}

const overviewPath = "js/repeat-overview.js";
let overview = fs.readFileSync(overviewPath, "utf8");
overview = replaceOnce(
  overview,
  'import { supabase } from "./supabase.js";',
  'import { onekanStateStore } from "./supabase.js";',
  "repeat overview state-store import",
);
overview = replaceOnce(
  overview,
  'let state=null;\nlet user=null;\n',
  'let state=null;\n',
  "repeat overview user state",
);
const oldOverviewState = `async function readState(){
  const {data:{session}}=await supabase.auth.getSession();
  user=session?.user||null;
  if(!user)return null;
  const {data,error}=await supabase.from("onekan_state").select("data").eq("user_id",user.id).maybeSingle();
  if(error)throw error;
  state=data?.data&&typeof data.data==="object"?data.data:{};
  state.tasks=Array.isArray(state.tasks)?state.tasks:[];
  state.timeBlocks=Array.isArray(state.timeBlocks)?state.timeBlocks:[];
  state.eventGroups=Array.isArray(state.eventGroups)&&state.eventGroups.length?state.eventGroups:[{id:"default",name:"기본",color:"#8fa9c4"}];
  state.projects=Array.isArray(state.projects)?state.projects:[];
  state.ui=state.ui&&typeof state.ui==="object"?state.ui:{};
  const range=state.ui.timelineRange&&typeof state.ui.timelineRange==="object"?state.ui.timelineRange:{};
  state.ui.timelineRange={start:Number(range.start)||360,end:Number(range.end)||1320};
  normalizeCompletionRepeats(state);
  return state
}

async function writeState(mutator,source="habit-workspace"){
  await readState();
  if(!state||!user)return false;
  mutator(state);
  const {error}=await supabase.from("onekan_state").upsert({user_id:user.id,data:state},{onConflict:"user_id"});
  if(error)throw error;
  document.dispatchEvent(new CustomEvent("onekan:state-changed",{detail:{source}}));
  $("#reloadCloudBtn")?.click();
  scheduleRender(80);
  return true
}`;
const newOverviewState = `function normalizeState(value){
  const next=value&&typeof value==="object"?value:{};
  next.tasks=Array.isArray(next.tasks)?next.tasks:[];
  next.timeBlocks=Array.isArray(next.timeBlocks)?next.timeBlocks:[];
  next.eventGroups=Array.isArray(next.eventGroups)&&next.eventGroups.length?next.eventGroups:[{id:"default",name:"기본",color:"#8fa9c4"}];
  next.projects=Array.isArray(next.projects)?next.projects:[];
  next.ui=next.ui&&typeof next.ui==="object"?next.ui:{};
  const range=next.ui.timelineRange&&typeof next.ui.timelineRange==="object"?next.ui.timelineRange:{};
  next.ui.timelineRange={start:Number(range.start)||360,end:Number(range.end)||1320};
  normalizeCompletionRepeats(next);
  return next
}

async function readState(){
  const stored=await onekanStateStore.read();
  if(!stored){state=null;return null}
  state=normalizeState(stored);
  return state
}

async function writeState(mutator,source="habit-workspace"){
  const committed=await onekanStateStore.mutate((current)=>{
    const next=normalizeState(current);
    mutator(next);
    return next
  },{source});
  if(!committed)return false;
  state=normalizeState(committed);
  $("#reloadCloudBtn")?.click();
  scheduleRender(80);
  return true
}`;
overview = replaceOnce(overview, oldOverviewState, newOverviewState, "repeat overview read/write state");
fs.writeFileSync(overviewPath, overview);

const historyPath = "js/habit-history-view.js";
let history = fs.readFileSync(historyPath, "utf8");
history = replaceOnce(
  history,
  'import { supabase } from "./supabase.js";',
  'import { onekanStateStore } from "./supabase.js";',
  "habit history state-store import",
);
const oldHistoryRead = `async function readSeries(id){
  const {data:{session}}=await supabase.auth.getSession();
  if(!session?.user)return null;
  const {data,error}=await supabase.from("onekan_state").select("data").eq("user_id",session.user.id).maybeSingle();
  if(error)throw error;
  const state=data?.data&&typeof data.data==="object"?data.data:{};
  state.tasks=Array.isArray(state.tasks)?state.tasks:[];
  normalizeCompletionRepeats(state);
  const target=state.tasks.find((task)=>task.id===id&&task.isHabit);
  if(!target)return null;
  const seriesId=target.repeatSeriesId||target.id;
  const series=state.tasks.filter((task)=>task.isHabit&&(task.repeatSeriesId||task.id)===seriesId);
  return {target,series};
}`;
const newHistoryRead = `async function readSeries(id){
  const state=await onekanStateStore.read();
  if(!state)return null;
  state.tasks=Array.isArray(state.tasks)?state.tasks:[];
  normalizeCompletionRepeats(state);
  const target=state.tasks.find((task)=>task.id===id&&task.isHabit);
  if(!target)return null;
  const seriesId=target.repeatSeriesId||target.id;
  const series=state.tasks.filter((task)=>task.isHabit&&(task.repeatSeriesId||task.id)===seriesId);
  return {target,series};
}`;
history = replaceOnce(history, oldHistoryRead, newHistoryRead, "habit history read state");
fs.writeFileSync(historyPath, history);

const regression = [
  'import assert from "node:assert/strict";',
  'import fs from "node:fs";',
  '',
  'const overview = fs.readFileSync("js/repeat-overview.js", "utf8");',
  'const history = fs.readFileSync("js/habit-history-view.js", "utf8");',
  'const helper = fs.readFileSync("js/repeat-after-completion.js", "utf8");',
  '',
  'assert.match(overview, /import \\{ onekanStateStore \\} from "\\.\\/supabase\\.js";/);',
  'assert.match(overview, /onekanStateStore\\.read\\(\\)/);',
  'assert.match(overview, /onekanStateStore\\.mutate\\(/);',
  'assert.doesNotMatch(overview, /supabase\\.(?:auth|from)/);',
  'assert.doesNotMatch(overview, /let user=/);',
  'assert.doesNotMatch(overview, /dispatchEvent\\(new CustomEvent\\("onekan:state-changed"/);',
  '',
  'assert.match(history, /import \\{ onekanStateStore \\} from "\\.\\/supabase\\.js";/);',
  'assert.match(history, /onekanStateStore\\.read\\(\\)/);',
  'assert.doesNotMatch(history, /supabase\\.(?:auth|from)/);',
  '',
  'assert.doesNotMatch(helper, /from "\\.\\/supabase\\.js"/);',
  'assert.doesNotMatch(helper, /onekan_state/);',
  '',
  'console.log("habit workspace direct state-store regression: ok");',
  '',
].join("\n");
fs.writeFileSync("scripts/habit-workspace-state-store-regression.mjs", regression);

const base = process.env.CACHE_BASE || "origin/main";
const queue = [overviewPath, historyPath];
const queued = new Set(queue);
const processed = new Set();

function changedAssets() {
  return execFileSync("git", ["diff", "--name-only", base], { encoding: "utf8" })
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) => /^(?:js|css)\/[^/]+\.(?:js|css)$/.test(value));
}

while (queue.length) {
  const target = queue.shift();
  console.log(`bump cache references for ${target}`);
  execFileSync(process.execPath, ["scripts/cache-buster-regression.mjs", "--bump", target], { stdio: "inherit" });
  processed.add(target);
  for (const asset of changedAssets()) {
    if (processed.has(asset) || queued.has(asset)) continue;
    queued.add(asset);
    queue.push(asset);
  }
}

execFileSync(process.execPath, ["scripts/cache-buster-regression.mjs", "--check-diff", base], { stdio: "inherit" });
console.log("habit workspace state-store migration applied");
