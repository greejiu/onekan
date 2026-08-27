from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"missing replacement target: {label}")
    return text.replace(old, new, 1)

app_path = Path("js/app.js")
app = app_path.read_text()

app = replace_once(
    app,
    "  // 이전 시간블럭 템플릿을 새 타임라인 블록으로 한 번만 옮긴다.\n",
    "  const normalizedSessionGroupId = normalized.eventGroups[0]?.id || \"default\";\n  normalized.sessions = normalized.sessions.map((session) => ({ ...session, groupId: session.groupId || normalizedSessionGroupId }));\n\n  // 이전 시간블럭 템플릿을 새 타임라인 블록으로 한 번만 옮긴다.\n",
    "normalize session groups",
)

app = replace_once(
    app,
    '    state.sessions.push({ id: uid(), taskId: timer.taskId || null, title: task?.title || timer.title || "집중 기록", start: new Date(Date.now() - duration).toISOString(), end: new Date().toISOString(), durationMs: duration, timerMode: mode });',
    '    const groupId = task?.groupId || state.eventGroups[0]?.id || "default";\n    state.sessions.push({ id: uid(), taskId: timer.taskId || null, groupId, title: task?.title || timer.title || "집중 기록", start: new Date(Date.now() - duration).toISOString(), end: new Date().toISOString(), durationMs: duration, timerMode: mode });',
    "timer session group",
)

app = replace_once(
    app,
    '  const rowMarkup = (session) => `<div class="history-row editable-row" data-context-kind="session" data-context-id="${session.id}"><div><div class="history-name">${esc(session.title)}</div><div class="history-meta">${sessionPeriod(session)}</div></div><div class="history-time">${fmtDuration(session.durationMs)}</div></div>`;',
    '  const rowMarkup = (session) => { const group = eventGroupFor(session); return `<div class="history-row editable-row" data-context-kind="session" data-context-id="${session.id}"><div><div class="history-name">${esc(session.title)}</div><div class="history-meta"><span aria-hidden="true" style="display:inline-block;width:7px;height:7px;margin-right:4px;border-radius:50%;background:${safeColor(group.color)}"></span>${esc(group.name)} · ${sessionPeriod(session)}</div></div><div class="history-time">${fmtDuration(session.durationMs)}</div></div>`; };',
    "session row group display",
)

app = replace_once(
    app,
    '      <label><span>기록 이름</span><input id="manualSessionTitle" type="text" required maxlength="80" placeholder="무엇을 했나요?"></label>\n      <label><span>날짜</span><input id="manualSessionDate" type="date" required></label>',
    '      <label><span>기록 이름</span><input id="manualSessionTitle" type="text" required maxlength="80" placeholder="무엇을 했나요?"></label>\n      <label><span>그룹</span><select id="manualSessionGroup" required></select></label>\n      <label><span>날짜</span><input id="manualSessionDate" type="date" required></label>',
    "manual dialog group field",
)

app = replace_once(
    app,
    '    const title = $("#manualSessionTitle", dialog).value.trim();\n    const date = $("#manualSessionDate", dialog).value;',
    '    const title = $("#manualSessionTitle", dialog).value.trim();\n    const groupId = $("#manualSessionGroup", dialog).value || state.eventGroups[0]?.id || "default";\n    const date = $("#manualSessionDate", dialog).value;',
    "manual submit group value",
)

app = replace_once(
    app,
    '      session.title = title;\n      session.start = start.toISOString();',
    '      session.title = title;\n      session.groupId = groupId;\n      session.start = start.toISOString();',
    "edit session group",
)

app = replace_once(
    app,
    '        taskId: null,\n        title,',
    '        taskId: null,\n        groupId,\n        title,',
    "new manual session group",
)

app = replace_once(
    app,
    '  $("#manualSessionTitle", dialog).value = "";\n  $("#manualSessionDate", dialog).value = localDateKey(date);',
    '  $("#manualSessionTitle", dialog).value = "";\n  $("#manualSessionGroup", dialog).innerHTML = eventGroupOptions(state.eventGroups[0]?.id || "default");\n  $("#manualSessionGroup", dialog).value = state.eventGroups[0]?.id || "default";\n  $("#manualSessionDate", dialog).value = localDateKey(date);',
    "manual open group options",
)

app = replace_once(
    app,
    '  $("#manualSessionDialogTitle", dialog).textContent = "시간 기록 변경";\n  $("#manualSessionTitle", dialog).value = session.title || "";\n  $("#manualSessionDate", dialog).value = localDateKey(start);',
    '  $("#manualSessionDialogTitle", dialog).textContent = "기록 변경";\n  $("#manualSessionTitle", dialog).value = session.title || "";\n  $("#manualSessionGroup", dialog).innerHTML = eventGroupOptions(session.groupId || state.eventGroups[0]?.id || "default");\n  $("#manualSessionGroup", dialog).value = session.groupId || state.eventGroups[0]?.id || "default";\n  $("#manualSessionDate", dialog).value = localDateKey(start);',
    "editor title and group",
)

app = replace_once(
    app,
    '  for (const selector of ["#timelineEventGroup"]) {',
    '  for (const selector of ["#timelineEventGroup", "#manualSessionGroup"]) {',
    "refresh session group input",
)

app = replace_once(
    app,
    '      state.projects.forEach((project) => { if (project.groupId === id) project.groupId = state.eventGroups[0].id; });\n      state.eventGroups = state.eventGroups.filter((group) => group.id !== id);',
    '      state.projects.forEach((project) => { if (project.groupId === id) project.groupId = state.eventGroups[0].id; });\n      state.sessions.forEach((session) => { if (session.groupId === id) session.groupId = state.eventGroups[0].id; });\n      state.eventGroups = state.eventGroups.filter((group) => group.id !== id);',
    "group deletion session fallback",
)

app_path.write_text(app)

context_path = Path("js/context-menu.js")
context = context_path.read_text()
context = replace_once(
    context,
    'function groupable(kind) {\n  return kind === "task" || kind === "event" || kind === "project";\n}',
    'function groupable(kind) {\n  return kind === "task" || kind === "event" || kind === "project" || kind === "session";\n}',
    "session groupable",
)
context = replace_once(
    context,
    '<button type="button" role="menuitem" class="hidden" data-context-action="session-time">시간 변경</button>',
    '<button type="button" role="menuitem" class="hidden" data-context-action="session-time">기록 변경</button>',
    "rename session edit menu",
)
context_path.write_text(context)

index_path = Path("index.html")
index = index_path.read_text()
index = replace_once(index, 'js/app.js?v=31', 'js/app.js?v=32', 'app cache bump')
index = replace_once(index, 'js/context-menu.js?v=17', 'js/context-menu.js?v=18', 'context cache bump')
index_path.write_text(index)
