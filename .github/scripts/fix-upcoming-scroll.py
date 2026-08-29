from pathlib import Path

css_path = Path('css/unified-workspace.css')
index_path = Path('index.html')
css = css_path.read_text()
index = index_path.read_text()

marker = '/* Home right cards: reliable half-height internal scrolling */'
assert marker not in css, 'upcoming scroll fix already applied'

css += '''\n\n/* Home right cards: reliable half-height internal scrolling */\n#page-home #homeRightColumn .uw-side-toggle[open]{\n  min-height:0;\n  overflow:hidden;\n}\n#page-home #homeRightColumn .uw-side-toggle .card-body{\n  flex:1 1 auto;\n  height:auto;\n  min-height:0;\n  max-height:none;\n  overflow-x:hidden;\n  overflow-y:auto;\n}\n#page-home #upcomingList,\n#page-home #somedayHomeSlot{\n  min-height:0;\n}\n@media(max-width:1050px){\n  #page-home #homeRightColumn .uw-side-toggle .card-body{\n    flex:none;\n    height:auto;\n    max-height:520px;\n  }\n}\n'''

assert 'unified-workspace.css?v=53' in index, 'unified workspace css cache target not found'
index = index.replace('unified-workspace.css?v=53', 'unified-workspace.css?v=54', 1)

css_path.write_text(css)
index_path.write_text(index)
