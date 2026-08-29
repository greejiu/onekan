from pathlib import Path
import re


def sub_once(text, pattern, replacement, label, flags=0):
    new_text, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 replacement, got {count}")
    return new_text

project_path = Path("js/project-status.js")
context_path = Path("js/context-menu.js")
index_path = Path("index.html")

project = project_path.read_text()
context = context_path.read_text()
index = index_path.read_text()

# Project areas now reuse the shared areas configured in Settings (state.eventGroups).
project = project.replace('const DEFAULT_GROUP_ID = "project-group-inbox";\n', '')

project = sub_once(
    project,
    r'''function projectGroupId\(project\) \{.*?\n\}\n\nasync function readState\(\) \{''',
    '''function groupsOf(current = state) {\n  const groups = Array.isArray(current?.eventGroups) && current.eventGroups.length\n    ? [...current.eventGroups]\n    : [{ id: "default", name: DEFAULT_GROUP_LABEL, color: DEFAULT_GROUP_COLOR }];\n  return groups;\n}\n\nfunction defaultGroupId(current = state) {\n  return groupsOf(current)[0]?.id || "default";\n}\n\nfunction projectGroupId(project, current = state) {\n  const groups = groupsOf(current);\n  return groups.some((group) => group.id === project?.groupId) ? project.groupId : (groups[0]?.id || "default");\n}\n\nfunction ensureWritableStructure(current) {\n  current.projects = Array.isArray(current.projects) ? current.projects : [];\n  current.eventGroups = Array.isArray(current.eventGroups) && current.eventGroups.length\n    ? current.eventGroups\n    : [{ id: "default", name: DEFAULT_GROUP_LABEL, color: DEFAULT_GROUP_COLOR }];\n}\n\nasync function readState() {''',
    "replace project area helpers",
    flags=re.S,
)

project = project.replace(
    '  state.projects = Array.isArray(state.projects) ? state.projects : [];\n  return state;\n',
    '  state.projects = Array.isArray(state.projects) ? state.projects : [];\n  state.eventGroups = Array.isArray(state.eventGroups) && state.eventGroups.length ? state.eventGroups : [{ id: "default", name: DEFAULT_GROUP_LABEL, color: DEFAULT_GROUP_COLOR }];\n  return state;\n',
    1,
)

old_group_render = '''  const groups = groupsOf();\n  return `${toolbar}<section class="onekan-project-group-view"><div class="onekan-project-groups">${groups.map((group) => groupBlock(group, projects, activeFilter)).join("")}</div><button class="onekan-project-group-add" type="button" data-project-group-add>＋ 영역 추가</button></section>`;'''
new_group_render = '''  const groups = groupsOf().filter((group) => projects.some((project) => normalizeStatus(project.status) === activeFilter && projectGroupId(project) === group.id));\n  const groupsMarkup = groups.length ? groups.map((group) => groupBlock(group, projects, activeFilter)).join("") : '<div class="onekan-project-empty">이 상태의 프로젝트가 없어요.</div>';\n  return `${toolbar}<section class="onekan-project-group-view"><div class="onekan-project-groups">${groupsMarkup}</div></section>`;'''
if old_group_render not in project:
    raise SystemExit("group render block not found")
project = project.replace(old_group_render, new_group_render, 1)

project = project.replace(
    'async function openEditor({ projectId = null, status = "doing", groupId = DEFAULT_GROUP_ID, focusPeriod = false } = {}) {',
    'async function openEditor({ projectId = null, status = "doing", groupId = null, focusPeriod = false } = {}) {',
    1,
)
project = project.replace(
    '  fillGroupSelect(project ? projectGroupId(project) : groupId);',
    '  fillGroupSelect(project ? projectGroupId(project) : (groupId || defaultGroupId()));',
    1,
)
project = project.replace(
    '  const groupId = $("#onekanProjectGroup", dialog)?.value || DEFAULT_GROUP_ID;',
    '  const groupId = $("#onekanProjectGroup", dialog)?.value || defaultGroupId();',
    1,
)
project = project.replace(
    '        project.projectGroupId = groupId;',
    '        project.groupId = groupId;\n        delete project.projectGroupId;',
    1,
)
project = project.replace(
    '        current.projects.push({ id: uid(), kind: "project", title, status, projectGroupId: groupId, startDate, endDate, createdAt: new Date().toISOString() });',
    '        current.projects.push({ id: uid(), kind: "project", title, status, groupId, startDate, endDate, createdAt: new Date().toISOString() });',
    1,
)

project = sub_once(
    project,
    r'''async function addGroup\(\) \{.*?\n\}\n\n(?=async function moveProject)''',
    '',
    "remove project-only area creator",
    flags=re.S,
)

project = project.replace(
    '      if (groupId) project.projectGroupId = groupId;',
    '      if (groupId) {\n        project.groupId = groupId;\n        delete project.projectGroupId;\n      }',
    1,
)
project = project.replace(
    '    if (addStatus) return openEditor({ status: addStatus.dataset.projectAddStatus, groupId: DEFAULT_GROUP_ID });',
    '    if (addStatus) return openEditor({ status: addStatus.dataset.projectAddStatus, groupId: defaultGroupId() });',
    1,
)
project = project.replace('    if (event.target.closest("[data-project-group-add]")) return addGroup();\n', '', 1)

# Right-click area choices for projects also reuse Settings areas.
context = sub_once(
    context,
    r'''function renderGroupChoices\(state, target\) \{.*?\n\}\n\nfunction renderProjectChoices''',
    '''function renderGroupChoices(state, target) {\n  const menu = $("#globalContextMenu");\n  const groupButton = menu?.querySelector('[data-context-action="groups"]');\n  const groupList = $("#contextGroupList");\n  const item = getItem(state, target);\n  const groups = Array.isArray(state?.eventGroups) ? state.eventGroups : [];\n  const available = groupable(target.kind) && groups.length > 0;\n  if (groupButton) {\n    groupButton.classList.toggle("hidden", !available);\n    groupButton.innerHTML = `영역 <span class="context-menu-arrow">›</span>`;\n  }\n  groupList?.classList.add("hidden");\n  if (!available || !groupList) {\n    if (groupList) groupList.innerHTML = "";\n    return;\n  }\n  const selectedId = item?.groupId || groups[0]?.id;\n  groupList.innerHTML = groups.map((group) => `<button type="button" role="menuitemradio" aria-checked="${group.id === selectedId}" data-context-group-id="${escapeAttr(group.id)}"><span class="context-group-dot" style="--group-color:${escapeAttr(group.color || "#8fa9c4")}"></span><span>${escapeAttr(group.name)}</span>${group.id === selectedId ? '<span class="context-group-check">✓</span>' : ""}</button>`).join("");\n}\n\nfunction renderProjectChoices''',
    "replace context area choices",
    flags=re.S,
)

old_change = '''      if (target.kind === "project" && item.kind === "project") {\n        if (!state.projectGroups?.some((group) => group.id === groupId)) return;\n        item.projectGroupId = groupId;\n      } else {\n        if (!state.eventGroups?.some((group) => group.id === groupId)) return;\n        item.groupId = groupId;\n      }'''
new_change = '''      if (!state.eventGroups?.some((group) => group.id === groupId)) return;\n      item.groupId = groupId;\n      if (target.kind === "project") delete item.projectGroupId;'''
if old_change not in context:
    raise SystemExit("context group update block not found")
context = context.replace(old_change, new_change, 1)

# Cache bust the two changed modules.
if './js/project-status.js?v=4' not in index:
    raise SystemExit("project-status cache marker missing")
if './js/context-menu.js?v=27' not in index:
    raise SystemExit("context-menu cache marker missing")
index = index.replace('./js/project-status.js?v=4', './js/project-status.js?v=5', 1)
index = index.replace('./js/context-menu.js?v=27', './js/context-menu.js?v=28', 1)

# Guardrails for the intended architecture.
if 'projectGroups' in project:
    raise SystemExit("project-status still references projectGroups")
if 'data-project-group-add' in project:
    raise SystemExit("project-only area add UI still present")
if 'usesProjectGroups' in context or 'state.projectGroups?.some' in context:
    raise SystemExit("context menu still uses project-only groups")
if 'groupId, startDate' not in project:
    raise SystemExit("new project does not persist shared groupId")

project_path.write_text(project)
context_path.write_text(context)
index_path.write_text(index)
