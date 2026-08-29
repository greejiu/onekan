from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


unified_path = Path("js/unified-workspace.js")
unified = unified_path.read_text()

unified = replace_once(
    unified,
    '''  const manualAttrs=manual?` data-manual-row data-manual-kind="${kind}" data-manual-id="${esc(item.id)}"`:"";\n  const move=manual?'<button class="onekan-manual-handle" data-manual-sort-handle type="button" aria-label="순서 변경">⠿</button>':'<button class="uw-move-handle" type="button" aria-label="길게 눌러 이동">↕</button>';''',
    '''  const manualAttrs=manual?` data-manual-row data-manual-kind="${kind}" data-manual-id="${esc(item.id)}"`:"";\n  const move='<button class="uw-move-handle" type="button" aria-label="길게 눌러 이동">↕</button>';''',
    "shared item drag handle",
)

helpers = r'''function manualListKind(list){
  if(!list)return"";
  return list.dataset.uwAddKind||list.querySelector(":scope > .uw-item[data-uw-kind]")?.dataset.uwKind||""
}
function sameManualListGroup(source,target,kind){
  if(!source||!target)return false;
  const sourceKind=manualListKind(source),targetKind=manualListKind(target);
  if(sourceKind&&sourceKind!==kind||targetKind&&targetKind!==kind)return false;
  return(source.dataset.date||"")===(target.dataset.date||"")&&(source.dataset.groupId||"")===(target.dataset.groupId||"")
}
function manualDropTarget(g,pointed,list,clientY,groupMove=false){
  const raw=pointed?.closest("[data-manual-row]");
  const target=raw&&raw.parentElement===list?raw:null;
  g.validTarget=true;
  g.dropType=groupMove?"manual-group":"manual-order";
  g.nextDate=g.date;
  g.nextStart=g.start;
  g.nextManualList=list;
  g.nextGroupId=groupMove?(list.dataset.groupId||""):"";
  if(target){
    g.nextManualTargetId=target.dataset.id||"";
    if(g.nextManualTargetId===g.id){g.nextManualBefore=null;return}
    const rect=target.getBoundingClientRect(),before=clientY<rect.top+rect.height/2;
    g.nextManualBefore=before;
    target.classList.add(before?"uw-manual-drop-before":"uw-manual-drop-after")
  }else{
    g.nextManualTargetId="";
    g.nextManualBefore=false;
    list.classList.add("uw-manual-drop-bottom")
  }
}
async function saveManualListOrder(kind,id,list,targetId,before,targetGroupId=""){
  if(!list)return;
  const ids=[...list.children]
    .filter(row=>row.matches?.("[data-manual-row]")&&row.dataset.uwKind===kind)
    .map(row=>row.dataset.id)
    .filter(Boolean);
  const oldIndex=ids.indexOf(id);
  if(oldIndex>=0)ids.splice(oldIndex,1);
  if(targetId===id&&!targetGroupId)return;
  let insertAt=ids.length;
  if(targetId){const targetIndex=ids.indexOf(targetId);if(targetIndex>=0)insertAt=targetIndex+(before?0:1)}
  ids.splice(Math.max(0,Math.min(insertAt,ids.length)),0,id);
  await write(current=>{
    const entries=kind==="event"?current.events:current.tasks;
    const moved=entries.find(item=>item.id===id);
    if(moved&&targetGroupId)moved.groupId=targetGroupId;
    ids.forEach((rowId,index)=>{const item=entries.find(entry=>entry.id===rowId);if(item)item.manualOrder=(index+1)*1000})
  })
}
'''

unified = replace_once(
    unified,
    "function wireControlsV2(){",
    helpers + "function wireControlsV2(){",
    "manual order helpers",
)

unified = replace_once(
    unified,
    '''  const clearDropIndicators=()=>{$$(".uw-range-selected,.uw-drop-target,.uw-time-block-drop-before,.uw-time-block-drop-after,.uw-time-block-drop-bottom").forEach(x=>x.classList.remove("uw-range-selected","uw-drop-target","uw-time-block-drop-before","uw-time-block-drop-after","uw-time-block-drop-bottom"))};''',
    '''  const clearDropIndicators=()=>{$$(".uw-range-selected,.uw-drop-target,.uw-time-block-drop-before,.uw-time-block-drop-after,.uw-time-block-drop-bottom,.uw-manual-drop-before,.uw-manual-drop-after,.uw-manual-drop-bottom").forEach(x=>x.classList.remove("uw-range-selected","uw-drop-target","uw-time-block-drop-before","uw-time-block-drop-after","uw-time-block-drop-bottom","uw-manual-drop-before","uw-manual-drop-after","uw-manual-drop-bottom"))};''',
    "manual drop indicator cleanup",
)

unified = replace_once(
    unified,
    '''      g.nextDate=g.date;\n      g.nextStart=g.start;\n      g.dropType=null;''',
    '''      g.nextDate=g.date;\n      g.nextStart=g.start;\n      g.dropType=null;\n      g.manualList=item.closest("[data-manual-list]");\n      g.nextManualList=null;\n      g.nextManualTargetId="";\n      g.nextManualBefore=null;\n      g.nextGroupId="";''',
    "drag gesture manual list state",
)

manual_pointer = r'''    const manualList=pointed?.closest("[data-manual-list]");
    if(g.manualList&&manualList){
      if(sameManualListGroup(g.manualList,manualList,g.kind)){
        manualDropTarget(g,pointed,manualList,e.clientY,false);
        if(g.ghost){g.ghost.style.left=`${e.clientX}px`;g.ghost.style.top=`${e.clientY}px`}
        return
      }
      const sameDate=(g.manualList.dataset.date||"")===(manualList.dataset.date||"");
      const targetGroup=manualList.dataset.groupId||"",sourceGroup=g.manualList.dataset.groupId||"";
      if(sameDate&&g.kind==="task"&&targetGroup&&targetGroup!==sourceGroup){
        manualDropTarget(g,pointed,manualList,e.clientY,true);
        if(g.ghost){g.ghost.style.left=`${e.clientX}px`;g.ghost.style.top=`${e.clientY}px`}
        return
      }
    }
'''

unified = replace_once(
    unified,
    '''    const pointed=document.elementFromPoint(e.clientX,e.clientY);\n    const sideTab=pointed?.closest("[data-uw-side-tab]");''',
    '''    const pointed=document.elementFromPoint(e.clientX,e.clientY);\n''' + manual_pointer + '''    const sideTab=pointed?.closest("[data-uw-side-tab]");''',
    "shared drag manual list decision",
)

unified = replace_once(
    unified,
    '''    if(!g.validTarget)return;\n    const dateChanged=(g.nextDate||"")!==(g.date||"");''',
    '''    if(!g.validTarget)return;\n    if(g.dropType==="manual-order"||g.dropType==="manual-group"){\n      await saveManualListOrder(g.kind,g.id,g.nextManualList,g.nextManualTargetId,g.nextManualBefore===true,g.dropType==="manual-group"?g.nextGroupId:"");\n      return\n    }\n    const dateChanged=(g.nextDate||"")!==(g.date||"");''',
    "manual order pointer up branch",
)

unified_path.write_text(unified)

repeat_path = Path("js/repeat-overview.js")
repeat = repeat_path.read_text()
repeat = replace_once(
    repeat,
    '''    ${manual?'<button class="onekan-manual-handle" data-manual-sort-handle type="button" aria-label="순서 변경">⠿</button>':""}\n  </div>`''',
    '''    <button class="uw-move-handle" type="button" aria-label="길게 눌러 이동">↕</button>\n  </div>`''',
    "habit shared drag handle",
)
repeat_path.write_text(repeat)

css_path = Path("css/unified-workspace.css")
css = css_path.read_text()
marker = "/* Shared list ordering uses the main drag gesture. */"
if marker not in css:
    css += r'''

/* Shared list ordering uses the main drag gesture. */
[data-manual-row]{cursor:grab;user-select:none}
[data-manual-row].uw-dragging,[data-manual-row].uw-drag-ready{cursor:grabbing}
.uw-item.uw-manual-drop-before::before,.uw-item.uw-manual-drop-after::after{content:"";position:absolute;right:4px;left:4px;z-index:15;height:2px;border-radius:999px;background:var(--accent);pointer-events:none}
.uw-item.uw-manual-drop-before::before{top:-4px}
.uw-item.uw-manual-drop-after::after{bottom:-4px}
[data-manual-list].uw-manual-drop-bottom::after{content:"";display:block;height:2px;margin:3px 5px 1px;border-radius:999px;background:var(--accent);pointer-events:none}
'''
css_path.write_text(css)

index_path = Path("index.html")
index = index_path.read_text()
index = replace_once(index, '<link rel="stylesheet" href="./css/unified-workspace.css?v=44" />', '<link rel="stylesheet" href="./css/unified-workspace.css?v=45" />', "workspace css cache bump")
index = replace_once(index, '<script type="module" src="./js/unified-workspace.js?v=72"></script>', '<script type="module" src="./js/unified-workspace.js?v=73"></script>', "workspace js cache bump")
index = replace_once(index, '<script type="module" src="./js/repeat-overview.js?v=6"></script>', '<script type="module" src="./js/repeat-overview.js?v=7"></script>', "habit js cache bump")
index = replace_once(index, '  <script type="module" src="./js/manual-list-order.js?v=1"></script>\n', '', "remove manual order module")
index_path.write_text(index)

manual_path = Path("js/manual-list-order.js")
if manual_path.exists():
    manual_path.unlink()

print("merged manual ordering into shared drag")
