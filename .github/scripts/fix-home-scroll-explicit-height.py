from pathlib import Path

css_path = Path('css/unified-workspace.css')
js_path = Path('js/unified-workspace.js')
index_path = Path('index.html')

css = css_path.read_text()
js = js_path.read_text()
index = index_path.read_text()

marker = '/* Home right cards: reliable half-height internal scrolling */'
assert marker in css, 'home scroll marker not found'
css = css.split(marker, 1)[0].rstrip() + r'''

/* Home right cards: explicit-height internal scrolling */
#page-home #homeRightColumn .uw-side-toggle[open]{
  display:flex;
  flex-direction:column;
  min-height:0;
  overflow:hidden;
}
#page-home #homeRightColumn .uw-side-toggle .card-body{
  min-width:0;
  min-height:0;
  box-sizing:border-box;
  overflow-x:hidden!important;
  overflow-y:scroll!important;
  overscroll-behavior:contain;
  touch-action:pan-y;
  scrollbar-gutter:stable;
  scrollbar-width:thin;
  scrollbar-color:color-mix(in srgb,var(--muted) 58%,transparent) transparent;
}
#page-home #upcomingList,
#page-home #somedayHomeSlot{
  min-height:0;
}
#page-home #homeRightColumn .uw-side-toggle .card-body::-webkit-scrollbar{width:10px}
#page-home #homeRightColumn .uw-side-toggle .card-body::-webkit-scrollbar-track{background:transparent}
#page-home #homeRightColumn .uw-side-toggle .card-body::-webkit-scrollbar-thumb{
  border:2px solid transparent;
  border-radius:999px;
  background:color-mix(in srgb,var(--muted) 58%,transparent);
  background-clip:padding-box;
}
@media(max-width:1050px){
  #page-home #homeRightColumn .uw-side-toggle .card-body{
    height:auto!important;
    max-height:520px!important;
    overflow-y:auto!important;
  }
}
'''

old = '''let homeColumnResizeObserver=null,homeColumnResizeFrame=0;\nfunction syncHomeColumnHeight(){const left=$("#homeLeftColumn"),right=$("#homeRightColumn");if(!left||!right)return;if(matchMedia("(max-width:1050px)").matches){right.style.removeProperty("height");return}cancelAnimationFrame(homeColumnResizeFrame);homeColumnResizeFrame=requestAnimationFrame(()=>{const height=Math.ceil(left.getBoundingClientRect().height);if(height>0)right.style.height=`${height}px`})}\nfunction wireHomeColumnHeightSync(){const left=$("#homeLeftColumn");if(!left||homeColumnResizeObserver)return;homeColumnResizeObserver=new ResizeObserver(syncHomeColumnHeight);homeColumnResizeObserver.observe(left);window.addEventListener("resize",syncHomeColumnHeight);syncHomeColumnHeight()}'''
new = '''let homeColumnResizeObserver=null,homeColumnResizeFrame=0;\nfunction clearHomeRightSizing(right){right.style.removeProperty("height");right.querySelectorAll(".uw-side-toggle").forEach(card=>{card.style.removeProperty("height");const body=card.querySelector(".card-body");if(body){body.style.removeProperty("height");body.style.removeProperty("max-height")}})}\nfunction syncHomeColumnHeight(){const left=$("#homeLeftColumn"),right=$("#homeRightColumn");if(!left||!right)return;cancelAnimationFrame(homeColumnResizeFrame);homeColumnResizeFrame=requestAnimationFrame(()=>{if(matchMedia("(max-width:1050px)").matches){clearHomeRightSizing(right);return}const height=Math.ceil(left.getBoundingClientRect().height);if(height<=0)return;right.style.height=`${height}px`;requestAnimationFrame(()=>{right.querySelectorAll(".uw-side-toggle").forEach(card=>{const body=card.querySelector(".card-body");if(!body)return;if(!card.open){body.style.removeProperty("height");body.style.removeProperty("max-height");return}const summary=card.querySelector("summary"),cardHeight=Math.floor(card.getBoundingClientRect().height),headerHeight=Math.ceil(summary?.getBoundingClientRect().height||0),bodyHeight=Math.max(1,cardHeight-headerHeight);body.style.height=`${bodyHeight}px`;body.style.maxHeight=`${bodyHeight}px`;body.style.overflowY="scroll"})})})}\nfunction wireHomeColumnHeightSync(){const left=$("#homeLeftColumn");if(!left||homeColumnResizeObserver)return;homeColumnResizeObserver=new ResizeObserver(syncHomeColumnHeight);homeColumnResizeObserver.observe(left);window.addEventListener("resize",syncHomeColumnHeight);$$("#homeRightColumn .uw-side-toggle").forEach(card=>card.addEventListener("toggle",syncHomeColumnHeight));syncHomeColumnHeight()}'''
assert old in js, 'home height sync block not found'
js = js.replace(old, new, 1)

assert 'unified-workspace.css?v=57' in index, 'css cache target not found'
assert 'unified-workspace.js?v=83' in index, 'js cache target not found'
index = index.replace('unified-workspace.css?v=57', 'unified-workspace.css?v=58', 1)
index = index.replace('unified-workspace.js?v=83', 'unified-workspace.js?v=84', 1)

css_path.write_text(css)
js_path.write_text(js)
index_path.write_text(index)
