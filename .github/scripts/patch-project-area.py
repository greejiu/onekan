from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing patch target: {label}")
    return text.replace(old, new, 1)

status_path = Path("js/project-status.js")
src = status_path.read_text(encoding="utf-8")

src = replace_once(
    src,
    'const DEFAULT_GROUP_ID = "project-group-inbox";\nconst DEFAULT_GROUP_COLOR = "#8fa9c4";',
    'const DEFAULT_GROUP_ID = "project-group-inbox";\nconst DEFAULT_GROUP_LABEL = "기본";\nconst DEFAULT_GROUP_COLOR = "#8fa9c4";',
    "default area label",
)

src = src.replace('name: "미분류", color: DEFAULT_GROUP_COLOR, system: true, order: -1', 'name: DEFAULT_GROUP_LABEL, color: DEFAULT_GROUP_COLOR, system: true, order: -1')

src = replace_once(
    src,
    '  return groups.sort((a, b) => Number(a.order || 0) - Number(b.order || 0) || String(a.name || "").localeCompare(String(b.name || ""), "ko"));',
    '  return groups.map((group) => group.id === DEFAULT_GROUP_ID && (!group.name || group.name === "미분류") ? { ...group, name: DEFAULT_GROUP_LABEL } : group).sort((a, b) => Number(a.order || 0) - Number(b.order || 0) || String(a.name || "").localeCompare(String(b.name || ""), "ko"));',
    "default area display",
)

src = replace_once(
    src,
    '  if (!current.projectGroups.some((group) => group.id === DEFAULT_GROUP_ID)) {\n    current.projectGroups.unshift({ id: DEFAULT_GROUP_ID, name: DEFAULT_GROUP_LABEL, color: DEFAULT_GROUP_COLOR, system: true, order: -1 });\n  }',
    '  const defaultGroup = current.projectGroups.find((group) => group.id === DEFAULT_GROUP_ID);\n  if (!defaultGroup) {\n    current.projectGroups.unshift({ id: DEFAULT_GROUP_ID, name: DEFAULT_GROUP_LABEL, color: DEFAULT_GROUP_COLOR, system: true, order: -1 });\n  } else if (!defaultGroup.name || defaultGroup.name === "미분류") {\n    defaultGroup.name = DEFAULT_GROUP_LABEL;\n  }',
    "persist default area label",
)

src = src.replace('esc(group.name || "미분류")', 'esc(group.name || DEFAULT_GROUP_LABEL)')
src = src.replace('>＋ 그룹 추가<', '>＋ 영역 추가<')
src = src.replace('<label>그룹<select id="onekanProjectGroup"></select></label>', '<label>영역<select id="onekanProjectGroup"></select></label>')
src = src.replace('esc(group.name || "미분류")', 'esc(group.name || DEFAULT_GROUP_LABEL)')

src = replace_once(
    src,
    '<div class="onekan-project-dialog-actions"><button class="soft-btn" value="cancel" type="submit">취소</button><button class="primary-btn" id="onekanProjectSave" type="button">저장</button></div>',
    '<div class="onekan-project-dialog-actions"><button class="soft-btn" id="onekanProjectCancel" type="button">취소</button><button class="primary-btn" id="onekanProjectSave" type="button">저장</button></div>',
    "cancel button",
)

src = replace_once(
    src,
    '  $("#onekanProjectSave", dialog).addEventListener("click", saveEditor);\n  dialog.addEventListener("close", () => { editingProjectId = null; });',
    '  $("#onekanProjectCancel", dialog).addEventListener("click", () => dialog.close());\n  $("#onekanProjectSave", dialog).addEventListener("click", saveEditor);\n  dialog.addEventListener("close", () => { editingProjectId = null; });',
    "cancel handler",
)

src = src.replace('window.prompt("새 그룹 이름을 입력해 주세요.")', 'window.prompt("새 영역 이름을 입력해 주세요.")')
src = src.replace('console.error("프로젝트 그룹 추가 실패", error);', 'console.error("프로젝트 영역 추가 실패", error);')
src = src.replace('showToast("그룹을 추가하지 못했어요.");', 'showToast("영역을 추가하지 못했어요.");')
status_path.write_text(src, encoding="utf-8")

menu_path = Path("js/context-menu.js")
menu = menu_path.read_text(encoding="utf-8")
menu = replace_once(
    menu,
    'groupButton.innerHTML = `${usesProjectGroups ? "그룹" : "영역"} <span class="context-menu-arrow">›</span>`;',
    'groupButton.innerHTML = `영역 <span class="context-menu-arrow">›</span>`;',
    "context menu area label",
)
menu = replace_once(
    menu,
    'groupList.innerHTML = groups.map((group) => `<button type="button" role="menuitemradio" aria-checked="${group.id === selectedId}" data-context-group-id="${escapeAttr(group.id)}"><span class="context-group-dot" style="--group-color:${escapeAttr(group.color || "#8fa9c4")}"></span><span>${escapeAttr(group.name)}</span>${group.id === selectedId ? \'<span class="context-group-check">✓</span>\' : ""}</button>`).join("");',
    'groupList.innerHTML = groups.map((group) => `<button type="button" role="menuitemradio" aria-checked="${group.id === selectedId}" data-context-group-id="${escapeAttr(group.id)}"><span class="context-group-dot" style="--group-color:${escapeAttr(group.color || "#8fa9c4")}"></span><span>${escapeAttr(usesProjectGroups && group.id === "project-group-inbox" && (!group.name || group.name === "미분류") ? "기본" : group.name)}</span>${group.id === selectedId ? \'<span class="context-group-check">✓</span>\' : ""}</button>`).join("");',
    "context menu default area label",
)
menu_path.write_text(menu, encoding="utf-8")

index_path = Path("index.html")
index = index_path.read_text(encoding="utf-8")
index = replace_once(index, './js/context-menu.js?v=26', './js/context-menu.js?v=27', "context menu cache")
index = replace_once(index, './js/project-status.js?v=3', './js/project-status.js?v=4', "project status cache")
index_path.write_text(index, encoding="utf-8")
