from pathlib import Path


def splice_function(lines, start_marker, end_marker, replacement):
    start = next((i for i, line in enumerate(lines) if line.startswith(start_marker)), None)
    if start is None:
        raise SystemExit(f"Missing start marker: {start_marker}")
    end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith(end_marker)), None)
    if end is None:
        raise SystemExit(f"Missing end marker: {end_marker}")
    return lines[:start] + replacement.strip("\n").splitlines() + lines[end:]


path = Path("js/unified-workspace.js")
text = path.read_text(encoding="utf-8")

old_import = '''  assignTimeBlockOccurrence,\n  clearTimeBlockAssignment,\n  clearTimeBlockAssignmentsForBlock,\n  effectiveTimeBlockTemplatesForDate,'''
new_import = '''  assignTimeBlockOccurrence,\n  clearTimeBlockAssignment,\n  clearTimeBlockAssignmentsForBlock,\n  clearTimeBlockDateOverride,\n  effectiveTimeBlockTemplatesForDate,'''
if old_import not in text:
    raise SystemExit("Missing V2 clear import anchor")
text = text.replace(old_import, new_import, 1)

old_import_2 = '''  hiddenTimeBlockTemplatesForDate,\n  setTimeBlockDateOverride,\n  timeBlockAssignmentsForDate,'''
new_import_2 = '''  hiddenTimeBlockTemplatesForDate,\n  setTimeBlockDateOverride,\n  setTimeBlockTemplatesForDate,\n  timeBlockAssignmentsForDate,'''
if old_import_2 not in text:
    raise SystemExit("Missing V2 template import anchor")
text = text.replace(old_import_2, new_import_2, 1)

lines = text.splitlines()
replacement = r'''
function openTimeBlockDayDialog(date,block=null,mode="day"){
  const dialog=$("#uwTimeBlockDayDialog"),form=$("#uwTimeBlockDayForm");if(!dialog||!form)return;
  const overrides=timeBlockDateOverridesForDate(state,date),override=block?overrides[block.id]:null,isBase=mode==="base";
  form.dataset.date=date;form.dataset.blockId=block?.id||"";form.dataset.created=String(Boolean(override?.created));form.dataset.mode=mode;
  $("#uwTimeBlockDayDialogTitle").textContent=block?(isBase?"기본 타임블럭 수정":"이 날만 타임블럭 수정"):"이 날만 타임블럭 추가";
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
    event.preventDefault();const date=form.dataset.date,existingId=form.dataset.blockId||"",mode=form.dataset.mode||"day",title=$("#uwTimeBlockDayTitle").value.trim(),startMinute=timeBlockV2MinuteFromInput($("#uwTimeBlockDayStart").value),endMinute=timeBlockV2MinuteFromInput($("#uwTimeBlockDayEnd").value),error=$("#uwTimeBlockDayError");
    if(startMinute===null||endMinute===null||endMinute<=startMinute){error.textContent="종료 시간은 시작 시간보다 뒤여야 해요.";return}
    const id=existingId||`day-${date}-${uid()}`,created=existingId?form.dataset.created==="true":true,current=mode==="base"?timeBlockTemplatesForDate(state,date):effectiveTimeBlockTemplatesForDate(state,date),candidate=[...current.filter(item=>item.id!==id),{id,title,startMinute,endMinute}],validation=validateTimeBlockTemplates(candidate);
    if(!validation.ok){error.textContent=validation.message;return}
    const submit=$("#uwTimeBlockDaySave");submit.disabled=true;
    try{await write(next=>{if(mode==="base"){setTimeBlockTemplatesForDate(next,validation.templates,date);clearTimeBlockDateOverride(next,date,id);return}setTimeBlockDateOverride(next,date,id,{title,startMinute,endMinute,created,hidden:false})});dialog.close()}catch(err){console.error(mode==="base"?"기본 타임블럭 저장 실패":"이 날 타임블럭 저장 실패",err);error.textContent="저장하지 못했어요. 다시 시도해 주세요."}finally{submit.disabled=false}
  })
}
'''
lines = splice_function(lines, "function openTimeBlockDayDialog", "function sessionBlockMarkup", replacement)

for i, line in enumerate(lines):
    stripped = line.strip()
    if stripped.startswith("const sections=templates.map(template=>"):
        indent = line[:len(line)-len(line.lstrip())]
        lines[i] = indent + 'const sections=templates.map(template=>{const bucket=blockMap.get(template.id),dayOnly=Boolean(template._dateCreated);return`<section class="uw-time-block-v2-section" data-time-block-id="${esc(template.id)}"><div class="uw-time-block-v2-head"><div class="uw-time-block-v2-title"><strong>${timeBlockV2MinuteText(template.startMinute)}–${timeBlockV2MinuteText(template.endMinute)}</strong>${template.title?`<span>${esc(template.title)}</span>`:""}${dayOnly?`<span class="uw-time-block-v2-today-badge">오늘만</span>`:""}</div><button class="uw-time-block-v2-menu-button" type="button" data-uw-time-block-menu data-date="${k}" data-block-id="${esc(template.id)}" data-created="${dayOnly}" aria-label="타임블럭 메뉴">⋯</button></div><div class="uw-list uw-time-block-v2-list">${timeBlockV2BlockContents(template,bucket?.timed||[],bucket?.manual||[],k,templates,assignments)}</div></section>`}).join("");'
        break
else:
    raise SystemExit("Missing planner block sections line")

for i, line in enumerate(lines):
    if line.startswith("function wireClicks(){"):
        marker = 'const somedayToggle='
        pos = line.find(marker)
        if pos < 0:
            raise SystemExit("Missing someday toggle in wireClicks")
        rest = line[pos:]
        prefix = r'''function wireClicks(){installActionUI();wireHabitScopeDialog();wireTimeBlockDayDialog();document.addEventListener("click",async e=>{if(Date.now()<suppressItemClickUntil){e.preventDefault();e.stopImmediatePropagation();return}if(e.target.closest("[data-uw-time-block-picker]"))return;const timeBlockAdd=e.target.closest("[data-uw-time-block-add]"),timeBlockMenuButton=e.target.closest("[data-uw-time-block-menu]"),timeBlockAction=e.target.closest("[data-uw-time-block-action]"),timeBlockRestore=e.target.closest("[data-uw-time-block-restore]");if(timeBlockAdd){e.preventDefault();e.stopImmediatePropagation();openTimeBlockDayDialog(timeBlockAdd.dataset.date);return}if(timeBlockMenuButton){e.preventDefault();e.stopImmediatePropagation();const menu=$("#uwContext"),date=timeBlockMenuButton.dataset.date,id=timeBlockMenuButton.dataset.blockId,dayOnly=timeBlockMenuButton.dataset.created==="true";menu.dataset.timeBlockDate=date;menu.dataset.timeBlockId=id;menu.dataset.timeBlockCreated=String(dayOnly);menu.innerHTML=dayOnly?'<button data-uw-time-block-action="day-edit">수정</button><button class="danger" data-uw-time-block-action="day-delete">삭제</button><button data-uw-time-block-action="empty">비우기</button>':'<button data-uw-time-block-action="day-edit">오늘만 수정</button><button data-uw-time-block-action="base-edit">기본 블럭 수정</button><button data-uw-time-block-action="day-hide">오늘만 숨기기</button><button class="danger" data-uw-time-block-action="base-delete">기본 블럭 삭제</button><button data-uw-time-block-action="empty">비우기</button>';const rect=timeBlockMenuButton.getBoundingClientRect(),menuHeight=dayOnly?132:220;menu.style.right="auto";menu.style.bottom="auto";menu.style.left=`${Math.max(8,Math.min(innerWidth-188,rect.right-180))}px`;menu.style.top=`${Math.max(8,Math.min(innerHeight-menuHeight-8,rect.bottom+6))}px`;menu.classList.add("open");return}if(timeBlockAction){e.preventDefault();e.stopImmediatePropagation();const menu=$("#uwContext"),date=menu.dataset.timeBlockDate,id=menu.dataset.timeBlockId,actionName=timeBlockAction.dataset.uwTimeBlockAction;menu.classList.remove("open");if(!date||!id)return;if(actionName==="day-edit"){const block=effectiveTimeBlockTemplatesForDate(state,date).find(item=>item.id===id);if(block)openTimeBlockDayDialog(date,block,"day");return}if(actionName==="base-edit"){const block=timeBlockTemplatesForDate(state,date).find(item=>item.id===id);if(block)openTimeBlockDayDialog(date,block,"base");return}if(actionName==="day-hide"){const block=effectiveTimeBlockTemplatesForDate(state,date).find(item=>item.id===id),override=timeBlockDateOverridesForDate(state,date)[id];if(block)await write(next=>setTimeBlockDateOverride(next,date,id,{title:block.title,startMinute:block.startMinute,endMinute:block.endMinute,created:Boolean(override?.created),hidden:true}));return}if(actionName==="base-delete"){const block=timeBlockTemplatesForDate(state,date).find(item=>item.id===id);if(!block)return;const confirmed=await confirmAction({title:"기본 타임블럭을 삭제할까요?",message:"오늘부터 앞으로 기본 블럭에서 사라져요. 과거 날짜의 블럭과 계획 기록은 그대로 유지됩니다.",confirmLabel:"기본 블럭 삭제"});if(confirmed)await write(next=>{const remaining=timeBlockTemplatesForDate(next,date).filter(item=>item.id!==id);setTimeBlockTemplatesForDate(next,remaining,date);clearTimeBlockDateOverride(next,date,id)});return}if(actionName==="day-delete"){const confirmed=await confirmAction({title:"이 날 타임블럭을 삭제할까요?",message:"이 날짜에만 만든 블럭을 삭제해요. 직접 배치한 시간 없는 할일·습관은 ‘타임블럭 없음’으로 이동합니다.",confirmLabel:"삭제"});if(confirmed)await write(next=>{clearTimeBlockAssignmentsForBlock(next,date,id);clearTimeBlockDateOverride(next,date,id)});return}if(actionName==="empty"){const block=effectiveTimeBlockTemplatesForDate(state,date).find(item=>item.id===id);if(!block)return;const confirmed=await confirmAction({title:"이 타임블럭을 비울까요?",message:"직접 배치한 시간 없는 할일·습관만 ‘타임블럭 없음’으로 이동해요. 정확한 시간이 있는 항목은 시간에 따라 계속 자동 표시됩니다.",confirmLabel:"비우기"});if(confirmed)await write(next=>clearTimeBlockAssignmentsForBlock(next,date,id));return}}if(timeBlockRestore){e.preventDefault();e.stopImmediatePropagation();const date=timeBlockRestore.dataset.date,id=timeBlockRestore.dataset.blockId,hidden=hiddenTimeBlockTemplatesForDate(state,date).find(item=>item.id===id),override=timeBlockDateOverridesForDate(state,date)[id];if(!hidden||!override)return;const candidate=[...effectiveTimeBlockTemplatesForDate(state,date),hidden],validation=validateTimeBlockTemplates(candidate);if(!validation.ok){showToast("다른 타임블럭과 시간이 겹쳐서 복원할 수 없어요.");return}await write(next=>setTimeBlockDateOverride(next,date,id,{title:hidden.title,startMinute:hidden.startMinute,endMinute:hidden.endMinute,created:Boolean(override.created),hidden:false}));return}'''
        lines[i] = prefix + rest
        break
else:
    raise SystemExit("Missing wireClicks")

path.write_text("\n".join(lines) + "\n", encoding="utf-8")

css_path = Path("css/unified-workspace.css")
css = css_path.read_text(encoding="utf-8")
marker = "/* Time block V2 header menu */"
if marker not in css:
    css += '''\n\n/* Time block V2 header menu */\n.uw-time-block-v2-head{align-items:center;justify-content:space-between}\n.uw-time-block-v2-title{display:flex;align-items:center;gap:7px;min-width:0;flex-wrap:wrap}\n.uw-time-block-v2-today-badge{display:inline-flex;align-items:center;min-height:20px;padding:1px 7px;border:1px solid var(--line);border-radius:999px;background:var(--panel);color:var(--muted);font-size:10px;line-height:1}\n.uw-time-block-v2-menu-button{flex:none;width:30px;height:30px;border:0;border-radius:8px;background:transparent;color:var(--muted);font:inherit;font-size:18px;line-height:1;cursor:pointer}\n.uw-time-block-v2-menu-button:hover,.uw-time-block-v2-menu-button:focus-visible{background:var(--panel);color:var(--text);outline:none}\n@media(max-width:700px){.uw-time-block-v2-menu-button{width:38px;height:38px}}\n'''
css_path.write_text(css, encoding="utf-8")

index_path = Path("index.html")
index = index_path.read_text(encoding="utf-8")
if "./css/unified-workspace.css?v=33" not in index:
    raise SystemExit("Expected CSS cache version 33")
if "./js/unified-workspace.js?v=39" not in index:
    raise SystemExit("Expected unified cache version 39")
index = index.replace("./css/unified-workspace.css?v=33", "./css/unified-workspace.css?v=34", 1)
index = index.replace("./js/unified-workspace.js?v=39", "./js/unified-workspace.js?v=40", 1)
index_path.write_text(index, encoding="utf-8")
