from pathlib import Path

u_path = Path('js/unified-workspace.js')
c_path = Path('css/unified-workspace.css')
i_path = Path('index.html')

u = u_path.read_text(encoding='utf-8')
c = c_path.read_text(encoding='utf-8')
i = i_path.read_text(encoding='utf-8')

old = '''    const resizeHandle=e.target.closest("[data-uw-resize]");
    const moveHandle=e.target.closest(".uw-move-handle");
    const item=(resizeHandle||moveHandle)?.closest(".uw-item")||e.target.closest(".uw-item");
    const plannerRow=item?.classList.contains("uw-time-block-v2-item")&&item.classList.contains("plan-draggable")&&!e.target.closest("button,input,select,textarea,a,[contenteditable=true]");
    let mode=null,source=null;
    if(resizeHandle){mode="resize";source=resizeHandle}
    else if(plannerRow){mode="time-block-plan";source=item}
    else if(moveHandle&&item?.classList.contains("selected")){mode="move";source=moveHandle}
    else if(!coarse()&&item&&!item.classList.contains("uw-time-block-v2-item")&&e.target.closest(".uw-item-title,.uw-habit-title")){mode="move";source=e.target.closest(".uw-item-title,.uw-habit-title")}
'''
new = '''    const resizeHandle=e.target.closest("[data-uw-resize]");
    const moveHandle=e.target.closest(".uw-move-handle");
    const item=(resizeHandle||moveHandle)?.closest(".uw-item")||e.target.closest(".uw-item");
    const interactive=Boolean(e.target.closest("button,input,select,textarea,a,[contenteditable=true]"));
    const plannerRow=Boolean(item?.classList.contains("uw-time-block-v2-item")&&item.classList.contains("plan-draggable"));
    const timelineRow=Boolean(item?.classList.contains("uw-time-entry")&&item.closest(".uw-timeline")&&!item.classList.contains("uw-session-entry"));
    const sharedDragRow=!interactive&&(plannerRow||timelineRow);
    let mode=null,source=null;
    if(resizeHandle){mode="resize";source=resizeHandle}
    else if(sharedDragRow){mode=plannerRow?"time-block-plan":"move";source=item}
    else if(moveHandle&&item?.classList.contains("selected")){mode="move";source=moveHandle}
'''
if old not in u:
    raise SystemExit('current home drag source block not found')
u = u.replace(old, new, 1)

# Make the common gesture thresholds explicit and shared by list/timeline modes.
marker = 'function wireControlsV2(){\n  let gesture=null;'
replacement = 'function wireControlsV2(){\n  const DRAG_MOUSE_DISTANCE=6,TOUCH_SCROLL_DISTANCE=10,TOUCH_HOLD_MS=450;\n  let gesture=null;'
if marker not in u:
    raise SystemExit('wireControlsV2 marker not found')
u = u.replace(marker, replacement, 1)
u = u.replace('if(g.coarse)g.timer=setTimeout(()=>activate(g),450);', 'if(g.coarse)g.timer=setTimeout(()=>activate(g),TOUCH_HOLD_MS);', 1)
u = u.replace('if(g.coarse&&distance>10){g.cancelled=true;clear(g);return}', 'if(g.coarse&&distance>TOUCH_SCROLL_DISTANCE){g.cancelled=true;clear(g);return}', 1)
u = u.replace('if(!g.coarse&&distance>=6)activate(g);', 'if(!g.coarse&&distance>=DRAG_MOUSE_DISTANCE)activate(g);', 1)

# Home timeline no longer exposes a separate move handle; the card body is the drag affordance just like list rows.
append_css = '''\n\n/* Home list + timeline shared drag gesture */\n.uw-timeline .uw-time-entry.uw-item{cursor:grab;user-select:none}\n.uw-timeline .uw-time-entry.uw-item.uw-dragging,.uw-timeline .uw-time-entry.uw-item.uw-drag-ready{cursor:grabbing}\n.uw-timeline .uw-time-entry.uw-item .uw-move-handle{display:none!important}\n.uw-timeline .uw-time-entry.uw-item button{cursor:pointer}\n@media(hover:none),(pointer:coarse){.uw-timeline .uw-time-entry.uw-item{cursor:default}}\n'''
if '/* Home list + timeline shared drag gesture */' not in c:
    c += append_css

if './js/unified-workspace.js?v=44' not in i or './css/unified-workspace.css?v=37' not in i:
    raise SystemExit('unexpected cache versions')
i = i.replace('./js/unified-workspace.js?v=44', './js/unified-workspace.js?v=45', 1)
i = i.replace('./css/unified-workspace.css?v=37', './css/unified-workspace.css?v=38', 1)

u_path.write_text(u, encoding='utf-8')
c_path.write_text(c, encoding='utf-8')
i_path.write_text(i, encoding='utf-8')
