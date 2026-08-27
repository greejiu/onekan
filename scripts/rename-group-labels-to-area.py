from pathlib import Path
import re

ROOT = Path('.')
index_path = ROOT / 'index.html'
index = index_path.read_text(encoding='utf-8')

changed_js = []
changed_files = []

# Only change the Korean user-facing concept name. Internal identifiers such as
# groupId/eventGroups/data-group-* remain untouched.
for path in [index_path, *sorted((ROOT / 'js').glob('*.js'))]:
    text = path.read_text(encoding='utf-8')
    if '그룹' not in text:
        continue
    updated = text.replace('그룹', '영역')
    if updated == text:
        continue
    path.write_text(updated, encoding='utf-8')
    changed_files.append(str(path))
    if path.suffix == '.js':
        changed_js.append(str(path).replace('\\', '/'))

# Bump cache versions only for JS files actually changed and referenced by index.html.
index = index_path.read_text(encoding='utf-8')
for js_path in changed_js:
    pattern = re.compile(r'(src="\./' + re.escape(js_path) + r'\?v=)(\d+)(")')
    match = pattern.search(index)
    if match:
        next_version = int(match.group(2)) + 1
        index = pattern.sub(lambda m: f'{m.group(1)}{next_version}{m.group(3)}', index, count=1)
index_path.write_text(index, encoding='utf-8')

# Guardrails: no internal schema rename.
for path in [index_path, *sorted((ROOT / 'js').glob('*.js'))]:
    text = path.read_text(encoding='utf-8')
    if 'areaId' in text or 'eventAreas' in text:
        raise SystemExit(f'unexpected data-structure rename in {path}')

print('Changed files:')
for path in changed_files:
    print(' -', path)
print('Changed JS:', ', '.join(changed_js) or '(none)')

remaining = []
for path in [index_path, *sorted((ROOT / 'js').glob('*.js'))]:
    text = path.read_text(encoding='utf-8')
    if '그룹' in text:
        remaining.append(str(path))
if remaining:
    raise SystemExit('Remaining Korean 그룹 labels: ' + ', '.join(remaining))
