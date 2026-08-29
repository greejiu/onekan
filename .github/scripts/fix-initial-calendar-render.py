from pathlib import Path

path = Path('js/unified-workspace.js')
text = path.read_text(encoding='utf-8')
old = '''async function renderAll(){if(rendering)return;rendering=true;try{await read();if(!state)return;applyColors();renderHome();renderSchedulePage();renderTasks();renderHabits()}catch(e){console.error("통합 화면 렌더링 실패",e)}finally{rendering=false}}
async function init(){if(document.documentElement.dataset.unifiedWorkspace)return;document.documentElement.dataset.unifiedWorkspace="1";wireDragClickGuard();wireEnterToSave();wireHabitForm();wireOverdueActions();wireTaskViewControls();wireScheduleViewControls();wireClicks();wireSideTabs();wireControlsV2();document.addEventListener("onekan:state-changed",event=>{if(event.detail?.source!=="unified")scheduleRender(40)});await renderAll();updateCurrentTimeLines();setInterval(updateCurrentTimeLines,60000)}
supabase.auth.onAuthStateChange((_e,session)=>{user=session?.user||null;if(user)setTimeout(init,300)});const {data:{session}}=await supabase.auth.getSession();if(session?.user){user=session.user;setTimeout(init,300)}
'''
new = '''function renderInitialCalendarShells(){
  if(state)return;
  state=normalize({});
  applyColors();
  renderSchedulePage();
  renderTasks();
}
async function renderAll(){if(rendering)return;rendering=true;try{await read();if(!state)return;applyColors();renderHome();renderSchedulePage();renderTasks();renderHabits()}catch(e){console.error("통합 화면 렌더링 실패",e)}finally{rendering=false}}
async function init(){if(document.documentElement.dataset.unifiedWorkspace)return;document.documentElement.dataset.unifiedWorkspace="1";wireDragClickGuard();wireEnterToSave();wireHabitForm();wireOverdueActions();wireTaskViewControls();wireScheduleViewControls();wireClicks();wireSideTabs();wireControlsV2();document.addEventListener("onekan:state-changed",event=>{if(event.detail?.source!=="unified")scheduleRender(40)});renderInitialCalendarShells();await renderAll();updateCurrentTimeLines();setInterval(updateCurrentTimeLines,60000)}
supabase.auth.onAuthStateChange((_e,session)=>{user=session?.user||null;if(user)queueMicrotask(init)});const {data:{session}}=await supabase.auth.getSession();if(session?.user){user=session.user;queueMicrotask(init)}
'''
if old not in text:
    raise SystemExit('target init block not found')
text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')

index = Path('index.html')
html = index.read_text(encoding='utf-8')
old_version = './js/unified-workspace.js?v=74'
new_version = './js/unified-workspace.js?v=75'
if old_version not in html:
    raise SystemExit('unified-workspace version marker not found')
index.write_text(html.replace(old_version, new_version, 1), encoding='utf-8')
