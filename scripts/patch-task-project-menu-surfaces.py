from pathlib import Path
import re

context = Path('js/context-menu.js')
text = context.read_text()

old = '''  const feature = element.closest("[data-feature-kind][data-feature-id]");
  if (feature) return { kind: feature.dataset.featureKind === "event" ? "event" : "task", id: feature.dataset.featureId };

  const todayTask = element.closest("#taskList .row[data-id]");'''
new = '''  const feature = element.closest("[data-feature-kind][data-feature-id]");
  if (feature) return { kind: feature.dataset.featureKind === "event" ? "event" : "task", id: feature.dataset.featureId };

  // unified-workspace의 집/할일/일정 보기에 표시되는 기존 할일도
  // 같은 전역 우클릭 메뉴를 사용한다.
  const unifiedTask = element.closest('[data-uw-kind="task"][data-id]');
  if (unifiedTask) return { kind: "task", id: unifiedTask.dataset.id };

  const todayTask = element.closest("#taskList .row[data-id]");'''
if old not in text:
    raise SystemExit('resolveDirect marker not found')
text = text.replace(old, new, 1)

old = '''    "[data-context-kind][data-context-id]",
    "#taskList .row[data-id]",'''
new = '''    "[data-context-kind][data-context-id]",
    '[data-uw-kind="task"][data-id]',
    "#taskList .row[data-id]",'''
if old not in text:
    raise SystemExit('supported surface marker not found')
text = text.replace(old, new, 1)
context.write_text(text)

index = Path('index.html')
html = index.read_text()
html, count = re.subn(r'\.\/js\/context-menu\.js\?v=\d+', './js/context-menu.js?v=26', html, count=1)
if count != 1:
    raise SystemExit('context-menu cache marker not found')
index.write_text(html)
