from pathlib import Path

u_path=Path('js/unified-workspace.js')
i_path=Path('index.html')
u=u_path.read_text(encoding='utf-8')
i=i_path.read_text(encoding='utf-8')

old='''function wireClicks(){installActionUI();wireHabitScopeDialog();wireTimeBlockDayDialog();document.addEventListener("click",async e=>{if(Date.now()<suppressItemClickUntil){e.preventDefault();e.stopImmediatePropagation();return}const timeBlockAdd='''
new='''function wireClicks(){installActionUI();wireHabitScopeDialog();wireTimeBlockDayDialog();document.addEventListener("click",async e=>{if(Date.now()<suppressItemClickUntil&&e.target.closest(".uw-item,.uw-inline-form")){e.preventDefault();e.stopImmediatePropagation();return}const timeBlockAdd='''
if old not in u:
    raise SystemExit('blanket click suppression guard not found')
u=u.replace(old,new,1)

if './js/unified-workspace.js?v=53' not in i:
    raise SystemExit('unexpected unified-workspace cache version')
i=i.replace('./js/unified-workspace.js?v=53','./js/unified-workspace.js?v=54',1)

u_path.write_text(u,encoding='utf-8')
i_path.write_text(i,encoding='utf-8')
