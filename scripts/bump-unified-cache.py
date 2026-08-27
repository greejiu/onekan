from pathlib import Path

path = Path('index.html')
text = path.read_text(encoding='utf-8')
old = './js/unified-workspace.js?v=34'
new = './js/unified-workspace.js?v=35'
count = text.count(old)
if count != 1:
    raise SystemExit(f'expected one cache reference, found {count}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('Bumped unified workspace cache to v35')
