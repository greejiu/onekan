from pathlib import Path

ROOT = Path('.')
app_path = ROOT / 'js/app.js'
index_path = ROOT / 'index.html'

app = app_path.read_text(encoding='utf-8')
old = '  const activeHabits = state.habitTemplates.filter((habit) => habitOccursOnDate(habit, dayKey));'
new = '''  const activeHabits = state.habitTemplates.filter((habit) =>
    habitOccursOnDate(habit, dayKey) &&
    !Boolean(state.habitDays?.[dayKey]?.[habit.id]) &&
    !Boolean(state.habitOverrides?.[dayKey]?.[habit.id]?.hidden)
  );'''
if app.count(old) != 1:
    raise SystemExit(f'expected activeHabits line once, found {app.count(old)}')
app = app.replace(old, new, 1)
app_path.write_text(app, encoding='utf-8')

index = index_path.read_text(encoding='utf-8')
old_version = 'js/app.js?v=34'
new_version = 'js/app.js?v=35'
if index.count(old_version) != 1:
    raise SystemExit(f'expected app cache version once, found {index.count(old_version)}')
index = index.replace(old_version, new_version, 1)
index_path.write_text(index, encoding='utf-8')

print('Filtered completed/hidden habits from time tracking')
