from pathlib import Path

u_path=Path('js/unified-workspace.js')
c_path=Path('css/unified-workspace.css')
i_path=Path('index.html')
u=u_path.read_text(encoding='utf-8')
c=c_path.read_text(encoding='utf-8')
i=i_path.read_text(encoding='utf-8')

# 1) Projected timeline items use the same planner metadata/classes as list items.
start=u.find('function timeBlockV2TimelinePlanItemMarkup(entry,k){')
end=u.find('function timeBlockV2TimelineProjection(',start)
if start<0 or end<0:
    raise SystemExit('timeline plan item markup boundaries not found')
replacement='''function timeBlockV2TimelinePlanItemMarkup(entry,k,row){
  const token=row?.token||timeBlockV2EntryToken(entry,k),blockId=row?.blockId||"",afterAnchor=row?.afterAnchor||TIME_BLOCK_START_ANCHOR,order=Math.max(1,Number(row?.order)||1);
  return itemMarkup(entry.kind,entry.item,k,true)
    .replace('class="uw-item ','class="uw-item uw-time-block-plan-item uw-time-block-v2-item plan-draggable ')
    .replace(' draggable="false"',` data-time-block-token="${esc(token)}" data-time-block-block-id="${esc(blockId)}" data-time-block-after-anchor="${esc(afterAnchor)}" data-time-block-order="${order}" draggable="false"`)
    .replace(/<button class="uw-move-handle"[^>]*>↕<\/button>/,'')
}
'''
u=u[:start]+replacement+u[end:]
old_call='group.rows.map(row=>timeBlockV2TimelinePlanItemMarkup(row.entry,k)).join("")'
if old_call not in u:
    raise SystemExit('timeline plan item call not found')
u=u.replace(old_call,'group.rows.map(row=>timeBlockV2TimelinePlanItemMarkup(row.entry,k,row)).join("")',1)

# 2) Home exact-time rows expose occurrence tokens for before/after anchor drops.
pstart=u.find('function plannerDay(d,index=0){')
pend=u.find('function renderPlanner()',pstart)
if pstart<0 or pend<0:
    raise SystemExit('plannerDay boundaries not found')
planner=u[pstart:pend]
marker='data-date="${k}"'
idx=planner.find(marker)
if idx<0:
    raise SystemExit('plannerDay date attr not found')
planner=planner[:idx]+marker+' data-time-block-anchor="${esc(timeBlockV2EntryToken(x,k))}"'+planner[idx+len(marker):]
u=u[:pstart]+planner+u[pend:]

# 3) Planning drag resolver can target the timeline as well as the list.
marker='''  const plannerDropAt=(g,pointed,clientY)=>{\n'''
if marker not in u:
    raise SystemExit('plannerDropAt marker not found')
inject=r'''  const plannerDropAt=(g,pointed,clientY)=>{
    const timelineAllDay=pointed?.closest(".uw-all-day[data-uw-all-day-drop]");
    if(timelineAllDay){
      const date=timelineAllDay.dataset.date||timelineAllDay.closest(".uw-day")?.dataset.date;
      if(date===g.date){timelineAllDay.classList.add("uw-drop-target");return{dropType:"time-block-unassigned",date}}
      return null
    }
    const timeline=pointed?.closest(".uw-timeline");
    if(timeline){
      const day=timeline.closest(".uw-day"),date=day?.dataset.date;
      if(!date||date!==g.date)return null;
      const lane=timeline.querySelector(".uw-time-lane"),rect=lane?.getBoundingClientRect();
      if(!lane||!rect)return null;
      const minute=START+((clientY-rect.top)/SLOT_H)*SLOT,templates=effectiveTimeBlockTemplatesForDate(state,date),block=templates.find(candidate=>minute>=Number(candidate.startMinute)&&minute<Number(candidate.endMinute));
      if(!block)return null;
      const blockId=String(block.id),planItem=pointed?.closest(".uw-time-block-plan-item[data-time-block-token]");
      if(planItem&&planItem.dataset.timeBlockToken!==g.token){
        const targetBlockId=planItem.dataset.timeBlockBlockId||blockId,afterAnchor=planItem.dataset.timeBlockAfterAnchor||TIME_BLOCK_START_ANCHOR,bounds=planItem.getBoundingClientRect(),before=clientY<bounds.top+bounds.height/2;
        const peers=[...timeline.querySelectorAll('.uw-time-block-plan-item[data-time-block-token]')].filter(row=>row.dataset.timeBlockToken!==g.token&&row.dataset.timeBlockBlockId===targetBlockId&&(row.dataset.timeBlockAfterAnchor||TIME_BLOCK_START_ANCHOR)===afterAnchor).sort((a,b)=>(+a.dataset.timeBlockOrder||1)-(+b.dataset.timeBlockOrder||1));
        const peerIndex=peers.indexOf(planItem),order=(peerIndex<0?peers.length:peerIndex)+(before?1:2);
        planItem.classList.add(before?"uw-time-block-drop-before":"uw-time-block-drop-after");
        return{dropType:"time-block",date,blockId:targetBlockId,afterAnchor,order}
      }
      const exact=pointed?.closest('.uw-time-entry[data-time-block-anchor]');
      if(exact&&exact.closest('.uw-timeline')===timeline){
        const exactMinute=+exact.dataset.time,exactBlock=templates.find(candidate=>exactMinute>=Number(candidate.startMinute)&&exactMinute<Number(candidate.endMinute));
        if(exactBlock){
          const exactRows=[...timeline.querySelectorAll('.uw-time-entry[data-time-block-anchor]')].filter(row=>{const m=+row.dataset.time;return m>=Number(exactBlock.startMinute)&&m<Number(exactBlock.endMinute)}).sort((a,b)=>(+a.dataset.time||0)-(+b.dataset.time||0)||String(a.dataset.timeBlockAnchor).localeCompare(String(b.dataset.timeBlockAnchor)));
          const bounds=exact.getBoundingClientRect(),before=clientY<bounds.top+bounds.height/2,index=exactRows.indexOf(exact),afterAnchor=before?(index>0?exactRows[index-1].dataset.timeBlockAnchor:TIME_BLOCK_START_ANCHOR):exact.dataset.timeBlockAnchor;
          const peers=[...timeline.querySelectorAll('.uw-time-block-plan-item[data-time-block-token]')].filter(row=>row.dataset.timeBlockToken!==g.token&&row.dataset.timeBlockBlockId===String(exactBlock.id)&&(row.dataset.timeBlockAfterAnchor||TIME_BLOCK_START_ANCHOR)===afterAnchor);
          exact.classList.add(before?"uw-time-block-drop-before":"uw-time-block-drop-after");
          return{dropType:"time-block",date,blockId:String(exactBlock.id),afterAnchor,order:peers.length+1}
        }
      }
      const exactBefore=[...timeline.querySelectorAll('.uw-time-entry[data-time-block-anchor]')].filter(row=>{const m=+row.dataset.time;return m>=Number(block.startMinute)&&m<Number(block.endMinute)&&m<=minute}).sort((a,b)=>(+a.dataset.time||0)-(+b.dataset.time||0)||String(a.dataset.timeBlockAnchor).localeCompare(String(b.dataset.timeBlockAnchor)));
      const afterAnchor=exactBefore.length?exactBefore.at(-1).dataset.timeBlockAnchor:TIME_BLOCK_START_ANCHOR,peers=[...timeline.querySelectorAll('.uw-time-block-plan-item[data-time-block-token]')].filter(row=>row.dataset.timeBlockToken!==g.token&&row.dataset.timeBlockBlockId===blockId&&(row.dataset.timeBlockAfterAnchor||TIME_BLOCK_START_ANCHOR)===afterAnchor);
      timeline.querySelector('.uw-time-block-plan-rail')?.classList.add('uw-time-block-drop-bottom');
      return{dropType:"time-block",date,blockId,afterAnchor,order:peers.length+1}
    }
'''
u=u.replace(marker,inject,1)

# 4) Projected cards keep compact timeline geometry but no longer get a special dashed/background treatment.
old='.uw-time-block-plan-item{min-height:22px!important;padding:2px 5px!important;border-style:dashed;background:color-mix(in srgb,var(--uw-group) 9%,#fff);font-size:9px;pointer-events:auto}\n'
new='.uw-time-block-plan-item{min-height:22px!important;padding:2px 5px!important;font-size:9px;pointer-events:auto}\n'
if old not in c:
    raise SystemExit('timeline plan item css marker not found')
c=c.replace(old,new,1)

anchor='.uw-time-block-plan-item .uw-select-circle{display:none}\n'
extra='.uw-time-entry.uw-time-block-drop-before::before,.uw-time-entry.uw-time-block-drop-after::after{content:"";position:absolute;right:3px;left:3px;z-index:14;height:2px;border-radius:99px;background:var(--accent);pointer-events:none}\n.uw-time-entry.uw-time-block-drop-before::before{top:0}.uw-time-entry.uw-time-block-drop-after::after{bottom:0}\n'
if anchor not in c:
    raise SystemExit('timeline plan select css marker not found')
c=c.replace(anchor,anchor+extra,1)

# 5) Desktop home lists are two columns; exact anchors span both columns. Mobile stays one column.
old='.uw-time-block-v2-list{padding:4px 6px;min-height:38px}\n'
new='.uw-time-block-v2-list{padding:4px 6px;min-height:38px;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start}\n.uw-time-block-v2-list .uw-time-block-v2-item.fixed-anchor,.uw-time-block-v2-list .uw-time-block-v2-empty{grid-column:1/-1}\n.uw-time-block-v2-list.uw-time-block-drop-bottom::after{grid-column:1/-1}\n@media(max-width:700px){.uw-time-block-v2-list{grid-template-columns:minmax(0,1fr)}}\n'
if old not in c:
    raise SystemExit('time block list css marker not found')
c=c.replace(old,new,1)

# 6) Cache bust.
if './js/unified-workspace.js?v=45' not in i or './css/unified-workspace.css?v=38' not in i:
    raise SystemExit('unexpected cache versions')
i=i.replace('./js/unified-workspace.js?v=45','./js/unified-workspace.js?v=46',1)
i=i.replace('./css/unified-workspace.css?v=38','./css/unified-workspace.css?v=39',1)

u_path.write_text(u,encoding='utf-8')
c_path.write_text(c,encoding='utf-8')
i_path.write_text(i,encoding='utf-8')
