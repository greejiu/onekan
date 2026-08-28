from pathlib import Path

u_path=Path('js/unified-workspace.js')
i_path=Path('index.html')
u=u_path.read_text(encoding='utf-8')
i=i_path.read_text(encoding='utf-8')

old='''planningAttrs=entry.timed?` data-time-block-anchor="${esc(token)}"`:assignable?` data-time-block-token="${esc(token)}"${assignment?` data-time-block-block-id="${esc(assignment.blockId)}" data-time-block-after-anchor="${esc(assignment.afterAnchor||TIME_BLOCK_START_ANCHOR)}" data-time-block-order="${Math.max(1,Number(assignment.order)||1)}"`:""}`:"";'''
new='''planningAttrs=entry.timed?` data-time-block-anchor="${esc(token)}" data-time="${Number(entry.time)}" data-duration="${Math.max(SLOT,Number(entry.duration)||SLOT)}"`:assignable?` data-time-block-token="${esc(token)}"${assignment?` data-time-block-block-id="${esc(assignment.blockId)}" data-time-block-after-anchor="${esc(assignment.afterAnchor||TIME_BLOCK_START_ANCHOR)}" data-time-block-order="${Math.max(1,Number(assignment.order)||1)}"`:""}`:"";'''
if old not in u:
    raise SystemExit('timed list planning attrs not found')
u=u.replace(old,new,1)

if './js/unified-workspace.js?v=54' not in i:
    raise SystemExit('unexpected JS cache version')
i=i.replace('./js/unified-workspace.js?v=54','./js/unified-workspace.js?v=55',1)

u_path.write_text(u,encoding='utf-8')
i_path.write_text(i,encoding='utf-8')
