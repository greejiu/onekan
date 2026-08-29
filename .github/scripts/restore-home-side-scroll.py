from pathlib import Path

css_path = Path('css/unified-workspace.css')
index_path = Path('index.html')
css = css_path.read_text()
index = index_path.read_text()

marker = '/* Home right cards: fixed visible internal scrollbar */'
assert marker not in css, 'home side scroll fix already applied'

css += '''\n\n/* Home right cards: fixed visible internal scrollbar */\n#page-home #homeRightColumn .uw-side-toggle[open]{\n  height:100%;\n  min-height:0;\n  max-height:100%;\n  overflow:hidden;\n}\n#page-home #homeRightColumn .uw-side-toggle .card-body{\n  flex:1 1 0!important;\n  height:0!important;\n  min-height:0!important;\n  max-height:none!important;\n  overflow-x:hidden!important;\n  overflow-y:scroll!important;\n  scrollbar-gutter:stable!important;\n}\n@media(max-width:1050px){\n  #page-home #homeRightColumn .uw-side-toggle[open]{\n    height:auto;\n    max-height:none;\n  }\n  #page-home #homeRightColumn .uw-side-toggle .card-body{\n    flex:none!important;\n    height:auto!important;\n    max-height:520px!important;\n    overflow-y:auto!important;\n  }\n}\n'''

assert 'unified-workspace.css?v=54' in index, 'unified workspace css cache target not found'
index = index.replace('unified-workspace.css?v=54', 'unified-workspace.css?v=55', 1)

css_path.write_text(css)
index_path.write_text(index)
