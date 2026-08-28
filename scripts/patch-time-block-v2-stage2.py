from pathlib import Path
import re

core_path = Path('js/time-block-v2.js')
core = core_path.read_text(encoding='utf-8')

if 'export const TIME_BLOCK_START_ANCHOR' not in core:
    core = core.replace(
        'export const TIME_BLOCK_BASELINE_DATE = "1970-01-01";\n',
        'export const TIME_BLOCK_BASELINE_DATE = "1970-01-01";\nexport const TIME_BLOCK_START_ANCHOR = "block-start";\n'
    )

if 'function validDateKey(value)' not in core:
    anchor = '''function cleanDateKey(value, fallback = TIME_BLOCK_BASELINE_DATE) {\n  const text = String(value || "");\n  return /^\\d{4}-\\d{2}-\\d{2}$/.test(text) ? text : fallback;\n}\n'''
    addition = anchor + '''\nfunction validDateKey(value) {\n  return /^\\d{4}-\\d{2}-\\d{2}$/.test(String(value || ""));\n}\n'''
    if anchor not in core:
        raise SystemExit('core cleanDateKey anchor not found')
    core = core.replace(anchor, addition, 1)

if 'function cleanAssignment(value)' not in core:
    anchor = 'function sameTemplateShape(a, b) {'
    idx = core.find(anchor)
    if idx < 0:
        raise SystemExit('sameTemplateShape anchor not found')
    end = core.find('\n}\n', idx)
    if end < 0:
        raise SystemExit('sameTemplateShape end not found')
    end += 3
    addition = '''\nfunction cleanAssignment(value) {\n  if (!value || !value.blockId) return null;\n  const order = Math.max(1, Math.floor(Number(value.order) || 1));\n  return {\n    blockId: String(value.blockId),\n    afterAnchor: String(value.afterAnchor || TIME_BLOCK_START_ANCHOR),\n    order,\n  };\n}\n'''
    core = core[:end] + addition + core[end:]

assign_init = '''  if (!state.timeBlockAssignments || typeof state.timeBlockAssignments !== "object" || Array.isArray(state.timeBlockAssignments)) {\n    state.timeBlockAssignments = {};\n    changed = true;\n  }\n'''
if 'state.timeBlockAssignments = {};' not in core:
    anchor = '''  if (!Array.isArray(state.timeBlockTemplateVersions)) {\n    state.timeBlockTemplateVersions = [];\n    changed = true;\n  }\n'''
    if anchor not in core:
        raise SystemExit('timeBlockTemplateVersions init anchor not found')
    core = core.replace(anchor, anchor + assign_init, 1)

if 'export function timeBlockOccurrenceToken' not in core:
    core += '''\nexport function timeBlockOccurrenceToken(kind, item, dateKey) {\n  if (!kind || !item?.id || !validDateKey(dateKey)) return "";\n  const sourceDate = validDateKey(item._occurrenceSource) ? item._occurrenceSource : dateKey;\n  return `${String(kind)}:${String(item.id)}:${sourceDate}`;\n}\n\nexport function timeBlockAssignmentsForDate(state, dateKey) {\n  if (!state || !validDateKey(dateKey)) return {};\n  ensureTimeBlockV2State(state);\n  const raw = state.timeBlockAssignments?.[dateKey];\n  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};\n  const result = {};\n  for (const [token, value] of Object.entries(raw)) {\n    const cleaned = cleanAssignment(value);\n    if (cleaned) result[token] = cleaned;\n  }\n  return result;\n}\n\nexport function timeBlockAssignment(state, dateKey, token) {\n  if (!token) return null;\n  return timeBlockAssignmentsForDate(state, dateKey)[token] || null;\n}\n\nexport function setTimeBlockAssignment(state, dateKey, token, value) {\n  if (!state || !validDateKey(dateKey) || !token) return false;\n  ensureTimeBlockV2State(state);\n  const cleaned = cleanAssignment(value);\n  if (!cleaned) return false;\n  state.timeBlockAssignments[dateKey] ||= {};\n  const current = cleanAssignment(state.timeBlockAssignments[dateKey][token]);\n  if (current && current.blockId === cleaned.blockId && current.afterAnchor === cleaned.afterAnchor && current.order === cleaned.order) return false;\n  state.timeBlockAssignments[dateKey][token] = cleaned;\n  return true;\n}\n\nexport function assignTimeBlockOccurrence(state, dateKey, token, blockId, afterAnchor = TIME_BLOCK_START_ANCHOR) {\n  if (!state || !validDateKey(dateKey) || !token || !blockId) return false;\n  const assignments = timeBlockAssignmentsForDate(state, dateKey);\n  let maxOrder = 0;\n  for (const [otherToken, value] of Object.entries(assignments)) {\n    if (otherToken === token) continue;\n    if (value.blockId === String(blockId) && value.afterAnchor === String(afterAnchor || TIME_BLOCK_START_ANCHOR)) {\n      maxOrder = Math.max(maxOrder, Number(value.order) || 0);\n    }\n  }\n  return setTimeBlockAssignment(state, dateKey, token, {\n    blockId: String(blockId),\n    afterAnchor: String(afterAnchor || TIME_BLOCK_START_ANCHOR),\n    order: maxOrder + 1,\n  });\n}\n\nexport function clearTimeBlockAssignment(state, dateKey, token) {\n  if (!state || !validDateKey(dateKey) || !token || !state.timeBlockAssignments?.[dateKey]?.[token]) return false;\n  delete state.timeBlockAssignments[dateKey][token];\n  if (!Object.keys(state.timeBlockAssignments[dateKey]).length) delete state.timeBlockAssignments[dateKey];\n  return true;\n}\n'''

core_path.write_text(core, encoding='utf-8')

settings_path = Path('js/time-block-v2-settings.js')
settings = settings_path.read_text(encoding='utf-8')
settings = settings.replace('from "./time-block-v2.js";', 'from "./time-block-v2.js?v=2";')
settings_path.write_text(settings, encoding='utf-8')

uw_path = Path('js/unified-workspace.js')
uw = uw_path.read_text(encoding='utf-8')

if 'from "./time-block-v2.js?v=2"' not in uw:
    anchor = 'import { confirmAction } from "./ui-feedback.js";\n'
    addition = anchor + '''import {\n  TIME_BLOCK_START_ANCHOR,\n  assignTimeBlockOccurrence,\n  clearTimeBlockAssignment,\n  ensureTimeBlockV2State,\n  timeBlockAssignmentsForDate,\n  timeBlockOccurrenceToken,\n  timeBlockTemplatesForDate,\n} from "./time-block-v2.js?v=2";\n'''
    if anchor not in uw:
        raise SystemExit('unified import anchor not found')
    uw = uw.replace(anchor, addition, 1)

if 'ensureTimeBlockV2State(s);' not in uw:
    anchor = '  s.timeBlocks=Array.isArray(s.timeBlocks)?s.timeBlocks:[];\n'
    if anchor not in uw:
        raise SystemExit('unified normalize anchor not found')
    uw = uw.replace(anchor, anchor + '  ensureTimeBlockV2State(s);\n', 1)

helpers = r'''function timeBlockV2MinuteText(minute){const value=Math.max(0,Math.min(1439,Number(minute)||0));return`${pad(Math.floor(value/60))}:${pad(value%60)}`}
function timeBlockV2TemplateForMinute(templates,minute){return templates.find(template=>Number(minute)>=Number(template.startMinute)&&Number(minute)<Number(template.endMinute))||null}
function timeBlockV2Assignable(entry){return!entry.timed&&(entry.kind==="task"||entry.kind==="habit")}
function timeBlockV2EntryToken(entry,k){return timeBlockOccurrenceToken(entry.kind,entry.item,k)}
function timeBlockV2PickerMarkup(entry,k,templates,assignment){
  if(!timeBlockV2Assignable(entry))return"";
  const token=timeBlockV2EntryToken(entry,k),selected=assignment?.blockId||"";
  return`<select class="uw-time-block-picker" data-uw-time-block-picker data-date="${k}" data-token="${esc(token)}" aria-label="타임블럭 선택"><option value=""${selected?"":" selected"}>타임블럭 없음</option>${templates.map(template=>`<option value="${esc(template.id)}"${selected===template.id?" selected":""}>${timeBlockV2MinuteText(template.startMinute)}–${timeBlockV2MinuteText(template.endMinute)}${template.title?` · ${esc(template.title)}`:""}</option>`).join("")}</select>`
}
function timeBlockV2ItemMarkup(entry,k,templates,assignment=null){
  const kind=entry.kind,item=entry.item,done=itemDoneOn(kind,item,k),repeat=recurrenceLabel(item),occurrence=(kind==="task"||kind==="event")&&item._occurrenceSource?` data-occurrence-source="${item._occurrenceSource}"`:"",time=entry.timed?timeBlockV2MinuteText(entry.time):"",picker=timeBlockV2PickerMarkup(entry,k,templates,assignment);
  return`<div class="uw-item uw-${kind} uw-time-block-v2-item${entry.timed?" timed":" untimed"}${done?" done":""}" style="${groupStyle(item)}" data-uw-kind="${kind}" data-id="${item.id}" data-date="${k}"${occurrence} draggable="false">${checkMarkup(kind,item,k)}<span class="uw-item-title">${esc(item.title)}</span>${repeat?`<span class="uw-repeat-badge">↻ ${repeat}</span>`:""}${time?`<span class="uw-item-time">${time}</span>`:""}${picker}<button class="uw-move-handle" type="button" aria-label="길게 눌러 이동">↕</button><button class="uw-select-circle" type="button" aria-label="선택"></button></div>`
}
function timeBlockV2ManualGroup(entries,k,templates,assignments,anchor){
  return entries.filter(entry=>{const token=timeBlockV2EntryToken(entry,k),assignment=assignments[token];return(assignment?.afterAnchor||TIME_BLOCK_START_ANCHOR)===anchor}).sort((a,b)=>{const at=timeBlockV2EntryToken(a,k),bt=timeBlockV2EntryToken(b,k),aa=assignments[at],ba=assignments[bt];return(Number(aa?.order)||1)-(Number(ba?.order)||1)||at.localeCompare(bt)}).map(entry=>timeBlockV2ItemMarkup(entry,k,templates,assignments[timeBlockV2EntryToken(entry,k)])).join("")
}
function timeBlockV2BlockContents(block,timed,manual,k,templates,assignments){
  const sorted=[...timed].sort((a,b)=>Number(a.time)-Number(b.time)||String(a.item.createdAt||a.item.id).localeCompare(String(b.item.createdAt||b.item.id))),anchors=new Set(sorted.map(entry=>timeBlockV2EntryToken(entry,k)));
  const normalizedManual=manual.map(entry=>{const token=timeBlockV2EntryToken(entry,k),assignment=assignments[token];if(assignment&&assignment.afterAnchor!==TIME_BLOCK_START_ANCHOR&&!anchors.has(assignment.afterAnchor))return{...entry,_timeBlockFallback:true};return entry});
  const manualFor=(anchor)=>normalizedManual.filter(entry=>{const token=timeBlockV2EntryToken(entry,k),assignment=assignments[token];const resolved=entry._timeBlockFallback?TIME_BLOCK_START_ANCHOR:(assignment?.afterAnchor||TIME_BLOCK_START_ANCHOR);return resolved===anchor}).sort((a,b)=>{const at=timeBlockV2EntryToken(a,k),bt=timeBlockV2EntryToken(b,k),aa=assignments[at],ba=assignments[bt];return(Number(aa?.order)||1)-(Number(ba?.order)||1)||at.localeCompare(bt)}).map(entry=>timeBlockV2ItemMarkup(entry,k,templates,assignments[timeBlockV2EntryToken(entry,k)])).join("");
  let html="",index=0;
  if(sorted.length&&Number(sorted[0].time)===Number(block.startMinute)){
    const leading=[];while(index<sorted.length&&Number(sorted[index].time)===Number(block.startMinute)){leading.push(sorted[index]);index+=1}
    html+=leading.map(entry=>timeBlockV2ItemMarkup(entry,k,templates)).join("");
    html+=manualFor(TIME_BLOCK_START_ANCHOR);
    for(const entry of leading)html+=manualFor(timeBlockV2EntryToken(entry,k));
  }else html+=manualFor(TIME_BLOCK_START_ANCHOR);
  for(;index<sorted.length;index+=1){const entry=sorted[index],token=timeBlockV2EntryToken(entry,k);html+=timeBlockV2ItemMarkup(entry,k,templates);html+=manualFor(token)}
  return html||'<div class="uw-time-block-v2-empty">비어 있음</div>'
}
'''

if 'function timeBlockV2MinuteText' not in uw:
    anchor = 'function sessionBlockMarkup(entry,date){'
    if anchor not in uw:
        raise SystemExit('sessionBlockMarkup anchor not found')
    uw = uw.replace(anchor, helpers + anchor, 1)

new_planner = r'''function plannerListDay(d){
  const k=key(d),templates=timeBlockTemplatesForDate(state,k),assignments=timeBlockAssignmentsForDate(state,k),entries=itemsForDay(k),head=homeDays>1?`<div class="uw-day-head"><strong>${dayLabel(d)}</strong></div>`:"",blockMap=new Map(templates.map(template=>[template.id,{template,timed:[],manual:[]}])) ,unassigned=[];
  for(const entry of entries){
    const token=timeBlockV2EntryToken(entry,k);
    if(entry.timed){const template=timeBlockV2TemplateForMinute(templates,entry.time);if(template)blockMap.get(template.id)?.timed.push(entry);else unassigned.push(entry);continue}
    const assignment=assignments[token],target=assignment&&timeBlockV2Assignable(entry)?blockMap.get(assignment.blockId):null;
    if(target)target.manual.push(entry);else unassigned.push(entry)
  }
  const unassignedSorted=[...unassigned].sort((a,b)=>Number(b.timed)-Number(a.timed)||(a.timed&&b.timed?Number(a.time)-Number(b.time):0)||String(a.item.title||"").localeCompare(String(b.item.title||""),"ko"));
  const unassignedMarkup=unassignedSorted.map(entry=>{const token=timeBlockV2EntryToken(entry,k),assignment=assignments[token];return timeBlockV2ItemMarkup(entry,k,templates,assignment&&blockMap.has(assignment.blockId)?assignment:null)}).join("")||'<div class="uw-time-block-v2-empty">아직 배치하지 않은 항목이 없어요.</div>';
  const sections=templates.map(template=>{const bucket=blockMap.get(template.id);return`<section class="uw-time-block-v2-section" data-time-block-id="${esc(template.id)}"><div class="uw-time-block-v2-head"><strong>${timeBlockV2MinuteText(template.startMinute)}–${timeBlockV2MinuteText(template.endMinute)}</strong>${template.title?`<span>${esc(template.title)}</span>`:""}</div><div class="uw-list uw-time-block-v2-list">${timeBlockV2BlockContents(template,bucket?.timed||[],bucket?.manual||[],k,templates,assignments)}</div></section>`}).join("");
  return`<section class="uw-day uw-list-day uw-time-block-v2-day${k===todayKey()?" uw-today":""}" data-date="${k}">${head}<section class="uw-time-block-v2-section unassigned"><div class="uw-time-block-v2-head"><strong>타임블럭 없음</strong></div><div class="uw-list uw-time-block-v2-list" data-uw-add-kind="task" data-date="${k}" data-task-drop-date="${k}">${unassignedMarkup}</div></section>${sections}</section>`
}'''

pattern = re.compile(r'function plannerListDay\(d\)\{.*?\nfunction plannerDay\(', re.S)
match = pattern.search(uw)
if not match:
    raise SystemExit('plannerListDay block not found')
uw = uw[:match.start()] + new_planner + '\nfunction plannerDay(' + uw[match.end():]

click_anchor = 'document.addEventListener("click",async e=>{if(Date.now()<suppressItemClickUntil){e.preventDefault();e.stopImmediatePropagation();return}'
if click_anchor in uw and 'data-uw-time-block-picker]"))return' not in uw:
    uw = uw.replace(click_anchor, click_anchor + 'if(e.target.closest("[data-uw-time-block-picker]"))return;', 1)

if 'const blockPicker=e.target.closest("[data-uw-time-block-picker]")' not in uw:
    anchor = 'document.addEventListener("contextmenu",e=>{'
    change_handler = '''document.addEventListener("change",async e=>{const blockPicker=e.target.closest("[data-uw-time-block-picker]");if(!blockPicker)return;const date=blockPicker.dataset.date,token=blockPicker.dataset.token,blockId=blockPicker.value;blockPicker.disabled=true;try{await write(s=>{ensureTimeBlockV2State(s);if(blockId)assignTimeBlockOccurrence(s,date,token,blockId,TIME_BLOCK_START_ANCHOR);else clearTimeBlockAssignment(s,date,token)})}finally{blockPicker.disabled=false}});'''
    if anchor not in uw:
        raise SystemExit('contextmenu anchor not found')
    uw = uw.replace(anchor, change_handler + anchor, 1)

uw_path.write_text(uw, encoding='utf-8')

css_path = Path('css/unified-workspace.css')
css = css_path.read_text(encoding='utf-8')
if '/* Time block V2 list */' not in css:
    css += '''\n\n/* Time block V2 list */\n.uw-time-block-v2-day{display:flex;flex-direction:column;gap:10px;padding:2px 0 10px}\n.uw-time-block-v2-section{border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--panel)}\n.uw-time-block-v2-section.unassigned{border-style:dashed}\n.uw-time-block-v2-head{display:flex;align-items:baseline;gap:8px;padding:8px 10px;border-bottom:1px solid var(--line);background:var(--panel-soft)}\n.uw-time-block-v2-head strong{font-size:12px}\n.uw-time-block-v2-head span{font-size:11px;color:var(--muted)}\n.uw-time-block-v2-list{padding:4px 6px;min-height:38px}\n.uw-time-block-v2-list .uw-time-block-v2-item{min-height:34px}\n.uw-time-block-v2-item .uw-item-time{margin-left:auto;white-space:nowrap;font-variant-numeric:tabular-nums}\n.uw-time-block-v2-item .uw-time-block-picker{margin-left:auto;max-width:180px;min-width:118px;height:28px;padding:2px 24px 2px 7px;border:1px solid var(--line);border-radius:7px;background:var(--panel);color:var(--text);font:inherit;font-size:11px}\n.uw-time-block-v2-empty{padding:8px 9px;color:var(--muted);font-size:12px}\n@media(max-width:620px){.uw-time-block-v2-item .uw-time-block-picker{max-width:142px;min-width:104px}.uw-time-block-v2-head{padding:7px 8px}.uw-time-block-v2-list{padding:3px 4px}}\n'''
css_path.write_text(css, encoding='utf-8')

index_path = Path('index.html')
index = index_path.read_text(encoding='utf-8')
replacements = {
    './css/unified-workspace.css?v=31': './css/unified-workspace.css?v=32',
    './js/time-block-v2-settings.js?v=2': './js/time-block-v2-settings.js?v=3',
    './js/unified-workspace.js?v=36': './js/unified-workspace.js?v=37',
}
for old, new in replacements.items():
    if old not in index:
        raise SystemExit(f'index cache anchor not found: {old}')
    index = index.replace(old, new, 1)
index_path.write_text(index, encoding='utf-8')
