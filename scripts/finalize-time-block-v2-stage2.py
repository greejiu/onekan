from pathlib import Path

uw_path = Path('js/unified-workspace.js')
uw = uw_path.read_text(encoding='utf-8')
old = '${picker}<button class="uw-move-handle" type="button" aria-label="길게 눌러 이동">↕</button><button class="uw-select-circle" type="button" aria-label="선택"></button></div>`\n}\nfunction timeBlockV2ManualGroup'
new = '${picker}<button class="uw-select-circle" type="button" aria-label="선택"></button></div>`\n}\nfunction timeBlockV2ManualGroup'
if old not in uw:
    raise SystemExit('V2 move handle anchor not found')
uw = uw.replace(old, new, 1)
uw_path.write_text(uw, encoding='utf-8')

index_path = Path('index.html')
index = index_path.read_text(encoding='utf-8')
old_version = './js/unified-workspace.js?v=37'
new_version = './js/unified-workspace.js?v=38'
if old_version not in index:
    raise SystemExit('unified cache anchor not found')
index = index.replace(old_version, new_version, 1)
index_path.write_text(index, encoding='utf-8')
