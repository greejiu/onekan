from pathlib import Path

u_path=Path('js/unified-workspace.js')
c_path=Path('css/unified-workspace.css')
i_path=Path('index.html')
u=u_path.read_text(encoding='utf-8')
c=c_path.read_text(encoding='utf-8')
i=i_path.read_text(encoding='utf-8')

# Keep projected items as the same task/habit cards, but mark the rail as a drop surface.
old='''function timeBlockV2TimelineProjection(rows,k){\n  const visible=rows.filter(row=>Number(row.anchorMinute)>=START&&Number(row.anchorMinute)<END),groups=new Map();'''
new='''function timeBlockV2TimelineProjection(rows,k){\n  const visible=rows.filter(row=>Number(row.anchorMinute)>=START&&Number(row.anchorMinute)<END),groups=new Map();'''
if old not in u:
    raise SystemExit('timeline projection marker missing')

# Ensure projected card markup carries all planner placement metadata and uses normal item visuals.
old_markup='''function timeBlockV2TimelinePlanItemMarkup(entry,k,row){\n  const token=row?.token||timeBlockV2EntryToken(entry,k),blockId=row?.blockId||"",afterAnchor=row?.afterAnchor||TIME_BLOCK_START_ANCHOR,order=Math.max(1,Number(row?.order)||1);\n  return itemMarkup(entry.kind,entry.item,k,true)\n    .replace('class="uw-item ','class="uw-item uw-time-block-plan-item uw-time-block-v2-item plan-draggable ')\n    .replace(' draggable="false"',` data-time-block-token="${esc(token)}" data-time-block-block-id="${esc(blockId)}" data-time-block-after-anchor="${esc(afterAnchor)}" data-time-block-order="${order}" draggable="false"`)\n    .replace(/<button class="uw-move-handle"[^>]*>↕<\\/button>/,'')\n}\n'''
new_markup='''function timeBlockV2TimelinePlanItemMarkup(entry,k,row){\n  const token=row?.token||timeBlockV2EntryToken(entry,k),blockId=row?.blockId||"",afterAnchor=row?.afterAnchor||TIME_BLOCK_START_ANCHOR,order=Math.max(1,Number(row?.order)||1);\n  return itemMarkup(entry.kind,entry.item,k,true)\n    .replace('class="uw-item ','class="uw-item uw-time-block-plan-item uw-time-block-v2-item plan-draggable ')\n    .replace(' draggable="false"',` data-time-block-token="${esc(token)}" data-time-block-block-id="${esc(blockId)}" data-time-block-after-anchor="${esc(afterAnchor)}" data-time-block-order="${order}" draggable="false"`)\n    .replace(/<button class="uw-move-handle"[^>]*>↕<\\/button>/,'')\n}\n'''
if old_markup not in u:
    raise SystemExit('timeline plan item markup missing')
u=u.replace(old_markup,new_markup,1)

# Add a semantic class to the plan rail so plannerDropAt can use the same time-block drop model explicitly.
u=u.replace('<div class="uw-time-block-plan-rail" aria-label="타임블럭 계획">', '<div class="uw-time-block-plan-rail uw-time-block-plan-drop-surface" aria-label="타임블럭 계획">', 1)

# Make timeline planner drop target calculation explicit and stable across exact + projected cards.
needle="""      const blockId=String(block.id),planItem=pointed?.closest(\".uw-time-block-plan-item[data-time-block-token]\");"""
replace="""      const blockId=String(block.id),planItem=pointed?.closest(\".uw-time-block-plan-item[data-time-block-token]\");"""
if needle not in u:
    raise SystemExit('timeline planner drop marker missing')

# Visual unification: remove connector/anchor ornaments and special miniature-card styling.
start=c.find('/* Time block V2 timeline projection */')
end=c.find('/* Time block V2 stage 5: full-row planning drag */',start)
if start<0 or end<0:
    raise SystemExit('timeline projection css block missing')
new_css='''/* Time block V2 timeline projection: same cards, different placement source */\n.uw-time-exact-lane{position:absolute;inset:0;min-width:0}\n.uw-time-block-plan-rail{position:absolute;top:0;right:1px;bottom:0;left:52%;z-index:4;pointer-events:none}\n.uw-has-time-block-plan .uw-time-exact-lane{right:50%}\n.uw-time-block-plan-group{position:absolute;right:0;left:0;z-index:4;pointer-events:none}\n.uw-time-block-plan-rows{display:grid;gap:2px}\n.uw-time-block-plan-item{min-height:18px;padding:2px 4px;font-size:9px;pointer-events:auto;overflow:hidden}\n.uw-time-block-plan-item .uw-item-title{font-size:11px}\n.uw-time-block-plan-item .uw-repeat-badge{display:inline}\n.uw-time-block-plan-item .uw-select-circle{display:none}\n.uw-time-block-plan-item.uw-time-block-drop-before::before,.uw-time-block-plan-item.uw-time-block-drop-after::after,.uw-time-entry.uw-time-block-drop-before::before,.uw-time-entry.uw-time-block-drop-after::after{content:"";position:absolute;right:3px;left:3px;z-index:14;height:2px;border-radius:99px;background:var(--accent);pointer-events:none}\n.uw-time-block-plan-item.uw-time-block-drop-before::before,.uw-time-entry.uw-time-block-drop-before::before{top:0}\n.uw-time-block-plan-item.uw-time-block-drop-after::after,.uw-time-entry.uw-time-block-drop-after::after{bottom:0}\n.uw-time-block-plan-rail.uw-time-block-drop-bottom{outline:2px solid color-mix(in srgb,var(--accent) 65%,transparent);outline-offset:-2px;border-radius:7px}\n@media(max-width:700px){.uw-time-block-plan-rail{left:50%}.uw-has-time-block-plan .uw-time-exact-lane{right:52%}.uw-time-block-plan-item{min-height:24px}.uw-time-block-plan-item .uw-item-title{font-size:11px}}\n\n'''
c=c[:start]+new_css+c[end:]

# Projected cards should use the same base .uw-item color/background; remove any old special background/border overrides if still present.
for snippet in [
    'border-style:dashed;',
    'background:color-mix(in srgb,var(--uw-group) 9%,#fff);'
]:
    c=c.replace(snippet,'')

# Cache bump.
if './js/unified-workspace.js?v=47' not in i or './css/unified-workspace.css?v=39' not in i:
    raise SystemExit('unexpected cache versions')
i=i.replace('./js/unified-workspace.js?v=47','./js/unified-workspace.js?v=48',1)
i=i.replace('./css/unified-workspace.css?v=39','./css/unified-workspace.css?v=40',1)

u_path.write_text(u,encoding='utf-8')
c_path.write_text(c,encoding='utf-8')
i_path.write_text(i,encoding='utf-8')
