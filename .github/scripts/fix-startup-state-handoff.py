from pathlib import Path

app_path = Path('js/app.js')
uw_path = Path('js/unified-workspace.js')
index_path = Path('index.html')

app = app_path.read_text()
uw = uw_path.read_text()
index = index_path.read_text()

old_dispatch = '  document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source: "app-render" } }));'
new_dispatch = '''  const sharedState = JSON.parse(JSON.stringify(state));
  window.__ONEKAN_APP_STATE__ = sharedState;
  document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source: "app-render", state: sharedState } }));'''
assert old_dispatch in app, 'app render dispatch target not found'
app = app.replace(old_dispatch, new_dispatch, 1)

old_read = 'async function read(){if(!user){const {data:{session}}=await supabase.auth.getSession();user=session?.user||null}if(!user)return null;const {data,error}=await supabase.from("onekan_state").select("data").eq("user_id",user.id).maybeSingle();if(error)throw error;state=normalize(data?.data);return state}'
new_read = 'async function read(){if(!user){const {data:{session}}=await supabase.auth.getSession();user=session?.user||null}if(!user)return null;const {data,error}=await supabase.from("onekan_state").select("data").eq("user_id",user.id).maybeSingle();if(error)throw error;const remote=data?.data;if(remote&&typeof remote==="object")state=normalize(remote);else if(!state)state=normalize({});return state}'
assert old_read in uw, 'unified read target not found'
uw = uw.replace(old_read, new_read, 1)

old_schedule = 'function scheduleRender(ms=60){clearTimeout(renderTimer);renderTimer=setTimeout(renderAll,ms)}\nfunction group(item)'
new_schedule = '''function scheduleRender(ms=60){clearTimeout(renderTimer);renderTimer=setTimeout(renderAll,ms)}
function adoptSharedState(payload){
  if(!payload||typeof payload!=="object")return false;
  state=normalize(JSON.parse(JSON.stringify(payload)));
  return true
}
function group(item)'''
assert old_schedule in uw, 'scheduleRender insertion target not found'
uw = uw.replace(old_schedule, new_schedule, 1)

old_shell = '''function renderInitialCalendarShells(){
  if(state)return;
  state=normalize({});
  applyColors();
  renderSchedulePage();
  renderTasks();
}'''
new_shell = '''function renderInitialCalendarShells(){
  if(state)return;
  const previousState=state;
  state=normalize({});
  try{
    applyColors();
    renderSchedulePage();
    renderTasks();
  }finally{
    state=previousState;
  }
}'''
assert old_shell in uw, 'initial shell target not found'
uw = uw.replace(old_shell, new_shell, 1)

old_init = 'async function init(){if(document.documentElement.dataset.unifiedWorkspace)return;document.documentElement.dataset.unifiedWorkspace="1";wireDragClickGuard();wireEnterToSave();wireHabitForm();wireOverdueActions();wireTaskViewControls();wireScheduleViewControls();wireClicks();wireSideTabs();wireControlsV2();document.addEventListener("onekan:state-changed",event=>{if(event.detail?.source!=="unified")scheduleRender(40)});renderInitialCalendarShells();await renderAll();updateCurrentTimeLines();setInterval(updateCurrentTimeLines,60000)}'
new_init = '''async function init(){
  if(document.documentElement.dataset.unifiedWorkspace)return;
  document.documentElement.dataset.unifiedWorkspace="1";
  wireDragClickGuard();wireEnterToSave();wireHabitForm();wireOverdueActions();wireTaskViewControls();wireScheduleViewControls();wireClicks();wireSideTabs();wireControlsV2();
  document.addEventListener("onekan:state-changed",event=>{
    if(event.detail?.source==="unified")return;
    if(event.detail?.state&&adoptSharedState(event.detail.state)){
      applyColors();renderHome();renderSchedulePage();renderTasks();renderHabits();
      return
    }
    scheduleRender(40)
  });
  renderInitialCalendarShells();
  if(adoptSharedState(window.__ONEKAN_APP_STATE__)){
    applyColors();renderHome();renderSchedulePage();renderTasks();renderHabits();
  }else{
    await renderAll();
  }
  updateCurrentTimeLines();
  setInterval(updateCurrentTimeLines,60000)
}'''
assert old_init in uw, 'init target not found'
uw = uw.replace(old_init, new_init, 1)

assert 'unified-workspace.js?v=77' in index, 'index cache version target not found'
index = index.replace('unified-workspace.js?v=77', 'unified-workspace.js?v=78', 1)

app_path.write_text(app)
uw_path.write_text(uw)
index_path.write_text(index)
