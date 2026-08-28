from pathlib import Path

unified_path = Path("js/unified-workspace.js")
module_path = Path("js/time-block-v2.js")
css_path = Path("css/unified-workspace.css")
index_path = Path("index.html")

unified = unified_path.read_text(encoding="utf-8")
module = module_path.read_text(encoding="utf-8")
css = css_path.read_text(encoding="utf-8")
index = index_path.read_text(encoding="utf-8")

# 1) Add a precise placement helper that compacts source/target anchor buckets.
if "export function placeTimeBlockOccurrence" not in module:
    marker = "\nexport function clearTimeBlockAssignment(state, dateKey, token) {"
    if marker not in module:
        raise SystemExit("clearTimeBlockAssignment marker not found")
    helper = r'''

export function placeTimeBlockOccurrence(state, dateKey, token, blockId, afterAnchor = TIME_BLOCK_START_ANCHOR, order = Number.MAX_SAFE_INTEGER) {
  if (!state || !validDateKey(dateKey) || !token || !blockId) return false;
  ensureTimeBlockV2State(state);
  state.timeBlockAssignments[dateKey] ||= {};
  const map = state.timeBlockAssignments[dateKey];
  const before = JSON.stringify(map);
  const targetBlockId = String(blockId);
  const targetAnchor = String(afterAnchor || TIME_BLOCK_START_ANCHOR);
  const previous = cleanAssignment(map[token]);

  const bucketTokens = (wantedBlockId, wantedAnchor, excludeToken = "") => Object.entries(map)
    .map(([otherToken, value]) => [otherToken, cleanAssignment(value)])
    .filter(([otherToken, value]) => otherToken !== excludeToken && value && value.blockId === String(wantedBlockId) && value.afterAnchor === String(wantedAnchor || TIME_BLOCK_START_ANCHOR))
    .sort((a, b) => a[1].order - b[1].order || String(a[0]).localeCompare(String(b[0])))
    .map(([otherToken]) => otherToken);

  const writeBucket = (tokens, wantedBlockId, wantedAnchor) => {
    tokens.forEach((otherToken, index) => {
      map[otherToken] = {
        blockId: String(wantedBlockId),
        afterAnchor: String(wantedAnchor || TIME_BLOCK_START_ANCHOR),
        order: index + 1,
      };
    });
  };

  delete map[token];
  if (previous) {
    writeBucket(bucketTokens(previous.blockId, previous.afterAnchor), previous.blockId, previous.afterAnchor);
  }

  const targetTokens = bucketTokens(targetBlockId, targetAnchor, token);
  const requested = Number.isFinite(Number(order)) ? Math.floor(Number(order)) : targetTokens.length + 1;
  const insertAt = Math.max(0, Math.min(targetTokens.length, requested - 1));
  targetTokens.splice(insertAt, 0, token);
  writeBucket(targetTokens, targetBlockId, targetAnchor);
  return before !== JSON.stringify(map);
}
'''
    module = module.replace(marker, helper + marker, 1)

# 2) Import precise placement helper and bump the module cache.
if "  placeTimeBlockOccurrence,\n" not in unified:
    unified = unified.replace("  assignTimeBlockOccurrence,\n", "  assignTimeBlockOccurrence,\n  placeTimeBlockOccurrence,\n", 1)
unified = unified.replace('./time-block-v2.js?v=3', './time-block-v2.js?v=4', 1)

# 3) Remove the picker UI and give untimed tasks/habits a dedicated planning drag handle.
start = unified.find("function timeBlockV2PickerMarkup(")
end = unified.find("function timeBlockV2ManualGroup(", start)
if start < 0 or end < 0:
    raise SystemExit("time block picker/item markup boundaries not found")
new_item_markup = r'''function timeBlockV2ItemMarkup(entry,k,templates,assignment=null){
  const kind=entry.kind,item=entry.item,done=itemDoneOn(kind,item,k),repeat=recurrenceLabel(item),occurrence=(kind==="task"||kind==="event")&&item._occurrenceSource?` data-occurrence-source="${item._occurrenceSource}"`:"",time=entry.timed?timeBlockV2MinuteText(entry.time):"",token=timeBlockV2EntryToken(entry,k),assignable=timeBlockV2Assignable(entry),planningClass=entry.timed?" fixed-anchor":assignable?" plan-draggable":"",planningAttrs=entry.timed?` data-time-block-anchor="${esc(token)}"`:assignable?` data-time-block-token="${esc(token)}"${assignment?` data-time-block-block-id="${esc(assignment.blockId)}" data-time-block-after-anchor="${esc(assignment.afterAnchor||TIME_BLOCK_START_ANCHOR)}" data-time-block-order="${Math.max(1,Number(assignment.order)||1)}"`:""}`:"",dragHandle=assignable?`<button class="uw-time-block-drag-handle" data-uw-time-block-drag data-token="${esc(token)}" type="button" aria-label="타임블럭 안에서 순서 이동" title="끌어서 순서 이동">⠿</button>`:"";
  return`<div class="uw-item uw-${kind} uw-time-block-v2-item${entry.timed?" timed":" untimed"}${planningClass}${done?" done":""}" style="${groupStyle(item)}" data-uw-kind="${kind}" data-id="${item.id}" data-date="${k}"${occurrence}${planningAttrs} draggable="false">${dragHandle}${checkMarkup(kind,item,k)}<span class="uw-item-title">${esc(item.title)}</span>${repeat?`<span class="uw-repeat-badge">↻ ${repeat}</span>`:""}${time?`<span class="uw-item-time">${time}</span>`:""}<button class="uw-select-circle" type="button" aria-label="선택"></button></div>`
}
'''
unified = unified[:start] + new_item_markup + unified[end:]

# 4) Make fallback anchors visible as block-start in DOM metadata too.
block_start = unified.find("function timeBlockV2BlockContents(")
block_end = unified.find("function openTimeBlockDayDialog(", block_start)
if block_start < 0 or block_end < 0:
    raise SystemExit("timeBlockV2BlockContents boundaries not found")
new_block_contents = r'''function timeBlockV2BlockContents(block,timed,manual,k,templates,assignments){
  const sorted=[...timed].sort((a,b)=>Number(a.time)-Number(b.time)||String(a.item.createdAt||a.item.id).localeCompare(String(b.item.createdAt||b.item.id))),anchors=new Set(sorted.map(entry=>timeBlockV2EntryToken(entry,k)));
  const normalizedManual=manual.map(entry=>{const token=timeBlockV2EntryToken(entry,k),assignment=assignments[token];if(assignment&&assignment.afterAnchor!==TIME_BLOCK_START_ANCHOR&&!anchors.has(assignment.afterAnchor))return{...entry,_timeBlockFallback:true};return entry});
  const manualFor=(anchor)=>normalizedManual.filter(entry=>{const token=timeBlockV2EntryToken(entry,k),assignment=assignments[token];const resolved=entry._timeBlockFallback?TIME_BLOCK_START_ANCHOR:(assignment?.afterAnchor||TIME_BLOCK_START_ANCHOR);return resolved===anchor}).sort((a,b)=>{const at=timeBlockV2EntryToken(a,k),bt=timeBlockV2EntryToken(b,k),aa=assignments[at],ba=assignments[bt];return(Number(aa?.order)||1)-(Number(ba?.order)||1)||at.localeCompare(bt)}).map(entry=>{const token=timeBlockV2EntryToken(entry,k),raw=assignments[token],resolvedAnchor=entry._timeBlockFallback?TIME_BLOCK_START_ANCHOR:(raw?.afterAnchor||TIME_BLOCK_START_ANCHOR),viewAssignment=raw?{...raw,afterAnchor:resolvedAnchor}:raw;return timeBlockV2ItemMarkup(entry,k,templates,viewAssignment)}).join("");
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
unified = unified[:block_start] + new_block_contents + unified[block_end:]

# 5) Mark real blocks and all-day as planner drop zones.
old_sections = 'const sections=templates.map(template=>{const bucket=blockMap.get(template.id),dayOnly=Boolean(template._dateCreated);return`<section class="uw-time-block-v2-section" data-time-block-id="${esc(template.id)}"><div class="uw-time-block-v2-head"><div class="uw-time-block-v2-title"><strong>${timeBlockV2MinuteText(template.startMinute)}–${timeBlockV2MinuteText(template.endMinute)}</strong>${template.title?`<span>${esc(template.title)}</span>`:""}${dayOnly?`<span class="uw-time-block-v2-today-badge">오늘만</span>`:""}</div><button class="uw-time-block-v2-menu-button" type="button" data-uw-time-block-menu data-date="${k}" data-block-id="${esc(template.id)}" data-created="${dayOnly}" aria-label="타임블럭 메뉴">⋯</button></div><div class="uw-list uw-time-block-v2-list">${timeBlockV2BlockContents(template,bucket?.timed||[],bucket?.manual||[],k,templates,assignments)}</div></section>`}).join("");'
new_sections = 'const sections=templates.map(template=>{const bucket=blockMap.get(template.id),dayOnly=Boolean(template._dateCreated);return`<section class="uw-time-block-v2-section" data-time-block-id="${esc(template.id)}"><div class="uw-time-block-v2-head"><div class="uw-time-block-v2-title"><strong>${timeBlockV2MinuteText(template.startMinute)}–${timeBlockV2MinuteText(template.endMinute)}</strong>${template.title?`<span>${esc(template.title)}</span>`:""}${dayOnly?`<span class="uw-time-block-v2-today-badge">오늘만</span>`:""}</div><button class="uw-time-block-v2-menu-button" type="button" data-uw-time-block-menu data-date="${k}" data-block-id="${esc(template.id)}" data-created="${dayOnly}" aria-label="타임블럭 메뉴">⋯</button></div><div class="uw-list uw-time-block-v2-list" data-uw-time-block-drop-list data-date="${k}" data-time-block-id="${esc(template.id)}">${timeBlockV2BlockContents(template,bucket?.timed||[],bucket?.manual||[],k,templates,assignments)}</div></section>`}).join("");'
if old_sections not in unified:
    raise SystemExit("planner block sections string not found")
unified = unified.replace(old_sections, new_sections, 1)
unified = unified.replace('data-task-drop-date="${k}">${allDayMarkup}', 'data-task-drop-date="${k}" data-uw-time-block-unassigned>${allDayMarkup}', 1)

# 6) Dedicated handle should never trigger edit/selection clicks.
unified = unified.replace('if(e.target.closest("[data-uw-time-block-picker]"))return;', 'if(e.target.closest("[data-uw-time-block-drag]")){e.preventDefault();e.stopImmediatePropagation();return}', 1)

# Remove the old select change listener entirely.
old_change_prefix = 'document.addEventListener("change",async e=>{const blockPicker=e.target.closest("[data-uw-time-block-picker]");if(!blockPicker)return;const date=blockPicker.dataset.date,token=blockPicker.dataset.token,blockId=blockPicker.value;blockPicker.disabled=true;try{await write(s=>{ensureTimeBlockV2State(s);if(blockId)assignTimeBlockOccurrence(s,date,token,blockId,TIME_BLOCK_START_ANCHOR);else clearTimeBlockAssignment(s,date,token)})}finally{blockPicker.disabled=false}});'
if old_change_prefix not in unified:
    raise SystemExit("old picker change listener not found")
unified = unified.replace(old_change_prefix, '', 1)

# 7) Replace the active pointer gesture system with planner-specific drag/drop semantics.
controls_start = unified.find("function wireControlsV2(){")
controls_end = unified.find("function wireHabitForm(){", controls_start)
if controls_start < 0 or controls_end < 0:
    raise SystemExit("wireControlsV2 boundaries not found")
new_controls = r'''function wireControlsV2(){
  let gesture=null;
  const clearDropIndicators=()=>{$$(".uw-range-selected,.uw-drop-target,.uw-time-block-drop-before,.uw-time-block-drop-after,.uw-time-block-drop-bottom").forEach(x=>x.classList.remove("uw-range-selected","uw-drop-target","uw-time-block-drop-before","uw-time-block-drop-after","uw-time-block-drop-bottom"))};
  const clear=(g,restore=true)=>{
    clearTimeout(g?.timer);
    g?.preview?.remove();
    g?.ghost?.remove();
    g?.item?.classList.remove("uw-drag-ready","resizing","uw-dragging");
    clearDropIndicators();
    if(restore&&g?.item&&g.originalTop!==undefined){
      g.item.style.top=g.originalTop;
      g.item.style.height=g.originalHeight;
    }
    if(gesture===g)gesture=null;
  };
  const activate=g=>{
    if(!g||g.cancelled||gesture!==g)return;
    g.active=true;
    g.item?.classList.add("uw-drag-ready");
    g.source.setPointerCapture?.(g.pointerId);
    if(navigator.vibrate)navigator.vibrate(18);
    if(g.mode==="time-create"){
      g.preview=document.createElement("div");
      g.preview.className="uw-drag-selection";
      g.lane.appendChild(g.preview);
    }
    if(g.mode==="move"||g.mode==="time-block-plan"){
      window.getSelection?.()?.removeAllRanges();
      g.item.classList.add("uw-dragging");
      g.ghost=g.item.cloneNode(true);
      g.ghost.className="uw-drag-ghost";
      g.ghost.style.left=`${g.x}px`;
      g.ghost.style.top=`${g.y}px`;
      document.body.appendChild(g.ghost);
    }
  };
  const updateDateRange=(g,date)=>{
    const first=date<g.startDate?date:g.startDate;
    const last=date<g.startDate?g.startDate:date;
    g.nextDate=date;
    $$(".uw-month-cell").forEach(cell=>cell.classList.toggle("uw-range-selected",cell.dataset.date>=first&&cell.dataset.date<=last));
  };
  const plannerDropAt=(g,pointed,clientY)=>{
    const unassignedSection=pointed?.closest(".uw-time-block-v2-section.unassigned");
    if(unassignedSection){
      const list=unassignedSection.querySelector("[data-uw-time-block-unassigned]"),date=list?.dataset.date||unassignedSection.closest(".uw-time-block-v2-day")?.dataset.date;
      if(!list||date!==g.date)return null;
      list.classList.add("uw-drop-target");
      return{dropType:"time-block-unassigned",date}
    }
    const blockSection=pointed?.closest(".uw-time-block-v2-section[data-time-block-id]");
    const list=pointed?.closest("[data-uw-time-block-drop-list]")||blockSection?.querySelector("[data-uw-time-block-drop-list]");
    if(!list)return null;
    const date=list.dataset.date||blockSection?.closest(".uw-time-block-v2-day")?.dataset.date,blockId=list.dataset.timeBlockId||blockSection?.dataset.timeBlockId;
    if(!date||date!==g.date||!blockId)return null;
    const rows=[...list.querySelectorAll(".uw-time-block-v2-item")],row=pointed?.closest(".uw-time-block-v2-item");
    const bucketRows=anchor=>rows.filter(candidate=>candidate.dataset.timeBlockToken&&candidate.dataset.timeBlockToken!==g.token&&(candidate.dataset.timeBlockAfterAnchor||TIME_BLOCK_START_ANCHOR)===anchor);
    if(row&&list.contains(row)){
      const rect=row.getBoundingClientRect(),before=clientY<rect.top+rect.height/2;
      if(row.dataset.timeBlockAnchor){
        if(before){
          const rowIndex=rows.indexOf(row),previousAnchor=[...rows.slice(0,rowIndex)].reverse().find(candidate=>candidate.dataset.timeBlockAnchor)?.dataset.timeBlockAnchor||TIME_BLOCK_START_ANCHOR,order=bucketRows(previousAnchor).length+1;
          row.classList.add("uw-time-block-drop-before");
          return{dropType:"time-block",date,blockId,afterAnchor:previousAnchor,order}
        }
        const afterAnchor=row.dataset.timeBlockAnchor;
        row.classList.add("uw-time-block-drop-after");
        return{dropType:"time-block",date,blockId,afterAnchor,order:1}
      }
      if(row.dataset.timeBlockToken){
        const afterAnchor=row.dataset.timeBlockAfterAnchor||TIME_BLOCK_START_ANCHOR;
        if(row.dataset.timeBlockToken===g.token){
          row.classList.add(before?"uw-time-block-drop-before":"uw-time-block-drop-after");
          return{dropType:"time-block",date,blockId,afterAnchor:g.currentAfterAnchor||afterAnchor,order:g.currentOrder||1}
        }
        const peers=bucketRows(afterAnchor),peerIndex=peers.indexOf(row),order=Math.max(1,(peerIndex<0?peers.length:peerIndex)+(before?1:2));
        row.classList.add(before?"uw-time-block-drop-before":"uw-time-block-drop-after");
        return{dropType:"time-block",date,blockId,afterAnchor,order}
      }
    }
    const afterAnchor=[...rows].reverse().find(candidate=>candidate.dataset.timeBlockAnchor)?.dataset.timeBlockAnchor||TIME_BLOCK_START_ANCHOR,order=bucketRows(afterAnchor).length+1;
    list.classList.add("uw-time-block-drop-bottom");
    return{dropType:"time-block",date,blockId,afterAnchor,order}
  };

  document.addEventListener("pointerdown",e=>{
    if(!e.isPrimary||e.button>0)return;
    const resizeHandle=e.target.closest("[data-uw-resize]");
    const planHandle=e.target.closest("[data-uw-time-block-drag]");
    const moveHandle=e.target.closest(".uw-move-handle");
    const item=(resizeHandle||planHandle||moveHandle)?.closest(".uw-item")||e.target.closest(".uw-item");
    let mode=null,source=null;
    if(resizeHandle){mode="resize";source=resizeHandle}
    else if(planHandle&&item?.classList.contains("uw-time-block-v2-item")){mode="time-block-plan";source=planHandle}
    else if(moveHandle&&item?.classList.contains("selected")){mode="move";source=moveHandle}
    else if(!coarse()&&item&&!item.classList.contains("uw-time-block-v2-item")&&e.target.closest(".uw-item-title,.uw-habit-title")){mode="move";source=e.target.closest(".uw-item-title,.uw-habit-title")}
    else if(!e.target.closest(".uw-item,.uw-inline-form")){
      const hit=e.target.closest(".uw-time-hit");
      const cell=e.target.closest(".uw-month-cell");
      if(hit){mode="time-create";source=hit}
      else if(cell){mode="date-create";source=cell}
    }
    if(!mode||!source)return;
    const g=gesture={mode,source,item,pointerId:e.pointerId,x:e.clientX,y:e.clientY,active:false,cancelled:false,coarse:e.pointerType!=="mouse"||coarse()};
    if(mode==="resize"){
      g.edge=resizeHandle.dataset.uwResize;
      g.start=+item.dataset.time;
      g.duration=+item.dataset.duration;
      g.nextStart=g.start;
      g.nextDuration=g.duration;
      g.originalTop=item.style.top;
      g.originalHeight=item.style.height;
    }else if(mode==="time-create"){
      g.lane=source.closest(".uw-time-lane");
      g.date=source.dataset.date;
      g.createKind=source.dataset.uwAddKind||"task";
      g.start=+source.dataset.time;
      g.nextStart=g.start;
      g.nextEnd=g.start+SLOT;
    }else if(mode==="date-create"){
      g.startDate=source.dataset.date;
      g.nextDate=g.startDate;
      g.createKind=source.dataset.uwAddKind||"event";
    }else if(mode==="time-block-plan"){
      g.kind=item.dataset.uwKind;
      g.id=item.dataset.id;
      g.date=item.dataset.date;
      g.token=source.dataset.token||item.dataset.timeBlockToken||"";
      g.currentBlockId=item.dataset.timeBlockBlockId||"";
      g.currentAfterAnchor=item.dataset.timeBlockAfterAnchor||TIME_BLOCK_START_ANCHOR;
      g.currentOrder=Math.max(1,+item.dataset.timeBlockOrder||1);
      g.dropType=null;
      g.validTarget=false;
    }else{
      g.kind=item.dataset.uwKind;
      g.id=item.dataset.id;
      g.date=item.dataset.date;
      g.occurrenceSource=item.dataset.occurrenceSource||g.date;
      g.start=Number.isFinite(+item.dataset.time)?+item.dataset.time:null;
      g.duration=+item.dataset.duration||SLOT;
      g.nextDate=g.date;
      g.nextStart=g.start;
      g.dropType=null;
    }
    if(g.coarse&&mode!=="time-block-plan")g.timer=setTimeout(()=>activate(g),450);
  },true);

  document.addEventListener("pointermove",e=>{
    const g=gesture;
    if(!g||e.pointerId!==g.pointerId)return;
    const distance=Math.hypot(e.clientX-g.x,e.clientY-g.y);
    if(!g.active){
      if(g.mode==="time-block-plan"){
        if(distance>=3)activate(g);
        if(!g.active)return
      }else{
        if(g.coarse&&distance>10){g.cancelled=true;clear(g);return}
        if(!g.coarse&&distance>=6)activate(g);
        if(!g.active)return
      }
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    if(g.mode==="resize"){
      const delta=Math.round((e.clientY-g.y)/SLOT_H)*SLOT;
      if(g.edge==="top"){
        g.nextStart=Math.max(START,Math.min(g.start+delta,g.start+g.duration-SLOT));
        g.nextDuration=g.duration-(g.nextStart-g.start);
      }else{
        g.nextDuration=Math.max(SLOT,Math.min(g.duration+delta,END-g.start));
        g.nextStart=g.start;
      }
      g.item.classList.add("resizing");
      g.item.style.top=`${((g.nextStart-START)/SLOT)*SLOT_H+1}px`;
      g.item.style.height=`${Math.max(18,(g.nextDuration/SLOT)*SLOT_H-2)}px`;
      return;
    }
    if(g.mode==="time-create"){
      const current=minuteAt(g.lane,e.clientY);
      const first=Math.min(g.start,current),last=Math.max(g.start,current)+SLOT;
      g.nextStart=first;
      g.nextEnd=last;
      g.preview.style.top=`${((first-START)/SLOT)*SLOT_H}px`;
      g.preview.style.height=`${((last-first)/SLOT)*SLOT_H}px`;
      return;
    }
    if(g.mode==="date-create"){
      const cell=document.elementFromPoint(e.clientX,e.clientY)?.closest(".uw-month-cell");
      if(cell)updateDateRange(g,cell.dataset.date);
      return;
    }
    if(g.mode==="time-block-plan"){
      clearDropIndicators();
      const pointed=document.elementFromPoint(e.clientX,e.clientY),target=plannerDropAt(g,pointed,e.clientY);
      g.validTarget=Boolean(target);
      g.dropType=target?.dropType||null;
      g.nextDate=target?.date||g.date;
      g.nextBlockId=target?.blockId||null;
      g.nextAfterAnchor=target?.afterAnchor||TIME_BLOCK_START_ANCHOR;
      g.nextOrder=target?.order||1;
      if(g.ghost){g.ghost.style.left=`${e.clientX}px`;g.ghost.style.top=`${e.clientY}px`}
      if(e.clientY<70)window.scrollBy(0,-12);
      else if(e.clientY>innerHeight-70)window.scrollBy(0,12);
      return;
    }
    $$(".uw-drop-target").forEach(x=>x.classList.remove("uw-drop-target"));
    const pointed=document.elementFromPoint(e.clientX,e.clientY);
    const lane=pointed?.closest(".uw-time-lane");
    const someday=pointed?.closest("[data-uw-someday-drop]");
    const allDay=pointed?.closest("[data-uw-all-day-drop]");
    const dateList=pointed?.closest("[data-task-drop-date],.uw-month-cell,.uw-list[data-date]");
    let drop=null;
    g.validTarget=false;
    g.dropType=null;
    if(lane){
      g.nextDate=lane.closest(".uw-day")?.dataset.date||g.date;
      g.nextStart=minuteAt(lane,e.clientY);
      g.dropType="time";
      drop=lane.querySelector(`.uw-time-hit[data-time="${g.nextStart}"]`);
    }else if(someday&&g.kind==="task"){
      g.nextDate="";
      g.nextStart=null;
      g.dropType="someday";
      drop=someday;
    }else if(allDay){
      g.nextDate=allDay.dataset.date||g.date;
      g.nextStart=null;
      g.dropType="all-day";
      drop=allDay;
    }else if(dateList&&g.kind!=="habit"){
      g.nextDate=dateList.dataset.date||dateList.dataset.taskDropDate||g.date;
      g.nextStart=null;
      g.dropType="date";
      drop=dateList;
    }
    if(drop){drop.classList.add("uw-drop-target");g.validTarget=true}
    if(g.ghost){g.ghost.style.left=`${e.clientX}px`;g.ghost.style.top=`${e.clientY}px`}
    if(e.clientY<70)window.scrollBy(0,-12);
    else if(e.clientY>innerHeight-70)window.scrollBy(0,12);
  },{passive:false,capture:true});

  document.addEventListener("pointerup",async e=>{
    const g=gesture;
    if(!g||e.pointerId!==g.pointerId)return;
    if(!g.active){clear(g);return}
    suppressItemClickUntil=Date.now()+650;
    clear(g,g.mode!=="resize");
    if(g.mode==="resize"){await saveTimedChange(g.item.dataset.uwKind,g.item.dataset.id,g.item.dataset.date,g.nextStart,g.nextDuration,g.item.dataset.occurrenceSource||g.item.dataset.date);return}
    if(g.mode==="time-create"){
      const kind=g.createKind||"task";
      const host=findAddHost(kind,g.date,g.nextStart);
      openInline(host,{kind,date:g.date,time:g.nextStart,duration:g.nextEnd-g.nextStart,withTime:kind==="event"});
      return;
    }
    if(g.mode==="date-create"){
      const first=g.nextDate<g.startDate?g.nextDate:g.startDate;
      const last=g.nextDate<g.startDate?g.startDate:g.nextDate;
      openInline($(`.uw-month-cell[data-date="${first}"]`),{kind:g.createKind||"event",date:first,endDate:last});
      return;
    }
    if(g.mode==="time-block-plan"){
      if(!g.validTarget||!g.token)return;
      if(g.dropType==="time-block-unassigned")await write(next=>clearTimeBlockAssignment(next,g.date,g.token));
      else if(g.dropType==="time-block"&&g.nextBlockId)await write(next=>placeTimeBlockOccurrence(next,g.date,g.token,g.nextBlockId,g.nextAfterAnchor,g.nextOrder));
      return;
    }
    if(!g.validTarget)return;
    if(g.dropType==="time")await saveTimedChange(g.kind,g.id,g.nextDate,g.nextStart,g.duration,g.occurrenceSource);
    else if(g.dropType==="all-day"||g.dropType==="someday")await saveUntimedChange(g.kind,g.id,g.nextDate,g.occurrenceSource);
    else await saveDateOnlyChange(g.kind,g.id,g.nextDate,g.occurrenceSource);
  },{capture:true});
  document.addEventListener("pointercancel",()=>clear(gesture));
  document.addEventListener("contextmenu",e=>{if(gesture?.active){e.preventDefault();e.stopImmediatePropagation()}},true);
}

'''
unified = unified[:controls_start] + new_controls + unified[controls_end:]

# 8) Add stage-5 visuals; keep old picker CSS inert because no picker markup exists.
stage5 = r'''

/* Time block V2 stage 5: direct planning drag */
.uw-time-block-v2-list{position:relative}
.uw-time-block-v2-item.fixed-anchor{cursor:default}
.uw-time-block-v2-item.plan-draggable{cursor:default}
.uw-time-block-drag-handle{display:inline-grid;place-items:center;width:24px;height:24px;flex:0 0 24px;padding:0;border:0;border-radius:7px;background:transparent;color:var(--muted);font:inherit;font-size:15px;line-height:1;cursor:grab;touch-action:none;user-select:none}
.uw-time-block-drag-handle:hover,.uw-time-block-drag-handle:focus-visible{background:color-mix(in srgb,var(--accent) 12%,#fff);color:var(--accent-dark);outline:none}
.uw-time-block-drag-handle:active{cursor:grabbing}
.uw-time-block-v2-item.uw-time-block-drop-before::before,.uw-time-block-v2-item.uw-time-block-drop-after::after{content:"";position:absolute;right:5px;left:5px;z-index:12;height:2px;border-radius:99px;background:var(--accent);box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 12%,transparent);pointer-events:none}
.uw-time-block-v2-item.uw-time-block-drop-before::before{top:-4px}
.uw-time-block-v2-item.uw-time-block-drop-after::after{bottom:-4px}
.uw-time-block-v2-list.uw-time-block-drop-bottom::after{content:"";display:block;height:2px;margin:3px 5px 1px;border-radius:99px;background:var(--accent);box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 12%,transparent);pointer-events:none}
.uw-time-block-v2-list[data-uw-time-block-unassigned].uw-drop-target{outline:2px solid var(--accent)!important;outline-offset:-2px;border-radius:7px;background:color-mix(in srgb,var(--accent) 7%,transparent)!important}
.uw-drag-ghost .uw-time-block-drag-handle{display:none!important}
@media(hover:none),(pointer:coarse){.uw-time-block-drag-handle{width:32px;height:32px;flex-basis:32px;font-size:18px}.uw-time-block-v2-item.plan-draggable{min-height:42px}.uw-time-block-v2-item.uw-time-block-drop-before::before{top:-5px}.uw-time-block-v2-item.uw-time-block-drop-after::after{bottom:-5px}}
'''
if "/* Time block V2 stage 5: direct planning drag */" not in css:
    css += stage5

# 9) Cache bumps.
if './css/unified-workspace.css?v=35' not in index:
    raise SystemExit("expected unified css v35")
if './js/unified-workspace.js?v=42' not in index:
    raise SystemExit("expected unified js v42")
index = index.replace('./css/unified-workspace.css?v=35', './css/unified-workspace.css?v=36', 1)
index = index.replace('./js/unified-workspace.js?v=42', './js/unified-workspace.js?v=43', 1)

unified_path.write_text(unified, encoding="utf-8")
module_path.write_text(module, encoding="utf-8")
css_path.write_text(css, encoding="utf-8")
index_path.write_text(index, encoding="utf-8")
