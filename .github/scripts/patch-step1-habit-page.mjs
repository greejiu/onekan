import fs from 'node:fs';

function replaceRequired(text, before, after, label) {
  if (!text.includes(before)) throw new Error(`missing target: ${label}`);
  return text.replace(before, after);
}

let index = fs.readFileSync('index.html', 'utf8');
index = replaceRequired(
  index,
  '<button class="nav-item" data-page="repeat" type="button"><span class="nav-icon">↻</span><span class="nav-label">반복 관리</span></button>',
  '<button class="nav-item" data-page="repeat" type="button"><span class="nav-icon">↻</span><span class="nav-label">습관</span></button>',
  'repeat nav label',
);
index = replaceRequired(
  index,
  '<section class="page" id="page-repeat">\n        <div class="page-head"><div><h1 class="page-title">반복</h1></div></div>\n        <p class="onekan-repeat-intro">반복되는 할일과 일정을 한 곳에서 확인해요. 지금은 기존 반복 항목을 모아보는 단계예요.</p>\n        <div class="onekan-repeat-grid" id="repeatOverviewBody"></div>\n      </section>',
  '<section class="page" id="page-repeat">\n        <div class="page-head"><div><h1 class="page-title">습관</h1></div></div>\n        <p class="onekan-repeat-intro">습관만 이곳에서 관리해요. 반복 할일은 할일에서, 반복 일정은 일정에서 관리합니다.</p>\n        <div class="onekan-repeat-grid" id="repeatOverviewBody"></div>\n      </section>',
  'repeat page shell',
);
index = replaceRequired(index, './js/repeat-overview.js?v=3', './js/repeat-overview.js?v=4', 'repeat overview cache');
fs.writeFileSync('index.html', index);

let repeat = fs.readFileSync('js/repeat-overview.js', 'utf8');
repeat = replaceRequired(
  repeat,
  '.onekan-repeat-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;align-items:start}',
  '.onekan-repeat-grid{display:grid;grid-template-columns:minmax(0,720px);gap:14px;align-items:start}',
  'habit page grid',
);
repeat = replaceRequired(
  repeat,
  '    @media(max-width:1080px){.onekan-repeat-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}\n    @media(max-width:760px){.onekan-repeat-grid{grid-template-columns:1fr}.onekan-repeat-row{min-height:56px}}',
  '    @media(max-width:760px){.onekan-repeat-grid{grid-template-columns:1fr}.onekan-repeat-row{min-height:56px}}',
  'habit grid media',
);
repeat = replaceRequired(
  repeat,
  '      host.innerHTML = \'<div class="onekan-repeat-empty">로그인 후 반복 항목을 확인할 수 있어요.</div>\';',
  '      host.innerHTML = \'<div class="onekan-repeat-empty">로그인 후 습관을 확인할 수 있어요.</div>\';',
  'habit logged out copy',
);
repeat = replaceRequired(
  repeat,
  '    const recurringTasks = (Array.isArray(state.tasks) ? state.tasks : []).filter((item) => item.recurrence?.frequency && item.recurrence.frequency !== "none").sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "ko"));\n    const tasks = recurringTasks.filter((item) => !item.isHabit);\n    const habits = recurringTasks.filter((item) => item.isHabit);\n    const events = (Array.isArray(state.events) ? state.events : []).filter((item) => item.recurrence?.frequency && item.recurrence.frequency !== "none").sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "ko"));\n    host.innerHTML = sectionMarkup(state, "반복 할일", tasks, "task") + sectionMarkup(state, "습관", habits, "task") + sectionMarkup(state, "반복 일정", events, "event");',
  '    const habits = (Array.isArray(state.tasks) ? state.tasks : [])\n      .filter((item) => item.isHabit && !item.done && item.recurrence?.frequency && item.recurrence.frequency !== "none")\n      .sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "ko"));\n    host.innerHTML = sectionMarkup(state, "습관", habits, "task");',
  'habit-only render',
);
repeat = replaceRequired(
  repeat,
  '    console.error("repeat overview load failed", error);\n    host.innerHTML = \'<div class="onekan-repeat-empty">반복 항목을 불러오지 못했어요.</div>\';',
  '    console.error("habit overview load failed", error);\n    host.innerHTML = \'<div class="onekan-repeat-empty">습관을 불러오지 못했어요.</div>\';',
  'habit error copy',
);
fs.writeFileSync('js/repeat-overview.js', repeat);
