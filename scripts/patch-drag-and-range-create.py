from pathlib import Path

u_path=Path('js/unified-workspace.js')
c_path=Path('css/unified-workspace.css')
i_path=Path('index.html')
u=u_path.read_text(encoding='utf-8')
c=c_path.read_text(encoding='utf-8')
i=i_path.read_text(encoding='utf-8')

old='''    const planSurface=g.canUseTimeBlock&&pointed?.closest(".uw-time-block-plan-item[data-time-block-token],[data-uw-time-block-drop-list],.uw-time-block-v2-section");\n    if(planSurface){'''
new='''    const planningMove=g.canUseTimeBlock&&g.planToken&&g.start===null;\n    const planSurface=planningMove&&pointed?.closest(".uw-time-block-plan-item[data-time-block-token],[data-uw-time-block-drop-list],.uw-time-block-v2-section,.uw-timeline,.uw-all-day[data-uw-all-day-drop]");\n    if(planSurface){'''
if old not in u:
    raise SystemExit('planSurface marker missing')
u=u.replace(old,new,1)

old='''    if(!g.validTarget)return;\n    const scope=await dragMoveScope(g.kind,g.id,g.occurrenceSource,g.date);\n    if(!scope)return;\n    const recurring=recurringDragItem(g.kind,g.id),seriesMove=scope==="all"&&recurring,dateChanged=(g.nextDate||"")!==(g.date||"");'''
new='''    if(!g.validTarget)return;\n    const dateChanged=(g.nextDate||"")!==(g.date||"");\n    const directPlanningMove=Boolean(g.planToken&&g.start===null&&(g.kind==="task"||g.kind==="habit")&&!dateChanged&&(g.dropType==="time-block"||g.dropType==="time-block-unassigned"));\n    if(directPlanningMove){\n      if(g.dropType==="time-block-unassigned"){await write(next=>clearTimeBlockAssignment(next,g.date,g.planToken));return}\n      if(g.nextBlockId){await write(next=>placeTimeBlockOccurrence(next,g.date,g.planToken,g.nextBlockId,g.nextAfterAnchor,g.nextOrder));return}\n    }\n    const scope=await dragMoveScope(g.kind,g.id,g.occurrenceSource,g.date);\n    if(!scope)return;\n    const recurring=recurringDragItem(g.kind,g.id),seriesMove=scope==="all"&&recurring;'''
if old not in u:
    raise SystemExit('pointerup scope marker missing')
u=u.replace(old,new,1)

old_css='.uw-time-exact-lane{position:absolute;inset:0;min-width:0}'
new_css='.uw-time-exact-lane{position:absolute;inset:0;min-width:0;pointer-events:none}.uw-time-exact-lane .uw-time-entry{pointer-events:auto}'
if old_css not in c:
    raise SystemExit('exact lane css marker missing')
c=c.replace(old_css,new_css,1)

if './js/unified-workspace.js?v=54' not in i:
    raise SystemExit('unexpected js cache version')
if './css/unified-workspace.css?v=43' not in i:
    raise SystemExit('unexpected css cache version')
i=i.replace('./js/unified-workspace.js?v=54','./js/unified-workspace.js?v=55',1)
i=i.replace('./css/unified-workspace.css?v=43','./css/unified-workspace.css?v=44',1)

u_path.write_text(u,encoding='utf-8')
c_path.write_text(c,encoding='utf-8')
i_path.write_text(i,encoding='utf-8')
