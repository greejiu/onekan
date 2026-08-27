from pathlib import Path

path = Path('js/unified-workspace.js')
text = path.read_text(encoding='utf-8')
old = '          const eventDate=selectedDate||key(new Date(target.start));'
new = '          const eventDate=old.recurrence?.frequency&&!dateChanged?key(new Date(target.start)):(selectedDate||key(new Date(target.start)));'
count = text.count(old)
if count != 1:
    raise SystemExit(f'expected one recurring event date assignment, found {count}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('Fixed whole recurring event edit so it preserves the series start date unless the date was explicitly changed.')
