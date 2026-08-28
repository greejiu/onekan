from pathlib import Path

u_path=Path('js/unified-workspace.js')
i_path=Path('index.html')
u=u_path.read_text(encoding='utf-8')
i=i_path.read_text(encoding='utf-8')

pstart=u.find('function plannerDay(d,index=0){')
pend=u.find('function renderPlanner()',pstart)
if pstart<0 or pend<0:
    raise SystemExit('plannerDay boundaries not found')
planner=u[pstart:pend]

bad='data-date="${k}" data-time-block-anchor="${esc(timeBlockV2EntryToken(x,k))}" data-time="${m}"'
good='data-date="${k}" data-time="${m}"'
if bad not in planner:
    raise SystemExit('bad hit anchor marker not found')
planner=planner.replace(bad,good,1)

blocks_start=planner.find('const blocks=timed.map(')
head_start=planner.find('const head=',blocks_start)
if blocks_start<0 or head_start<0:
    raise SystemExit('home exact blocks boundaries not found')
blocks=planner[blocks_start:head_start]
marker='data-id="${x.item.id}" data-date="${k}"'
if marker not in blocks:
    raise SystemExit('exact card date marker not found')
blocks=blocks.replace(marker,marker+' data-time-block-anchor="${esc(timeBlockV2EntryToken(x,k))}"',1)
planner=planner[:blocks_start]+blocks+planner[head_start:]
u=u[:pstart]+planner+u[pend:]

if './js/unified-workspace.js?v=46' not in i:
    raise SystemExit('unexpected JS cache version')
i=i.replace('./js/unified-workspace.js?v=46','./js/unified-workspace.js?v=47',1)

u_path.write_text(u,encoding='utf-8')
i_path.write_text(i,encoding='utf-8')
