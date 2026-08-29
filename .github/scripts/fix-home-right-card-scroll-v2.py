from pathlib import Path

css_path = Path('css/unified-workspace.css')
index_path = Path('index.html')

css = css_path.read_text()
index = index_path.read_text()

marker = '/* Home right cards: reliable half-height internal scrolling */'
assert marker in css, 'home right card scroll marker not found'

css = css.split(marker, 1)[0].rstrip() + '''

/* Home right cards: reliable half-height internal scrolling */
#page-home #homeRightColumn .uw-side-toggle[open]{
  display:grid;
  grid-template-rows:auto minmax(0,1fr);
  min-height:0;
  overflow:hidden;
}
#page-home #homeRightColumn .uw-side-toggle .card-body{
  min-width:0;
  min-height:0;
  height:auto;
  max-height:none;
  overflow-x:hidden;
  overflow-y:scroll;
  overscroll-behavior:contain;
  scrollbar-gutter:stable;
  scrollbar-width:thin;
  scrollbar-color:var(--line-strong) transparent;
}
#page-home #upcomingList,
#page-home #somedayHomeSlot{
  min-height:0;
}
#page-home #homeRightColumn .uw-side-toggle .card-body::-webkit-scrollbar{width:9px}
#page-home #homeRightColumn .uw-side-toggle .card-body::-webkit-scrollbar-track{background:transparent}
#page-home #homeRightColumn .uw-side-toggle .card-body::-webkit-scrollbar-thumb{
  border:2px solid transparent;
  border-radius:999px;
  background:var(--line-strong);
  background-clip:padding-box;
}
@media(max-width:1050px){
  #page-home #homeRightColumn .uw-side-toggle .card-body{
    max-height:520px;
    overflow-y:auto;
  }
}
'''

assert 'unified-workspace.css?v=56' in index, 'css cache version target not found'
index = index.replace('unified-workspace.css?v=56', 'unified-workspace.css?v=57', 1)

css_path.write_text(css)
index_path.write_text(index)
