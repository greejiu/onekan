from pathlib import Path

u_path=Path('js/unified-workspace.js')
c_path=Path('css/unified-workspace.css')
i_path=Path('index.html')
u=u_path.read_text(encoding='utf-8')
c=c_path.read_text(encoding='utf-8')
i=i_path.read_text(encoding='utf-8')

old='''    if(!g.validTarget)return;\n    const scope=await dragMoveScope(g.kind,g.id,g.occurrenceSource,g.date);\n    if(!scope)return;\n    const recurring=recurringDragItem(g.kind,g.id),seriesMove=scope==="all"&&recurring,dateChanged=(g.nextDate||"")!==(g.date||"");\n'''
new='''    if(!g.validTarget)return;\n    const dateChanged=(g.nextDate||"")!==(g.date||"");\n    const planningOnly=(g.dropType==="time-block"||g.dropType==="time-block-unassigned")&&g.start===null&&(g.kind==="task"||g.kind==="habit");\n    const scope=planningOnly?"day":await dragMoveScope(g.kind,g.id,g.occurrenceSource,g.date);\n    if(!scope)return;\n    const recurring=recurringDragItem(g.kind,g.id),seriesMove=!planningOnly&&scope==="all"&&recurring;\n'''
if old not in u:
    raise SystemExit('pointerup scope block not found')
u=u.replace(old,new,1)

old='''    if(g.dropType==="time-block-unassigned"&&g.planToken){\n      if(g.planDate&&!seriesMove&&!dateChanged)await write(next=>clearTimeBlockAssignment(next,g.planDate,g.planToken));\n      else await saveUntimedChange(g.kind,g.id,g.nextDate,g.occurrenceSource,g.planDate,g.planToken,scope);\n      return\n    }\n'''
new='''    if(g.dropType==="time-block-unassigned"&&g.planToken){\n      if(planningOnly){\n        if(g.planDate)await write(next=>clearTimeBlockAssignment(next,g.planDate,g.planToken));\n        return\n      }\n      if(g.planDate&&!seriesMove&&!dateChanged)await write(next=>clearTimeBlockAssignment(next,g.planDate,g.planToken));\n      else await saveUntimedChange(g.kind,g.id,g.nextDate,g.occurrenceSource,g.planDate,g.planToken,scope);\n      return\n    }\n'''
if old not in u:
    raise SystemExit('unassigned drop block not found')
u=u.replace(old,new,1)

old='''    if(g.dropType==="time-block"&&g.planToken&&g.nextBlockId){\n      if(g.start!==null||g.kind==="event"||seriesMove){\n'''
new='''    if(g.dropType==="time-block"&&g.planToken&&g.nextBlockId){\n      if(planningOnly){\n        const placementToken=dateChanged&&!recurring?timeBlockOccurrenceToken(g.kind,{id:g.id},g.nextDate):g.planToken;\n        if(dateChanged)await saveUntimedChange(g.kind,g.id,g.nextDate,g.occurrenceSource,g.planDate,g.planToken,"day");\n        await write(next=>placeTimeBlockOccurrence(next,g.nextDate,placementToken,g.nextBlockId,g.nextAfterAnchor,g.nextOrder));\n        return\n      }\n      if(g.start!==null||g.kind==="event"||seriesMove){\n'''
if old not in u:
    raise SystemExit('time-block drop block not found')
u=u.replace(old,new,1)

# Make the empty timeline hit grid pointer-reachable while keeping cards interactive.
old_css='.uw-time-exact-lane{position:absolute;inset:0;min-width:0}'
new_css='.uw-time-exact-lane{position:absolute;inset:0;min-width:0;pointer-events:none}.uw-time-exact-lane .uw-time-entry{pointer-events:auto}'
if old_css not in c:
    raise SystemExit('exact lane css not found')
c=c.replace(old_css,new_css,1)

if './js/unified-workspace.js?v=54' not in i or './css/unified-workspace.css?v=43' not in i:
    raise SystemExit('unexpected cache versions')
i=i.replace('./js/unified-workspace.js?v=54','./js/unified-workspace.js?v=55',1)
i=i.replace('./css/unified-workspace.css?v=43','./css/unified-workspace.css?v=44',1)

u_path.write_text(u,encoding='utf-8')
c_path.write_text(c,encoding='utf-8')
i_path.write_text(i,encoding='utf-8')
