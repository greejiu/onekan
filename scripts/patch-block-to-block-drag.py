from pathlib import Path

u_path=Path('js/unified-workspace.js')
i_path=Path('index.html')
u=u_path.read_text(encoding='utf-8')
i=i_path.read_text(encoding='utf-8')
old='''    const planningMove=g.canUseTimeBlock&&g.planToken&&g.start===null;\n    const planSurface=planningMove&&pointed?.closest(\".uw-time-block-plan-item[data-time-block-token],[data-uw-time-block-drop-list],.uw-time-block-v2-section,.uw-timeline,.uw-all-day[data-uw-all-day-drop]\");\n'''
new='''    const planningMove=g.canUseTimeBlock&&g.planToken&&g.start===null;\n    const listBlockSurface=g.canUseTimeBlock&&g.planToken&&pointed?.closest(\"[data-uw-time-block-drop-list],.uw-time-block-v2-section\");\n    const planSurface=planningMove?pointed?.closest(\".uw-time-block-plan-item[data-time-block-token],[data-uw-time-block-drop-list],.uw-time-block-v2-section,.uw-timeline,.uw-all-day[data-uw-all-day-drop]\"):listBlockSurface;\n'''
if old not in u:
    raise SystemExit('planning surface block not found')
u=u.replace(old,new,1)
if './js/unified-workspace.js?v=56' not in i:
    raise SystemExit('unexpected cache version')
i=i.replace('./js/unified-workspace.js?v=56','./js/unified-workspace.js?v=57',1)
u_path.write_text(u,encoding='utf-8')
i_path.write_text(i,encoding='utf-8')
