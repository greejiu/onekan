from pathlib import Path

css_path = Path('css/unified-workspace.css')
index_path = Path('index.html')
css = css_path.read_text()
index = index_path.read_text()

bad_marker = '/* Home right cards: fixed visible internal scrollbar */'
assert bad_marker in css, 'broken scrollbar block not found'
css = css.split(bad_marker, 1)[0].rstrip() + '''\n\n/* Home right cards: fixed half-height scroll regions */\n#page-home #homeRightColumn .uw-side-toggle[open]{\n  min-height:0;\n  overflow:hidden;\n}\n#page-home #homeRightColumn .uw-side-toggle .card-body{\n  flex:1 1 auto;\n  min-height:0;\n  height:auto;\n  max-height:none;\n  overflow-x:hidden;\n  overflow-y:scroll;\n  overscroll-behavior:contain;\n  scrollbar-gutter:stable;\n  scrollbar-width:thin;\n  scrollbar-color:var(--line-strong) transparent;\n}\n#page-home #homeRightColumn .uw-side-toggle .card-body::-webkit-scrollbar{width:9px}\n#page-home #homeRightColumn .uw-side-toggle .card-body::-webkit-scrollbar-track{background:transparent}\n#page-home #homeRightColumn .uw-side-toggle .card-body::-webkit-scrollbar-thumb{\n  border:2px solid transparent;\n  border-radius:999px;\n  background:var(--line-strong);\n  background-clip:padding-box;\n}\n@media(max-width:1050px){\n  #page-home #homeRightColumn .uw-side-toggle .card-body{\n    flex:none;\n    height:auto;\n    max-height:520px;\n    overflow-y:auto;\n  }\n}\n'''

assert 'unified-workspace.css?v=55' in index, 'css cache version target not found'
index = index.replace('unified-workspace.css?v=55', 'unified-workspace.css?v=56', 1)

css_path.write_text(css)
index_path.write_text(index)
