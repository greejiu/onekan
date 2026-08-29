from pathlib import Path

controls = Path('js/task-input-controls.js')
text = controls.read_text()
old = '    .uw-inline-form.uw-task-compact-input>input[type="text"]{min-width:0;flex:1}\n'
new = old + '    .uw-inline-form .uw-project-select{display:none!important}\n'
if old not in text:
    raise SystemExit('task input style marker not found')
text = text.replace(old, new, 1)
controls.write_text(text)

interaction = Path('js/interaction-fixes.js')
text = interaction.read_text()
if './task-input-controls.js?v=3' not in text:
    raise SystemExit('task input cache marker not found')
text = text.replace('./task-input-controls.js?v=3', './task-input-controls.js?v=4', 1)
interaction.write_text(text)

index = Path('index.html')
text = index.read_text()
if './js/interaction-fixes.js?v=35' not in text:
    raise SystemExit('interaction cache marker not found')
text = text.replace('./js/interaction-fixes.js?v=35', './js/interaction-fixes.js?v=36', 1)
index.write_text(text)
