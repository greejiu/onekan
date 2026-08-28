from pathlib import Path

u_path=Path('js/unified-workspace.js')
c_path=Path('css/unified-workspace.css')
i_path=Path('index.html')
u=u_path.read_text(encoding='utf-8')
c=c_path.read_text(encoding='utf-8')
i=i_path.read_text(encoding='utf-8')

# Timed cards in Home > List must expose their real time to the shared drag engine.
old='''planningAttrs=entry.timed?` data-time-block-anchor="${esc(token)}"`:assignable?` data-time-block-token="${esc(token)}"${assignment?` data-time-block-block-id="${esc(assignment.blockId)}" data-time-block-after-anchor="${esc(assignment.afterAnchor||TIME_BLOCK_START_ANCHOR)}" data-time-block-order="${Math.max(1,Number(assignment.order)||1)}"`:""}`:"";'''
new='''planningAttrs=entry.timed?` data-time-block-anchor="${esc(token)}" data-time="${Number(entry.time)}" data-duration="${Math.max(SLOT,Number(entry.duration)||SLOT)}"`:assignable?` data-time-block-token="${esc(token)}"${assignment?` data-time-block-block-id="${esc(assignment.blockId)}" data-time-block-after-anchor="${esc(assignment.afterAnchor||TIME_BLOCK_START_ANCHOR)}" data-time-block-order="${Math.max(1,Number(assignment.order)||1)}"`:""}`:"";'''
if old not in u:
    raise SystemExit('timed list planning attrs not found')
u=u.replace(old,new,1)

# The absolute exact-time lane must not cover the empty 30-minute hit grid.
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
