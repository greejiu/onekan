from pathlib import Path

css_path = Path('css/unified-workspace.css')
index_path = Path('index.html')
css = css_path.read_text()
index = index_path.read_text()

marker = '/* Home planner card polish: remove header gap, keep rounded corners, text-only session toggle */'
assert marker not in css, 'home planner polish already applied'

css += '''\n\n/* Home planner card polish: remove header gap, keep rounded corners, text-only session toggle */\n#page-home #homeLeftColumn{\n  gap:0;\n}\n#page-home #homeLeftColumn .uw-home-view-controls{\n  border-radius:23px 23px 0 0;\n}\n#page-home #homeLeftColumn .uw-session-toggle,\n#page-home #homeLeftColumn .uw-session-toggle[aria-pressed="true"]{\n  border-color:transparent;\n  background:transparent;\n  color:var(--text);\n  box-shadow:none;\n}\n#page-home #homeLeftColumn .uw-session-toggle:hover{\n  background:var(--panel-soft);\n}\n@media(max-width:600px){\n  #page-home #homeLeftColumn .uw-home-view-controls{\n    border-radius:19px 19px 0 0;\n  }\n}\n'''

assert 'unified-workspace.css?v=52' in index, 'unified workspace css cache target not found'
index = index.replace('unified-workspace.css?v=52', 'unified-workspace.css?v=53', 1)

css_path.write_text(css)
index_path.write_text(index)
