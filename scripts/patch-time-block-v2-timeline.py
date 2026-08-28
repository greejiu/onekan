from pathlib import Path


def insert_before(text, marker, addition):
    pos = text.find(marker)
    if pos < 0:
        raise SystemExit(f"Missing marker: {marker}")
    return text[:pos] + addition.rstrip() + "\n\n" + text[pos:]


def replace_function(text, start_marker, end_marker, replacement):
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f"Missing start marker: {start_marker}")
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f"Missing end marker: {end_marker}")
    return text[:start] + replacement.rstrip() + "\n" + text[end:]


# Core: turn assignments + exact occurrences into semantic timeline rows.
core_path = Path("js/time-block-v2.js")
core = core_path.read_text(encoding="utf-8")
core_marker = "export function timeBlockDateOverridesForDate(state, dateKey) {"
core_add = r'''
export function buildTimeBlockTimelinePlanRows(templates, assignments, occurrences) {
  const blocks = sortTemplates((Array.isArray(templates) ? templates : []).filter((item) => item?.id && Number.isFinite(Number(item.startMinute)) && Number.isFinite(Number(item.endMinute)) && Number(item.endMinute) > Number(item.startMinute)));
  const blockById = new Map(blocks.map((block) => [String(block.id), block]));
  const exactByBlock = new Map(blocks.map((block) => [String(block.id), new Map()]));
  const rows = Array.isArray(occurrences) ? occurrences : [];

  for (const occurrence of rows) {
    if (!occurrence?.token || !occurrence.timed || !Number.isFinite(Number(occurrence.time))) continue;
    const minute = Number(occurrence.time);
    const block = blocks.find((candidate) => minute >= Number(candidate.startMinute) && minute < Number(candidate.endMinute));
    if (block) exactByBlock.get(String(block.id))?.set(String(occurrence.token), minute);
  }

  const result = [];
  for (const occurrence of rows) {
    if (!occurrence?.token || occurrence.timed) continue;
    const assignment = cleanAssignment(assignments?.[occurrence.token]);
    if (!assignment) continue;
    const block = blockById.get(String(assignment.blockId));
    if (!block) continue;
    let afterAnchor = TIME_BLOCK_START_ANCHOR;
    let anchorMinute = Number(block.startMinute);
    if (assignment.afterAnchor !== TIME_BLOCK_START_ANCHOR) {
      const anchor = exactByBlock.get(String(block.id))?.get(String(assignment.afterAnchor));
      if (Number.isFinite(anchor)) {
        afterAnchor = String(assignment.afterAnchor);
        anchorMinute = Number(anchor);
      }
    }
    result.push({
      token: String(occurrence.token),
      blockId: String(block.id),
      afterAnchor,
      anchorMinute,
      order: Math.max(1, Math.floor(Number(assignment.order) || 1)),
    });
  }

  return result.sort((a, b) => a.anchorMinute - b.anchorMinute || String(a.blockId).localeCompare(String(b.blockId)) || String(a.afterAnchor).localeCompare(String(b.afterAnchor)) || a.order - b.order || String(a.token).localeCompare(String(b.token)));
}
'''
if "export function buildTimeBlockTimelinePlanRows" not in core:
    core = insert_before(core, core_marker, core_add)
core_path.write_text(core, encoding="utf-8")

# Unified workspace: project manual assignments onto home timeline.
path = Path("js/unified-workspace.js")
text = path.read_text(encoding="utf-8")
old_import = '''  TIME_BLOCK_START_ANCHOR,\n  assignTimeBlockOccurrence,'''
new_import = '''  TIME_BLOCK_START_ANCHOR,\n  assignTimeBlockOccurrence,\n  buildTimeBlockTimelinePlanRows,'''
if old_import not in text:
    raise SystemExit("Missing timeline helper import anchor")
text = text.replace(old_import, new_import, 1)

helper_marker = "function plannerDay(d,index=0){"
helpers = r'''
function timeBlockV2TimelinePlan(entries,k,templates,assignments){
  const entryByToken=new Map(),occurrences=[];
  for(const entry of entries){
    const token=timeBlockV2EntryToken(entry,k);if(!token)continue;
    entryByToken.set(token,entry);
    occurrences.push({token,timed:Boolean(entry.timed),time:entry.timed?Number(entry.time):null})
  }
  return buildTimeBlockTimelinePlanRows(templates,assignments,occurrences).map(row=>({...row,entry:entryByToken.get(row.token)})).filter(row=>row.entry&&timeBlockV2Assignable(row.entry))
}
function timeBlockV2TimelinePlanItemMarkup(entry,k){
  return itemMarkup(entry.kind,entry.item,k,true).replace('class="uw-item ','class="uw-item uw-time-block-plan-item ').replace(/<button class="uw-move-handle"[^>]*>↕<\/button>/,'')
}
function timeBlockV2TimelineProjection(rows,k){
  const visible=rows.filter(row=>Number(row.anchorMinute)>=START&&Number(row.anchorMinute)<END),groups=new Map();
  for(const row of visible){const groupKey=`${row.blockId}|${row.afterAnchor}|${row.anchorMinute}`;if(!groups.has(groupKey))groups.set(groupKey,{blockId:row.blockId,afterAnchor:row.afterAnchor,anchorMinute:Number(row.anchorMinute),rows:[]});groups.get(groupKey).rows.push(row)}
  const ordered=[...groups.values()].sort((a,b)=>a.anchorMinute-b.anchorMinute||String(a.blockId).localeCompare(String(b.blockId))||String(a.afterAnchor).localeCompare(String(b.afterAnchor)));
  const rowHeight=24,gap=3;let cursor=-Infinity;
  for(const group of ordered){group.rows.sort((a,b)=>a.order-b.order||String(a.token).localeCompare(String(b.token)));const ideal=((group.anchorMinute-START)/SLOT)*SLOT_H;group.top=Math.max(0,ideal,Number.isFinite(cursor)?cursor+gap:0);group.anchorOffset=Math.max(0,group.top-ideal);group.height=Math.max(rowHeight,group.rows.length*rowHeight);cursor=group.top+group.height}
  const projectedTokens=new Set(visible.map(row=>row.token));
  const markup=ordered.map(group=>`<div class="uw-time-block-plan-group" style="top:${group.top}px;--uw-plan-anchor-offset:${group.anchorOffset}px" data-time-block-id="${esc(group.blockId)}" data-after-anchor="${esc(group.afterAnchor)}"><div class="uw-time-block-plan-rows">${group.rows.map(row=>timeBlockV2TimelinePlanItemMarkup(row.entry,k)).join("")}</div></div>`).join("");
  return{markup,projectedTokens,height:Math.max(timelineHeight(),Number.isFinite(cursor)?cursor+4:timelineHeight()),hasRows:visible.length>0}
}
'''
if "function timeBlockV2TimelineProjection" not in text:
    text = insert_before(text, helper_marker, helpers)

planner_replacement = r'''
function plannerDay(d,index=0){
  const k=key(d),items=timelineItemsForDay(k),plannedEntries=items.filter(entry=>entry.kind!=="session"),templates=effectiveTimeBlockTemplatesForDate(state,k),assignments=timeBlockAssignmentsForDate(state,k),planRows=timeBlockV2TimelinePlan(plannedEntries,k,templates,assignments),projection=timeBlockV2TimelineProjection(planRows,k),untimed=items.filter(entry=>!entry.timed&&!projection.projectedTokens.has(timeBlockV2EntryToken(entry,k))),timed=layoutTimedItems(items.filter(entry=>entry.timed&&entry.time>=START&&entry.time<END));
  let labels="",hits="";
  for(let m=START;m<END;m+=SLOT){if(m%60===0)labels+=`<span class="uw-time-label" style="top:${((m-START)/SLOT)*SLOT_H}px">${pad(m/60)}:00</span>`;hits+=`<div class="uw-time-hit" style="top:${((m-START)/SLOT)*SLOT_H}px" data-uw-add-kind="task" data-date="${k}" data-time="${m}"></div>`}
  const blocks=timed.map(x=>x.kind==="session"?sessionBlockMarkup(x,k):`<div class="uw-time-entry uw-item ${itemDoneOn(x.kind,x.item,k)?"done":""}" style="top:${((x.time-START)/SLOT)*SLOT_H+1}px;height:${Math.max(18,(x.duration/SLOT)*SLOT_H-2)}px;${timedColumnStyle(x)}${groupStyle(x.item)}" data-uw-kind="${x.kind}" data-id="${x.item.id}" data-date="${k}"${(x.kind==="task"||x.kind==="event")&&x.item._occurrenceSource?` data-occurrence-source="${x.item._occurrenceSource}"`:""} data-time="${x.time}" data-duration="${x.duration}"><button class="uw-resize-handle top" data-uw-resize="top" type="button"></button>${checkMarkup(x.kind,x.item,k)}<span class="uw-item-title">${esc(x.item.title)}</span><button class="uw-move-handle" type="button" aria-label="길게 눌러 이동">↕</button><button class="uw-select-circle" type="button"></button><button class="uw-resize-handle bottom" data-uw-resize="bottom" type="button"></button></div>`).join("");
  const head=homeDays>1?`<div class="uw-day-head"><strong>${dayLabel(d)}</strong></div>`:"",planClass=projection.hasRows?" uw-has-time-block-plan":"";
  return`<section class="uw-day${k===todayKey()?" uw-today":""}" data-date="${k}">${head}${allDayPanel(k,untimed)}<div class="uw-timeline${planClass}" style="height:${projection.height}px"><div class="uw-time-labels">${labels}</div><div class="uw-time-lane">${hits}${currentTimeMarkup(k)}<div class="uw-time-exact-lane">${blocks}</div>${projection.hasRows?`<div class="uw-time-block-plan-rail" aria-label="타임블럭 계획">${projection.markup}</div>`:""}</div></div></section>`
}
'''
text = replace_function(text, "function plannerDay(d,index=0){", "function renderPlanner(){", planner_replacement)
path.write_text(text, encoding="utf-8")

# CSS for split exact/plan lanes and anchor connectors.
css_path = Path("css/unified-workspace.css")
css = css_path.read_text(encoding="utf-8")
marker = "/* Time block V2 timeline projection */"
if marker not in css:
    css += r'''

/* Time block V2 timeline projection */
.uw-time-exact-lane{position:absolute;inset:0;min-width:0}
.uw-time-block-plan-rail{position:absolute;top:0;right:1px;bottom:0;left:52%;z-index:4;pointer-events:none}
.uw-has-time-block-plan .uw-time-exact-lane{right:50%}
.uw-time-block-plan-group{position:absolute;right:0;left:0;z-index:4;pointer-events:none}
.uw-time-block-plan-group::before{content:"";position:absolute;left:2px;top:calc(-1 * var(--uw-plan-anchor-offset,0px));width:1px;height:calc(var(--uw-plan-anchor-offset,0px) + 12px);background:color-mix(in srgb,var(--accent) 48%,var(--line))}
.uw-time-block-plan-group::after{content:"";position:absolute;left:-1px;top:calc(-1 * var(--uw-plan-anchor-offset,0px) - 2px);width:7px;height:7px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 2px #fff}
.uw-time-block-plan-rows{display:grid;gap:2px;padding-left:9px}
.uw-time-block-plan-item{min-height:22px!important;padding:2px 5px!important;border-style:dashed;background:color-mix(in srgb,var(--uw-group) 9%,#fff);font-size:9px;pointer-events:auto}
.uw-time-block-plan-item .uw-item-title{font-size:10px}
.uw-time-block-plan-item .uw-repeat-badge{display:none}
.uw-time-block-plan-item .uw-select-circle{display:none}
@media(max-width:700px){.uw-time-block-plan-rail{left:50%}.uw-has-time-block-plan .uw-time-exact-lane{right:52%}.uw-time-block-plan-item{min-height:24px!important}.uw-time-block-plan-item .uw-item-title{font-size:9px}}
'''
css_path.write_text(css, encoding="utf-8")

# Cache bumps.
index_path = Path("index.html")
index = index_path.read_text(encoding="utf-8")
for old,new in [
    ("./css/unified-workspace.css?v=34","./css/unified-workspace.css?v=35"),
    ("./js/unified-workspace.js?v=40","./js/unified-workspace.js?v=41"),
]:
    if old not in index:
        raise SystemExit(f"Expected cache token: {old}")
    index=index.replace(old,new,1)
index_path.write_text(index,encoding="utf-8")
