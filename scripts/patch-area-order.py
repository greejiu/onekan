from pathlib import Path

app = Path('js/app.js')
text = app.read_text()
old = '''    groupList.innerHTML = state.eventGroups.map((group, index) => `<div class="event-group-row" data-event-group-id="${esc(group.id)}">
      <input type="color" value="${safeColor(group.color)}" aria-label="${esc(group.name)} 색" data-event-group-color />
      <input value="${esc(group.name)}" aria-label="영역 이름" data-event-group-name />
      <button class="ghost-btn danger-text" type="button" data-event-group-delete${index === 0 ? " disabled" : ""}>삭제</button>
    </div>`).join("");
'''
new = '''    groupList.innerHTML = state.eventGroups.map((group, index) => `<div class="event-group-row" data-event-group-id="${esc(group.id)}">
      <div class="event-group-order" aria-label="영역 순서">
        <button class="ghost-btn" type="button" data-event-group-up aria-label="${esc(group.name)} 위로 이동" title="위로"${index <= 1 ? " disabled" : ""}>↑</button>
        <button class="ghost-btn" type="button" data-event-group-down aria-label="${esc(group.name)} 아래로 이동" title="아래로"${index === 0 || index === state.eventGroups.length - 1 ? " disabled" : ""}>↓</button>
      </div>
      <input type="color" value="${safeColor(group.color)}" aria-label="${esc(group.name)} 색" data-event-group-color />
      <input value="${esc(group.name)}" aria-label="영역 이름" data-event-group-name />
      <button class="ghost-btn danger-text" type="button" data-event-group-delete${index === 0 ? " disabled" : ""}>삭제</button>
    </div>`).join("");
'''
if old not in text:
    raise SystemExit('event group markup not found')
text = text.replace(old, new, 1)
anchor = '''    groupList.querySelectorAll("[data-event-group-delete]").forEach((button) => button.addEventListener("click", async () => {
'''
insert = '''    groupList.querySelectorAll("[data-event-group-up], [data-event-group-down]").forEach((button) => button.addEventListener("click", () => {
      const id = button.closest("[data-event-group-id]")?.dataset.eventGroupId;
      const index = state.eventGroups.findIndex((group) => group.id === id);
      if (index < 1) return;
      const nextIndex = index + (button.hasAttribute("data-event-group-up") ? -1 : 1);
      if (nextIndex < 1 || nextIndex >= state.eventGroups.length) return;
      [state.eventGroups[index], state.eventGroups[nextIndex]] = [state.eventGroups[nextIndex], state.eventGroups[index]];
      save();
      renderSettings();
      refreshEventGroupInputs();
      renderCalendar();
    }));
    groupList.querySelectorAll("[data-event-group-delete]").forEach((button) => button.addEventListener("click", async () => {
'''
if anchor not in text:
    raise SystemExit('delete listener anchor not found')
text = text.replace(anchor, insert, 1)
app.write_text(text)

css = Path('css/style.css')
text = css.read_text()
old = '.event-group-row { display: grid; grid-template-columns: 38px minmax(0,1fr) auto; gap: 7px; align-items: center; padding: 5px 0; }\n'
new = '.event-group-row { display: grid; grid-template-columns: 58px 38px minmax(0,1fr) auto; gap: 7px; align-items: center; padding: 5px 0; }\n.event-group-order { display: flex; gap: 2px; align-items: center; }\n.event-group-order .ghost-btn { width: 28px; min-height: 34px; padding: 0; font-size: 13px; }\n'
if old not in text:
    raise SystemExit('event group css not found')
text = text.replace(old, new, 1)
css.write_text(text)

index = Path('index.html')
text = index.read_text()
text = text.replace('css/style.css?v=20', 'css/style.css?v=21', 1)
text = text.replace('js/app.js?v=40', 'js/app.js?v=41', 1)
text = text.replace('일정·할일·습관에서 공통으로 사용하는 영역입니다.', '일정·할일·습관·프로젝트에서 공통으로 사용하는 영역입니다. 위아래 버튼으로 순서를 바꿀 수 있어요.', 1)
index.write_text(text)
