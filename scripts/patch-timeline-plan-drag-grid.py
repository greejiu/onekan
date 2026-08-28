from pathlib import Path
import re

u_path=Path('js/unified-workspace.js')
c_path=Path('css/unified-workspace.css')
i_path=Path('index.html')
u=u_path.read_text(encoding='utf-8')
c=c_path.read_text(encoding='utf-8')
i=i_path.read_text(encoding='utf-8')

# 1. Timeline projected items: same base card, but carry the same planning metadata as list rows.
pattern=r'''function timeBlockV2TimelinePlanItemMarkup\(entry,k\)\{\n  return itemMarkup\(entry.kind,entry.item,k,true\)\.replace\('class=\\"uw-item ','class=\\"uw-item uw-time-block-plan-item '\)\.replace\(/<button class=\\"uw-move-handle\\"\[\^>\]\*>↕<\\\\/button>/,''\)\n\}'''
replacement='''function timeBlockV2TimelinePlanItemMarkup(entry,k,row){\n  const token=row?.token||timeBlockV2EntryToken(entry,k),blockId=row?.blockId||\"\",afterAnchor=row?.afterAnchor||TIME_BLOCK_START_ANCHOR,order=Math.max(1,Number(row?.order)||1);\n  return itemMarkup(entry.kind,entry.item,k,true)\n    .replace('class=\\"uw-item ','class=\\"uw-item uw-time-block-plan-item uw-time-block-v2-item plan-draggable ')\n    .replace(' draggable=\\"false\\"',` data-time-block-token=\\"${esc(token)}\\" data-time-block-block-id=\\"${esc(blockId)}\\" data-time-block-after-anchor=\\"${esc(afterAnchor)}\\" data-time-block-order=\\"${order}\\" draggable=\\"false\\"`)\n    .replace(/<button class=\\"uw-move-handle\\"[^>]*>↕<\\/button>/,'')\n}\n'''
new_u,count=re.subn(pattern,replacement,u,count=1)
if count!=1:
    # Use boundary replacement fallback; source formatting is stable but regex escaping is intentionally conservative.
    start=u.find('function timeBlockV2TimelinePlanItemMarkup(entry,k){')
    end=u.find('function timeBlockV2TimelineProjection(',start)
    if start<0 or end<0: raise SystemExit('timeline plan item markup boundaries not found')
    new_u=u[:start]+replacement+u[end:]
u=new_u
u=u.replace('group.rows.map(row=>timeBlockV2TimelinePlanItemMarkup(row.entry,k)).join(\"\")','group.rows.map(row=>timeBlockV2TimelinePlanItemMarkup(row.entry,k,row)).join(\"\")',1)

# 2. Exact timeline rows expose their occurrence token, so a manual card can be dropped before/after them.
needle='''data-id=\"${x.item.id}\" data-date=\"${k}\"${(x.kind===\"task\"||x.kind===\"event\")&&x.item._occurrenceSource?` data-occurrence-source=\"${x.item._occurrenceSource}\"`:\"\"} data-time=\"${x.time}\"'''
# Current source uses ==, not ===. Keep an exact source replacement.
needle='''data-id=\"${x.item.id}\" data-date=\"${k}\"${(x.kind==\"task\"||x.kind==\"event\")&&x.item._occurrenceSource?` data-occurrence-source=\"${x.item._occurrenceSource}\"`:\"\"} data-time=\"${x.time}\"'''
repl='''data-id=\"${x.item.id}\" data-date=\"${k}\" data-time-block-anchor=\"${esc(timeBlockV2EntryToken(x,k))}\"${(x.kind==\"task\"||x.kind==\"event\")&&x.item._occurrenceSource?` data-occurrence-source=\"${x.item._occurrenceSource}\"`:\"\"} data-time=\"${x.time}\"'''
if needle not in u: raise SystemExit('home exact timeline row marker not found')
u=u.replace(needle,repl,1)

# 3. Planner drop resolver also understands the home timeline. It maps visual Y to block/anchor/order only; it never writes a fake time.
marker='''  const plannerDropAt=(g,pointed,clientY)=>{\n'''
if marker not in u: raise SystemExit('plannerDropAt marker not found')
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
        const targetBlockId=planItem.dataset.timeBlockBlockId||blockId,afterAnchor=planItem.dataset.timeBlockAfterAnchor||TIME_BLOCK_START_ANCHOR,before=clientY<planItem.getBoundingClientRect().top+planItem.getBoundingClientRect().height/2;
        const peers=[...timeline.querySelectorAll('.uw-time-block-plan-item[data-time-block-token]')].filter(row=>row.dataset.timeBlockToken!==g.token&&row.dataset.timeBlockBlockId===targetBlockId&&(row.dataset.timeBlockAfterAnchor||TIME_BLOCK_START_ANCHOR)===afterAnchor).sort((a,b)=>(+a.dataset.timeBlockOrder||1)-(+b.dataset.timeBlockOrder||1));
        const index=Math.max(0,peers.indexOf(planItem)),order=index+(before?1:2);
        planItem.classList.add(before?"uw-time-block-drop-before":"uw-time-block-drop-after");
        return{dropType:"time-block",date,blockId:targetBlockId,afterAnchor,order}
      }
      const exact=pointed?.closest('.uw-time-entry[data-time-block-anchor]');
      if(exact&&exact.closest('.uw-timeline')===timeline){
        const exactMinute=+exact.dataset.time,exactBlock=templates.find(candidate=>exactMinute>=Number(candidate.startMinute)&&exactMinute<Number(candidate.endMinute));
        if(exactBlock){
          const exactRows=[...timeline.querySelectorAll('.uw-time-entry[data-time-block-anchor]')].filter(row=>{const m=+row.dataset.time;return m>=Number(exactBlock.startMinute)&&m<Number(exactBlock.endMinute)}).sort((a,b)=>(+a.dataset.time||0)-(+b.dataset.time||0)||String(a.dataset.timeBlockAnchor).localeCompare(String(b.dataset.timeBlockAnchor)));
          const before=clientY<exact.getBoundingClientRect().top+exact.getBoundingClientRect().height/2,index=exactRows.indexOf(exact),afterAnchor=before?(index>0?exactRows[index-1].dataset.timeBlockAnchor:TIME_BLOCK_START_ANCHOR):exact.dataset.timeBlockAnchor;
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

# 4. Timeline projected cards use the same visual card language. Keep compact geometry only because the time axis is dense.
old_css='''.uw-time-block-plan-item{min-height:22px!important;padding:2px 5px!important;border-style:dashed;background:color-mix(in srgb,var(--uw-group) 9%,#fff);font-size:9px;pointer-events:auto}\n'''
new_css='''.uw-time-block-plan-item{min-height:22px!important;padding:2px 5px!important;font-size:9px;pointer-events:auto}\n'''
if old_css not in c: raise SystemExit('timeline plan item css marker not found')
c=c.replace(old_css,new_css,1)

# Exact anchors also show the same thin before/after insertion line when targeted from a projected card.
insert_css='''.uw-time-entry.uw-time-block-drop-before::before,.uw-time-entry.uw-time-block-drop-after::after{content:"";position:absolute;right:3px;left:3px;z-index:14;height:2px;border-radius:99px;background:var(--accent);pointer-events:none}\n.uw-time-entry.uw-time-block-drop-before::before{top:0}.uw-time-entry.uw-time-block-drop-after::after{bottom:0}\n'''
anchor_css='.uw-time-block-plan-item .uw-select-circle{display:none}\n'
if anchor_css not in c: raise SystemExit('timeline plan select css marker not found')
c=c.replace(anchor_css,anchor_css+insert_css,1)

# 5. Home list: two columns on roomy screens, with exact-time anchors spanning both columns; mobile stays one column.
list_marker='.uw-time-block-v2-list{padding:4px 6px;min-height:38px}\n'
list_repl='.uw-time-block-v2-list{padding:4px 6px;min-height:38px;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start}\n.uw-time-block-v2-list .uw-time-block-v2-item.fixed-anchor,.uw-time-block-v2-list .uw-time-block-v2-empty{grid-column:1/-1}\n.uw-time-block-v2-list.uw-time-block-drop-bottom::after{grid-column:1/-1}\n@media(max-width:700px){.uw-time-block-v2-list{grid-template-columns:minmax(0,1fr)}}\n'
if list_marker not in c: raise SystemExit('time block list css marker not found')
c=c.replace(list_marker,list_repl,1)

# Drop indicator cleanup must also clear timeline exact-anchor lines.
old_clear='''.uw-range-selected,.uw-drop-target,.uw-time-block-drop-before,.uw-time-block-drop-after,.uw-time-block-drop-bottom'''
# Already covers classes generically; no code change required.

# Cache bust.
if './js/unified-workspace.js?v=45' not in i or './css/unified-workspace.css?v=38' not in i: raise SystemExit('unexpected cache versions')
i=i.replace('./js/unified-workspace.js?v=45','./js/unified-workspace.js?v=46',1)
i=i.replace('./css/unified-workspace.css?v=38','./css/unified-workspace.css?v=39',1)

u_path.write_text(u,encoding='utf-8')
c_path.write_text(c,encoding='utf-8')
i_path.write_text(i,encoding='utf-8')
