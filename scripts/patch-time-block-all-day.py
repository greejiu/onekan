from pathlib import Path

path = Path("js/unified-workspace.js")
text = path.read_text(encoding="utf-8")

# User-facing wording: an unassigned untimed item is an all-day item.
text = text.replace("타임블럭 없음", "하루종일")
text = text.replace('<span class="uw-all-day-label">하루 종일</span>', '<span class="uw-all-day-label">하루종일</span>')

start_marker = "function plannerListDay(d){"
end_marker = "function timeBlockV2TimelinePlan("
start = text.find(start_marker)
end = text.find(end_marker, start + 1)
if start < 0 or end < 0:
    raise SystemExit("Could not locate plannerListDay boundaries")

replacement = r'''function plannerListDay(d){
  const k=key(d),templates=effectiveTimeBlockTemplatesForDate(state,k),hiddenTemplates=hiddenTimeBlockTemplatesForDate(state,k),assignments=timeBlockAssignmentsForDate(state,k),entries=itemsForDay(k),head=homeDays>1?`<div class="uw-day-head"><strong>${dayLabel(d)}</strong></div>`:"",blockMap=new Map(templates.map(template=>[template.id,{template,timed:[],manual:[]}])) ,allDay=[],outsideTimed=[];
  for(const entry of entries){
    const token=timeBlockV2EntryToken(entry,k);
    if(entry.timed){
      const template=timeBlockV2TemplateForMinute(templates,entry.time);
      if(template)blockMap.get(template.id)?.timed.push(entry);else outsideTimed.push(entry);
      continue
    }
    const assignment=assignments[token],target=assignment&&timeBlockV2Assignable(entry)?blockMap.get(assignment.blockId):null;
    if(target)target.manual.push(entry);else allDay.push(entry)
  }
  const allDaySorted=[...allDay].sort((a,b)=>String(a.item.title||"").localeCompare(String(b.item.title||""),"ko"));
  const allDayMarkup=allDaySorted.map(entry=>{const token=timeBlockV2EntryToken(entry,k),assignment=assignments[token];return timeBlockV2ItemMarkup(entry,k,templates,assignment&&blockMap.has(assignment.blockId)?assignment:null)}).join("")||'<div class="uw-time-block-v2-empty">하루종일 항목이 없어요.</div>';
  const outsideTimedSorted=[...outsideTimed].sort((a,b)=>Number(a.time)-Number(b.time)||String(a.item.createdAt||a.item.id||a.item.title||"").localeCompare(String(b.item.createdAt||b.item.id||b.item.title||""),"ko"));
  const outsideTimedMarkup=outsideTimedSorted.map(entry=>timeBlockV2ItemMarkup(entry,k,templates)).join("");
  const hiddenMarkup=hiddenTemplates.length?`<div class="uw-time-block-hidden-list">${hiddenTemplates.map(template=>`<div class="uw-time-block-hidden-row"><span>숨긴 블럭 · ${timeBlockV2MinuteText(template.startMinute)}–${timeBlockV2MinuteText(template.endMinute)}${template.title?` · ${esc(template.title)}`:""}</span><button type="button" data-uw-time-block-restore data-date="${k}" data-block-id="${esc(template.id)}">복원</button></div>`).join("")}</div>`:"";
  const outsideSection=outsideTimedSorted.length?`<section class="uw-time-block-v2-section outside-time"><div class="uw-time-block-v2-head"><strong>블럭 밖 시간</strong></div><div class="uw-list uw-time-block-v2-list">${outsideTimedMarkup}</div></section>`:"";
  const sections=templates.map(template=>{const bucket=blockMap.get(template.id),dayOnly=Boolean(template._dateCreated);return`<section class="uw-time-block-v2-section" data-time-block-id="${esc(template.id)}"><div class="uw-time-block-v2-head"><div class="uw-time-block-v2-title"><strong>${timeBlockV2MinuteText(template.startMinute)}–${timeBlockV2MinuteText(template.endMinute)}</strong>${template.title?`<span>${esc(template.title)}</span>`:""}${dayOnly?`<span class="uw-time-block-v2-today-badge">오늘만</span>`:""}</div><button class="uw-time-block-v2-menu-button" type="button" data-uw-time-block-menu data-date="${k}" data-block-id="${esc(template.id)}" data-created="${dayOnly}" aria-label="타임블럭 메뉴">⋯</button></div><div class="uw-list uw-time-block-v2-list">${timeBlockV2BlockContents(template,bucket?.timed||[],bucket?.manual||[],k,templates,assignments)}</div></section>`}).join("");
  return`<section class="uw-day uw-list-day uw-time-block-v2-day${k===todayKey()?" uw-today":""}" data-date="${k}">${head}<section class="uw-time-block-v2-section unassigned"><div class="uw-time-block-v2-head"><strong>하루종일</strong><button class="uw-time-block-day-add" type="button" data-uw-time-block-add data-date="${k}">＋ 이 날 블럭</button></div><div class="uw-list uw-time-block-v2-list" data-uw-add-kind="task" data-date="${k}" data-task-drop-date="${k}">${allDayMarkup}</div>${hiddenMarkup}</section>${outsideSection}${sections}</section>`
}
'''
text = text[:start] + replacement + text[end:]
path.write_text(text, encoding="utf-8")

index_path = Path("index.html")
index = index_path.read_text(encoding="utf-8")
old = './js/unified-workspace.js?v=41'
new = './js/unified-workspace.js?v=42'
if old not in index:
    raise SystemExit("Expected unified-workspace.js cache version 41")
index = index.replace(old, new, 1)
index_path.write_text(index, encoding="utf-8")
