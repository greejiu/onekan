from pathlib import Path

app_path = Path('js/app.js')
style_path = Path('css/style.css')
index_path = Path('index.html')

app = app_path.read_text()
style = style_path.read_text()
index = index_path.read_text()

old_markup = '''    groupList.innerHTML = state.eventGroups.map((group, index) => `<div class="event-group-row" data-event-group-id="${esc(group.id)}">\n      <div class="event-group-order" aria-label="영역 순서">\n        <button class="ghost-btn" type="button" data-event-group-up aria-label="${esc(group.name)} 위로 이동" title="위로"${index <= 1 ? " disabled" : ""}>↑</button>\n        <button class="ghost-btn" type="button" data-event-group-down aria-label="${esc(group.name)} 아래로 이동" title="아래로"${index === 0 || index === state.eventGroups.length - 1 ? " disabled" : ""}>↓</button>\n      </div>\n      <input type="color" value="${safeColor(group.color)}" aria-label="${esc(group.name)} 색" data-event-group-color />\n      <input value="${esc(group.name)}" aria-label="영역 이름" data-event-group-name />\n      <button class="ghost-btn danger-text" type="button" data-event-group-delete${index === 0 ? " disabled" : ""}>삭제</button>\n    </div>`).join("");'''
new_markup = '''    groupList.innerHTML = state.eventGroups.map((group, index) => `<div class="event-group-row" data-event-group-id="${esc(group.id)}">\n      <button class="event-group-drag-handle" type="button" data-event-group-drag aria-label="${esc(group.name)} 순서 이동" title="끌어서 순서 변경"${index === 0 ? " disabled" : ""}>⠿</button>\n      <input type="color" value="${safeColor(group.color)}" aria-label="${esc(group.name)} 색" data-event-group-color />\n      <input value="${esc(group.name)}" aria-label="영역 이름" data-event-group-name />\n      <button class="ghost-btn danger-text" type="button" data-event-group-delete${index === 0 ? " disabled" : ""}>삭제</button>\n    </div>`).join("");'''
if old_markup not in app:
    raise SystemExit('area markup block not found')
app = app.replace(old_markup, new_markup, 1)

old_buttons = '''    groupList.querySelectorAll("[data-event-group-up], [data-event-group-down]").forEach((button) => button.addEventListener("click", () => {\n      const id = button.closest("[data-event-group-id]")?.dataset.eventGroupId;\n      const index = state.eventGroups.findIndex((group) => group.id === id);\n      if (index < 1) return;\n      const nextIndex = index + (button.hasAttribute("data-event-group-up") ? -1 : 1);\n      if (nextIndex < 1 || nextIndex >= state.eventGroups.length) return;\n      [state.eventGroups[index], state.eventGroups[nextIndex]] = [state.eventGroups[nextIndex], state.eventGroups[index]];\n      save();\n      renderSettings();\n      refreshEventGroupInputs();\n      renderCalendar();\n    }));'''
new_drag = '''    groupList.querySelectorAll("[data-event-group-drag]:not(:disabled)").forEach((handle) => {\n      let draggingRow = null;\n      let pointerId = null;\n      let moved = false;\n      handle.addEventListener("pointerdown", (event) => {\n        if (event.button !== undefined && event.button !== 0) return;\n        draggingRow = handle.closest("[data-event-group-id]");\n        if (!draggingRow) return;\n        pointerId = event.pointerId;\n        moved = false;\n        handle.setPointerCapture?.(pointerId);\n        draggingRow.classList.add("dragging");\n        event.preventDefault();\n      });\n      handle.addEventListener("pointermove", (event) => {\n        if (!draggingRow || event.pointerId !== pointerId) return;\n        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.(".event-group-row");\n        if (!target || target === draggingRow || target.parentElement !== groupList) return;\n        const firstRow = groupList.querySelector(".event-group-row");\n        if (target === firstRow) {\n          firstRow.after(draggingRow);\n          moved = true;\n          return;\n        }\n        const rect = target.getBoundingClientRect();\n        groupList.insertBefore(draggingRow, event.clientY > rect.top + rect.height / 2 ? target.nextSibling : target);\n        moved = true;\n      });\n      const finishDrag = (event) => {\n        if (!draggingRow || event.pointerId !== pointerId) return;\n        handle.releasePointerCapture?.(pointerId);\n        draggingRow.classList.remove("dragging");\n        const changed = moved;\n        draggingRow = null;\n        pointerId = null;\n        moved = false;\n        if (!changed) return;\n        const ids = [...groupList.querySelectorAll("[data-event-group-id]")].map((row) => row.dataset.eventGroupId);\n        const byId = new Map(state.eventGroups.map((group) => [group.id, group]));\n        state.eventGroups = ids.map((id) => byId.get(id)).filter(Boolean);\n        save();\n        refreshEventGroupInputs();\n        renderCalendar();\n        renderSettings();\n      };\n      handle.addEventListener("pointerup", finishDrag);\n      handle.addEventListener("pointercancel", finishDrag);\n    });'''
if old_buttons not in app:
    raise SystemExit('area arrow handlers not found')
app = app.replace(old_buttons, new_drag, 1)

old_css = '''.event-group-row { display: grid; grid-template-columns: 58px 38px minmax(0,1fr) auto; gap: 7px; align-items: center; padding: 5px 0; }\n.event-group-order { display: flex; gap: 2px; align-items: center; }\n.event-group-order .ghost-btn { width: 28px; min-height: 34px; padding: 0; font-size: 13px; }'''
new_css = '''.event-group-row { display: grid; grid-template-columns: 28px 38px minmax(0,1fr) auto; gap: 7px; align-items: center; padding: 5px 0; transition: opacity .12s ease, transform .12s ease; }\n.event-group-row.dragging { opacity: .45; }\n.event-group-drag-handle { display: grid; place-items: center; width: 28px; height: 34px; padding: 0; border: 0; border-radius: 7px; background: transparent; color: var(--muted); font-size: 18px; line-height: 1; cursor: grab; touch-action: none; user-select: none; }\n.event-group-drag-handle:hover:not(:disabled) { background: var(--hover); color: var(--text); }\n.event-group-drag-handle:active:not(:disabled) { cursor: grabbing; }\n.event-group-drag-handle:disabled { opacity: .25; cursor: default; }'''
if old_css not in style:
    raise SystemExit('area css block not found')
style = style.replace(old_css, new_css, 1)

index = index.replace('<link rel="stylesheet" href="./css/style.css?v=20" />', '<link rel="stylesheet" href="./css/style.css?v=21" />', 1)
index = index.replace('<script type="module" src="./js/app.js?v=40"></script>', '<script type="module" src="./js/app.js?v=41"></script>', 1)
index = index.replace('<h3>영역</h3><div class="setting-desc">일정·할일·습관에서 공통으로 사용하는 영역입니다.</div>', '<h3>영역</h3><div class="setting-desc">일정·할일·프로젝트에서 공통으로 사용하는 영역입니다. 왼쪽 손잡이를 끌어서 순서를 바꿀 수 있어요.</div>', 1)

app_path.write_text(app)
style_path.write_text(style)
index_path.write_text(index)
