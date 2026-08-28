from pathlib import Path
import re

core_path = Path('js/time-block-v2.js')
core = core_path.read_text(encoding='utf-8')

if 'function cleanDateOverride(value, id)' not in core:
    anchor = '''function cleanAssignment(value) {\n  if (!value || !value.blockId) return null;\n  const order = Math.max(1, Math.floor(Number(value.order) || 1));\n  return {\n    blockId: String(value.blockId),\n    afterAnchor: String(value.afterAnchor || TIME_BLOCK_START_ANCHOR),\n    order,\n  };\n}\n'''
    addition = anchor + '''\nfunction cleanDateOverride(value, id) {\n  if (!value || !id || typeof value !== "object" || Array.isArray(value)) return null;\n  const result = {\n    id: String(id),\n    hidden: Boolean(value.hidden),\n    created: Boolean(value.created),\n  };\n  if (Object.prototype.hasOwnProperty.call(value, "title")) result.title = String(value.title || "");\n  const startMinute = Number(value.startMinute);\n  const endMinute = Number(value.endMinute);\n  if (Number.isFinite(startMinute) && Number.isFinite(endMinute) && endMinute > startMinute) {\n    result.startMinute = startMinute;\n    result.endMinute = endMinute;\n  }\n  return result;\n}\n\nfunction sortTemplates(templates) {\n  return [...templates].sort((a, b) => Number(a.startMinute) - Number(b.startMinute) || Number(a.endMinute) - Number(b.endMinute) || String(a.id).localeCompare(String(b.id)));\n}\n'''
    if anchor not in core:
        raise SystemExit('cleanAssignment anchor not found')
    core = core.replace(anchor, addition, 1)

if 'state.timeBlockOverrides = {};' not in core:
    anchor = '''  if (!state.timeBlockAssignments || typeof state.timeBlockAssignments !== "object" || Array.isArray(state.timeBlockAssignments)) {\n    state.timeBlockAssignments = {};\n    changed = true;\n  }\n'''
    addition = anchor + '''  if (!state.timeBlockOverrides || typeof state.timeBlockOverrides !== "object" || Array.isArray(state.timeBlockOverrides)) {\n    state.timeBlockOverrides = {};\n    changed = true;\n  }\n'''
    if anchor not in core:
        raise SystemExit('assignment init anchor not found')
    core = core.replace(anchor, addition, 1)

if 'export function timeBlockDateOverridesForDate' not in core:
    core += '''\n\nexport function timeBlockDateOverridesForDate(state, dateKey) {\n  if (!state || !validDateKey(dateKey)) return {};\n  ensureTimeBlockV2State(state);\n  const raw = state.timeBlockOverrides?.[dateKey];\n  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};\n  const result = {};\n  for (const [id, value] of Object.entries(raw)) {\n    const cleaned = cleanDateOverride(value, id);\n    if (cleaned) result[id] = cleaned;\n  }\n  return result;\n}\n\nexport function effectiveTimeBlockTemplatesForDate(state, dateKey) {\n  const base = timeBlockTemplatesForDate(state, dateKey);\n  const byId = new Map(base.map((template) => [String(template.id), { ...template }]));\n  const overrides = timeBlockDateOverridesForDate(state, dateKey);\n  for (const [id, override] of Object.entries(overrides)) {\n    if (override.hidden) {\n      byId.delete(id);\n      continue;\n    }\n    const current = byId.get(id);\n    if (current) {\n      const startMinute = Number.isFinite(Number(override.startMinute)) ? Number(override.startMinute) : Number(current.startMinute);\n      const endMinute = Number.isFinite(Number(override.endMinute)) ? Number(override.endMinute) : Number(current.endMinute);\n      byId.set(id, {\n        ...current,\n        title: Object.prototype.hasOwnProperty.call(override, "title") ? override.title : current.title,\n        startMinute,\n        endMinute,\n        _dateOverride: true,\n      });\n      continue;\n    }\n    if (override.created && Number.isFinite(Number(override.startMinute)) && Number.isFinite(Number(override.endMinute)) && Number(override.endMinute) > Number(override.startMinute)) {\n      byId.set(id, {\n        id,\n        title: String(override.title || ""),\n        startMinute: Number(override.startMinute),\n        endMinute: Number(override.endMinute),\n        effectiveFrom: dateKey,\n        _dateOverride: true,\n        _dateCreated: true,\n      });\n    }\n  }\n  return sortTemplates([...byId.values()]);\n}\n\nexport function hiddenTimeBlockTemplatesForDate(state, dateKey) {\n  const baseById = new Map(timeBlockTemplatesForDate(state, dateKey).map((template) => [String(template.id), template]));\n  const overrides = timeBlockDateOverridesForDate(state, dateKey);\n  const hidden = [];\n  for (const [id, override] of Object.entries(overrides)) {\n    if (!override.hidden) continue;\n    const base = baseById.get(id);\n    if (!base && !override.created) continue;\n    const startMinute = Number.isFinite(Number(override.startMinute)) ? Number(override.startMinute) : Number(base?.startMinute);\n    const endMinute = Number.isFinite(Number(override.endMinute)) ? Number(override.endMinute) : Number(base?.endMinute);\n    if (!Number.isFinite(startMinute) || !Number.isFinite(endMinute) || endMinute <= startMinute) continue;\n    hidden.push({\n      ...(base || {}),\n      id,\n      title: Object.prototype.hasOwnProperty.call(override, "title") ? override.title : String(base?.title || ""),\n      startMinute,\n      endMinute,\n      _dateOverride: true,\n      ...(override.created ? { _dateCreated: true } : {}),\n    });\n  }\n  return sortTemplates(hidden);\n}\n\nexport function setTimeBlockDateOverride(state, dateKey, blockId, value) {\n  if (!state || !validDateKey(dateKey) || !blockId || !value || typeof value !== "object") return false;\n  ensureTimeBlockV2State(state);\n  const cleaned = cleanDateOverride(value, blockId);\n  if (!cleaned) return false;\n  state.timeBlockOverrides[dateKey] ||= {};\n  const previous = cleanDateOverride(state.timeBlockOverrides[dateKey][blockId], blockId);\n  const comparable = (item) => JSON.stringify(item || null);\n  if (comparable(previous) === comparable(cleaned)) return false;\n  const stored = {\n    hidden: cleaned.hidden,\n    created: cleaned.created,\n    ...(Object.prototype.hasOwnProperty.call(cleaned, "title") ? { title: cleaned.title } : {}),\n    ...(Number.isFinite(Number(cleaned.startMinute)) ? { startMinute: Number(cleaned.startMinute) } : {}),\n    ...(Number.isFinite(Number(cleaned.endMinute)) ? { endMinute: Number(cleaned.endMinute) } : {}),\n  };\n  state.timeBlockOverrides[dateKey][String(blockId)] = stored;\n  return true;\n}\n\nexport function clearTimeBlockDateOverride(state, dateKey, blockId) {\n  if (!state || !validDateKey(dateKey) || !blockId || !state.timeBlockOverrides?.[dateKey]?.[blockId]) return false;\n  delete state.timeBlockOverrides[dateKey][blockId];\n  if (!Object.keys(state.timeBlockOverrides[dateKey]).length) delete state.timeBlockOverrides[dateKey];\n  return true;\n}\n\nexport function clearTimeBlockAssignmentsForBlock(state, dateKey, blockId) {\n  if (!state || !validDateKey(dateKey) || !blockId || !state.timeBlockAssignments?.[dateKey]) return false;\n  let changed = false;\n  for (const [token, assignment] of Object.entries(state.timeBlockAssignments[dateKey])) {\n    if (String(assignment?.blockId || "") !== String(blockId)) continue;\n    delete state.timeBlockAssignments[dateKey][token];\n    changed = true;\n  }\n  if (!Object.keys(state.timeBlockAssignments[dateKey]).length) delete state.timeBlockAssignments[dateKey];\n  return changed;\n}\n'''

core_path.write_text(core, encoding='utf-8')

settings_path = Path('js/time-block-v2-settings.js')
settings = settings_path.read_text(encoding='utf-8').replace('from "./time-block-v2.js?v=2";', 'from "./time-block-v2.js?v=3";')
settings_path.write_text(settings, encoding='utf-8')

uw_path = Path('js/unified-workspace.js')
uw = uw_path.read_text(encoding='utf-8')
uw = uw.replace('import { confirmAction } from "./ui-feedback.js";', 'import { confirmAction, showToast } from "./ui-feedback.js";')
uw = uw.replace('from "./time-block-v2.js?v=2";', 'from "./time-block-v2.js?v=3";')

old_import = '''  TIME_BLOCK_START_ANCHOR,\n  assignTimeBlockOccurrence,\n  clearTimeBlockAssignment,\n  ensureTimeBlockV2State,\n  timeBlockAssignmentsForDate,\n  timeBlockOccurrenceToken,\n  timeBlockTemplatesForDate,\n'''
new_import = '''  TIME_BLOCK_START_ANCHOR,\n  assignTimeBlockOccurrence,\n  clearTimeBlockAssignment,\n  clearTimeBlockAssignmentsForBlock,\n  effectiveTimeBlockTemplatesForDate,\n  ensureTimeBlockV2State,\n  hiddenTimeBlockTemplatesForDate,\n  setTimeBlockDateOverride,\n  timeBlockAssignmentsForDate,\n  timeBlockDateOverridesForDate,\n  timeBlockOccurrenceToken,\n  timeBlockTemplatesForDate,\n  validateTimeBlockTemplates,\n'''
if old_import in uw:
    uw = uw.replace(old_import, new_import, 1)
elif 'effectiveTimeBlockTemplatesForDate' not in uw:
    raise SystemExit('unified import list anchor not found')

if 'function timeBlockV2MinuteFromInput' not in uw:
    anchor = 'function timeBlockV2MinuteText(minute){'
    addition = '''function timeBlockV2MinuteFromInput(value){const match=/^(\\d{2}):(\\d{2})$/.exec(String(value||""));if(!match)return null;const hour=+match[1],minute=+match[2];if(hour<0||hour>23||minute<0||minute>59)return null;return hour*60+minute}\n'''
    if anchor not in uw:
        raise SystemExit('minute text anchor not found')
    uw = uw.replace(anchor, addition + anchor, 1)

if 'function openTimeBlockDayDialog' not in uw:
    anchor = 'function sessionBlockMarkup(entry,date){'
    addition = r'''function openTimeBlockDayDialog(date,block=null){
  const dialog=$("#uwTimeBlockDayDialog"),form=$("#uwTimeBlockDayForm");if(!dialog||!form)return;
  const overrides=timeBlockDateOverridesForDate(state,date),override=block?overrides[block.id]:null;
  form.dataset.date=date;form.dataset.blockId=block?.id||"";form.dataset.created=String(Boolean(override?.created));
  $("#uwTimeBlockDayDialogTitle").textContent=block?"이 날만 타임블럭 수정":"이 날만 타임블럭 추가";
  $("#uwTimeBlockDayTitle").value=block?.title||"";
  $("#uwTimeBlockDayStart").value=block?timeBlockV2MinuteText(block.startMinute):"09:00";
  $("#uwTimeBlockDayEnd").value=block?timeBlockV2MinuteText(block.endMinute):"10:00";
  $("#uwTimeBlockDayError").textContent="";
  dialog.showModal();setTimeout(()=>$("#uwTimeBlockDayTitle")?.focus(),0)
}
function wireTimeBlockDayDialog(){
  const dialog=$("#uwTimeBlockDayDialog"),form=$("#uwTimeBlockDayForm");if(!dialog||!form||dialog.dataset.uwBound)return;dialog.dataset.uwBound="1";
  $("#uwTimeBlockDayCancel")?.addEventListener("click",()=>dialog.close());
  dialog.addEventListener("cancel",()=>{$("#uwTimeBlockDayError").textContent=""});
  form.addEventListener("submit",async event=>{
    event.preventDefault();const date=form.dataset.date,existingId=form.dataset.blockId||"",title=$("#uwTimeBlockDayTitle").value.trim(),startMinute=timeBlockV2MinuteFromInput($("#uwTimeBlockDayStart").value),endMinute=timeBlockV2MinuteFromInput($("#uwTimeBlockDayEnd").value),error=$("#uwTimeBlockDayError");
    if(startMinute===null||endMinute===null||endMinute<=startMinute){error.textContent="종료 시간은 시작 시간보다 뒤여야 해요.";return}
    const id=existingId||`day-${date}-${uid()}`,created=existingId?form.dataset.created==="true":true,current=effectiveTimeBlockTemplatesForDate(state,date),candidate=[...current.filter(item=>item.id!==id),{id,title,startMinute,endMinute}],validation=validateTimeBlockTemplates(candidate);
    if(!validation.ok){error.textContent=validation.message;return}
    const submit=$("#uwTimeBlockDaySave");submit.disabled=true;
    try{await write(next=>setTimeBlockDateOverride(next,date,id,{title,startMinute,endMinute,created,hidden:false}));dialog.close()}catch(err){console.error("이 날 타임블럭 저장 실패",err);error.textContent="저장하지 못했어요. 다시 시도해 주세요."}finally{submit.disabled=false}
  })
}
'''
    if anchor not in uw:
        raise SystemExit('sessionBlockMarkup anchor not found')
    uw = uw.replace(anchor, addition + anchor, 1)

old_install = 'function installActionUI(){if($("#uwSelectionBar"))return;document.body.insertAdjacentHTML("beforeend",\'<div class="uw-selection-bar" id="uwSelectionBar">'
if old_install not in uw:
    # use a simpler targeted replacement on end of inserted dialog markup
    pass

if 'id="uwTimeBlockDayDialog"' not in uw:
    needle = '</div></dialog>\')}'
    replacement = '''</div></dialog><dialog class="app-dialog uw-time-block-day-dialog" id="uwTimeBlockDayDialog"><form id="uwTimeBlockDayForm"><h3 id="uwTimeBlockDayDialogTitle">이 날만 타임블럭 수정</h3><label><span>이름 <small>선택</small></span><input id="uwTimeBlockDayTitle" type="text" maxlength="40" autocomplete="off" placeholder="예: 집중"></label><div class="uw-time-block-day-times"><label><span>시작</span><input id="uwTimeBlockDayStart" type="time" required></label><label><span>종료</span><input id="uwTimeBlockDayEnd" type="time" required></label></div><p id="uwTimeBlockDayError" class="uw-time-block-day-error" aria-live="polite"></p><div class="dialog-actions"><button class="soft-btn" id="uwTimeBlockDayCancel" type="button">취소</button><button class="primary-btn" id="uwTimeBlockDaySave" type="submit">저장</button></div></form></dialog>\')}'''
    if needle not in uw:
        raise SystemExit('installActionUI closing anchor not found')
    uw = uw.replace(needle, replacement, 1)

old_planner = re.compile(r'function plannerListDay\(d\)\{.*?\n\}\nfunction plannerDay\(', re.S)
match = old_planner.search(uw)
if not match:
    raise SystemExit('plannerListDay not found')
new_planner = r'''function plannerListDay(d){
  const k=key(d),templates=effectiveTimeBlockTemplatesForDate(state,k),hiddenTemplates=hiddenTimeBlockTemplatesForDate(state,k),assignments=timeBlockAssignmentsForDate(state,k),entries=itemsForDay(k),head=homeDays>1?`<div class="uw-day-head"><strong>${dayLabel(d)}</strong></div>`:"",blockMap=new Map(templates.map(template=>[template.id,{template,timed:[],manual:[]}])) ,unassigned=[];
  for(const entry of entries){
    const token=timeBlockV2EntryToken(entry,k);
    if(entry.timed){const template=timeBlockV2TemplateForMinute(templates,entry.time);if(template)blockMap.get(template.id)?.timed.push(entry);else unassigned.push(entry);continue}
    const assignment=assignments[token],target=assignment&&timeBlockV2Assignable(entry)?blockMap.get(assignment.blockId):null;
    if(target)target.manual.push(entry);else unassigned.push(entry)
  }
  const unassignedSorted=[...unassigned].sort((a,b)=>Number(b.timed)-Number(a.timed)||(a.timed&&b.timed?Number(a.time)-Number(b.time):0)||String(a.item.title||"").localeCompare(String(b.item.title||""),"ko"));
  const unassignedMarkup=unassignedSorted.map(entry=>{const token=timeBlockV2EntryToken(entry,k),assignment=assignments[token];return timeBlockV2ItemMarkup(entry,k,templates,assignment&&blockMap.has(assignment.blockId)?assignment:null)}).join("")||'<div class="uw-time-block-v2-empty">아직 배치하지 않은 항목이 없어요.</div>';
  const hiddenMarkup=hiddenTemplates.length?`<div class="uw-time-block-hidden-list">${hiddenTemplates.map(template=>`<div class="uw-time-block-hidden-row"><span>숨긴 블럭 · ${timeBlockV2MinuteText(template.startMinute)}–${timeBlockV2MinuteText(template.endMinute)}${template.title?` · ${esc(template.title)}`:""}</span><button type="button" data-uw-time-block-restore data-date="${k}" data-block-id="${esc(template.id)}">복원</button></div>`).join("")}</div>`:"";
  const sections=templates.map(template=>{const bucket=blockMap.get(template.id);return`<section class="uw-time-block-v2-section" data-time-block-id="${esc(template.id)}"><div class="uw-time-block-v2-head"><div class="uw-time-block-v2-title"><strong>${timeBlockV2MinuteText(template.startMinute)}–${timeBlockV2MinuteText(template.endMinute)}</strong>${template.title?`<span>${esc(template.title)}</span>`:""}</div><div class="uw-time-block-v2-actions"><button type="button" data-uw-time-block-edit data-date="${k}" data-block-id="${esc(template.id)}">수정</button><button type="button" data-uw-time-block-hide data-date="${k}" data-block-id="${esc(template.id)}">숨김</button><button type="button" data-uw-time-block-empty data-date="${k}" data-block-id="${esc(template.id)}">비우기</button></div></div><div class="uw-list uw-time-block-v2-list">${timeBlockV2BlockContents(template,bucket?.timed||[],bucket?.manual||[],k,templates,assignments)}</div></section>`}).join("");
  return`<section class="uw-day uw-list-day uw-time-block-v2-day${k===todayKey()?" uw-today":""}" data-date="${k}">${head}<section class="uw-time-block-v2-section unassigned"><div class="uw-time-block-v2-head"><strong>타임블럭 없음</strong><button class="uw-time-block-day-add" type="button" data-uw-time-block-add data-date="${k}">＋ 이 날 블럭</button></div><div class="uw-list uw-time-block-v2-list" data-uw-add-kind="task" data-date="${k}" data-task-drop-date="${k}">${unassignedMarkup}</div>${hiddenMarkup}</section>${sections}</section>`
}
function plannerDay('''
uw = uw[:match.start()] + new_planner + uw[match.end():]

if 'const timeBlockAdd=e.target.closest("[data-uw-time-block-add]")' not in uw:
    needle = 'document.addEventListener("click",async e=>{if(Date.now()<suppressItemClickUntil){e.preventDefault();e.stopImmediatePropagation();return}if(e.target.closest("[data-uw-time-block-picker]"))return;'
    insert = '''document.addEventListener("click",async e=>{if(Date.now()<suppressItemClickUntil){e.preventDefault();e.stopImmediatePropagation();return}if(e.target.closest("[data-uw-time-block-picker]"))return;const timeBlockAdd=e.target.closest("[data-uw-time-block-add]"),timeBlockEdit=e.target.closest("[data-uw-time-block-edit]"),timeBlockHide=e.target.closest("[data-uw-time-block-hide]"),timeBlockRestore=e.target.closest("[data-uw-time-block-restore]"),timeBlockEmpty=e.target.closest("[data-uw-time-block-empty]");if(timeBlockAdd){e.preventDefault();e.stopImmediatePropagation();openTimeBlockDayDialog(timeBlockAdd.dataset.date);return}if(timeBlockEdit){e.preventDefault();e.stopImmediatePropagation();const date=timeBlockEdit.dataset.date,block=effectiveTimeBlockTemplatesForDate(state,date).find(item=>item.id===timeBlockEdit.dataset.blockId);if(block)openTimeBlockDayDialog(date,block);return}if(timeBlockHide){e.preventDefault();e.stopImmediatePropagation();const date=timeBlockHide.dataset.date,id=timeBlockHide.dataset.blockId,block=effectiveTimeBlockTemplatesForDate(state,date).find(item=>item.id===id),override=timeBlockDateOverridesForDate(state,date)[id];if(block)await write(next=>setTimeBlockDateOverride(next,date,id,{title:block.title,startMinute:block.startMinute,endMinute:block.endMinute,created:Boolean(override?.created),hidden:true}));return}if(timeBlockRestore){e.preventDefault();e.stopImmediatePropagation();const date=timeBlockRestore.dataset.date,id=timeBlockRestore.dataset.blockId,hidden=hiddenTimeBlockTemplatesForDate(state,date).find(item=>item.id===id),override=timeBlockDateOverridesForDate(state,date)[id];if(!hidden||!override)return;const candidate=[...effectiveTimeBlockTemplatesForDate(state,date),hidden],validation=validateTimeBlockTemplates(candidate);if(!validation.ok){showToast("다른 타임블럭과 시간이 겹쳐서 복원할 수 없어요.");return}await write(next=>setTimeBlockDateOverride(next,date,id,{title:hidden.title,startMinute:hidden.startMinute,endMinute:hidden.endMinute,created:Boolean(override.created),hidden:false}));return}if(timeBlockEmpty){e.preventDefault();e.stopImmediatePropagation();const date=timeBlockEmpty.dataset.date,id=timeBlockEmpty.dataset.blockId,block=effectiveTimeBlockTemplatesForDate(state,date).find(item=>item.id===id);if(!block)return;const confirmed=await confirmAction({title:"이 타임블럭을 비울까요?",message:"직접 배치한 시간 없는 할일·습관만 ‘타임블럭 없음’으로 이동해요. 정확한 시간이 있는 항목은 시간에 따라 계속 자동 표시됩니다.",confirmLabel:"비우기"});if(confirmed)await write(next=>clearTimeBlockAssignmentsForBlock(next,date,id));return}'''
    if needle not in uw:
        raise SystemExit('wireClicks start anchor not found')
    uw = uw.replace(needle, insert, 1)

uw = uw.replace('function wireClicks(){installActionUI();wireHabitScopeDialog();', 'function wireClicks(){installActionUI();wireHabitScopeDialog();wireTimeBlockDayDialog();', 1)
uw_path.write_text(uw, encoding='utf-8')

css_path = Path('css/unified-workspace.css')
css = css_path.read_text(encoding='utf-8')
marker = '/* Time block V2 stage 3 */'
if marker not in css:
    css += r'''

/* Time block V2 stage 3 */
.uw-time-block-v2-head{align-items:center;justify-content:space-between;gap:8px}
.uw-time-block-v2-title{display:flex;align-items:baseline;gap:8px;min-width:0}
.uw-time-block-v2-actions{display:flex;align-items:center;gap:4px;margin-left:auto}
.uw-time-block-v2-actions button,.uw-time-block-day-add,.uw-time-block-hidden-row button{min-height:27px;padding:3px 7px;border:1px solid var(--line);border-radius:7px;background:#fff;color:var(--muted);font:inherit;font-size:9px;cursor:pointer;white-space:nowrap}
.uw-time-block-v2-actions button:hover,.uw-time-block-day-add:hover,.uw-time-block-hidden-row button:hover{border-color:var(--accent);color:var(--accent-dark)}
.uw-time-block-day-add{margin-left:auto;color:var(--accent-dark)}
.uw-time-block-hidden-list{display:grid;gap:4px;padding:0 6px 6px}
.uw-time-block-hidden-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px;border:1px dashed var(--line);border-radius:8px;background:#fff;color:var(--muted);font-size:9px}
.uw-time-block-day-dialog{width:min(430px,calc(100vw - 28px));padding:0;border:0;border-radius:16px;background:#fff;box-shadow:0 18px 60px #0004}
.uw-time-block-day-dialog::backdrop{background:#1b25304d;backdrop-filter:blur(2px)}
.uw-time-block-day-dialog form{display:grid;gap:13px;padding:20px}
.uw-time-block-day-dialog h3{margin:0;font-size:16px}.uw-time-block-day-dialog label{display:grid;gap:5px;color:var(--muted);font-size:11px}.uw-time-block-day-dialog label>span{display:flex;align-items:center;gap:5px}.uw-time-block-day-dialog label small{font-size:9px;font-weight:400}
.uw-time-block-day-dialog input{width:100%;height:38px;padding:6px 9px;border:1px solid var(--line);border-radius:9px;background:#fff;color:var(--text);font:inherit}
.uw-time-block-day-times{display:grid;grid-template-columns:1fr 1fr;gap:8px}.uw-time-block-day-error{min-height:18px;margin:0;color:var(--danger);font-size:10px}.uw-time-block-day-dialog .dialog-actions{display:flex;justify-content:flex-end;gap:7px}
@media(max-width:600px){.uw-time-block-v2-head{align-items:flex-start}.uw-time-block-v2-actions{flex-wrap:wrap;justify-content:flex-end}.uw-time-block-v2-actions button{min-height:30px}.uw-time-block-day-add{min-height:32px}.uw-time-block-day-times{grid-template-columns:1fr}.uw-time-block-day-dialog form{padding:16px}}
'''
css_path.write_text(css, encoding='utf-8')

index_path = Path('index.html')
index = index_path.read_text(encoding='utf-8')
index = index.replace('css/unified-workspace.css?v=32', 'css/unified-workspace.css?v=33')
index = index.replace('js/time-block-v2-settings.js?v=3', 'js/time-block-v2-settings.js?v=4')
index = index.replace('js/unified-workspace.js?v=38', 'js/unified-workspace.js?v=39')
index_path.write_text(index, encoding='utf-8')
