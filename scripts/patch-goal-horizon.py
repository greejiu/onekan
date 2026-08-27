from pathlib import Path

ROOT = Path('.')

def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 occurrence, got {count}')
    return text.replace(old, new, 1)

# index.html
path = ROOT / 'index.html'
text = path.read_text()
text = replace_once(text, '''        <div class="seg uw-work-status-tabs" id="goalStatusTabs" aria-label="목표 상태">
          <button class="active" data-work-kind="goal" data-work-status="all" type="button">전체</button>
          <button data-work-kind="goal" data-work-status="before" type="button">시작 전</button>
          <button data-work-kind="goal" data-work-status="doing" type="button">하는 중</button>
          <button data-work-kind="goal" data-work-status="done" type="button">완료</button>
          <button data-work-kind="goal" data-work-status="stopped" type="button">중단</button>
        </div>''', '''        <div class="seg uw-work-status-tabs" id="goalStatusTabs" aria-label="목표 구분">
          <button class="active" data-work-kind="goal" data-work-status="all" type="button">전체</button>
          <button data-work-kind="goal" data-work-status="short" type="button">단기 목표</button>
          <button data-work-kind="goal" data-work-status="long" type="button">장기 목표</button>
          <button data-work-kind="goal" data-work-status="done" type="button">달성</button>
        </div>''', 'goal tabs')
text = replace_once(text, '''      <div class="field"><label>상태</label><select id="projectStatus"><option value="before">시작 전</option><option value="doing">하는 중</option><option value="done">완료</option><option value="stopped">중단</option></select></div>
      <div class="field"><label>그룹</label><select id="projectGroup"></select></div>''', '''      <div class="field" id="workStatusField"><label id="workStatusLabel">상태</label><select id="projectStatus"><option value="before">시작 전</option><option value="doing">하는 중</option><option value="done">완료</option><option value="stopped">중단</option></select></div>
      <div class="field" id="goalTermField" hidden><label>목표 기간</label><select id="goalTerm"><option value="short">단기 목표</option><option value="long">장기 목표</option></select></div>
      <div class="field"><label>그룹</label><select id="projectGroup"></select></div>''', 'goal term field')
text = text.replace('css/unified-workspace.css?v=25', 'css/unified-workspace.css?v=26')
text = text.replace('js/work-management.js?v=9', 'js/work-management.js?v=10')
text = text.replace('js/work-status-inline-add.js?v=3', 'js/work-status-inline-add.js?v=4')
path.write_text(text)

# work-management.js
path = ROOT / 'js/work-management.js'
text = path.read_text()
text = replace_once(text, '''const statusDefs = [
  { id: "before", label: "시작 전", color: "#8fa9c4" },
  { id: "doing", label: "하는 중", color: "#88b49a" },
  { id: "done", label: "완료", color: "#a69ab8" },
  { id: "stopped", label: "중단", color: "#b89a91" },
];''', '''const statusDefs = [
  { id: "before", label: "시작 전", color: "#8fa9c4" },
  { id: "doing", label: "하는 중", color: "#88b49a" },
  { id: "done", label: "완료", color: "#a69ab8" },
  { id: "stopped", label: "중단", color: "#b89a91" },
];
const goalDefs = [
  { id: "short", label: "단기 목표", color: "#8fa9c4" },
  { id: "long", label: "장기 목표", color: "#88b49a" },
  { id: "done", label: "달성", color: "#a69ab8" },
];''', 'goal defs')
text = replace_once(text, '''    if (!statusDefs.some((status) => status.id === item.status)) item.status = "before";
    item.startDate ||= item.createdAt ? String(item.createdAt).slice(0, 10) : "";
    if (item.status === "done" && !item.completedAt) item.completedAt = new Date().toISOString();''', '''    if (item.kind === "goal") {
      item.status = item.status === "done" ? "done" : "doing";
      if (!["short", "long"].includes(item.goalTerm)) item.goalTerm = "short";
    } else if (!statusDefs.some((status) => status.id === item.status)) {
      item.status = "before";
    }
    item.startDate ||= item.createdAt ? String(item.createdAt).slice(0, 10) : "";
    if (item.status === "done" && !item.completedAt) item.completedAt = new Date().toISOString();''', 'goal migration')
text = replace_once(text, '''function dateMeta(item) {
  const parts = [];
  if (item.startDate) parts.push(`시작 ${item.startDate}`);
  if (item.deadline) parts.push(`마감 ${item.deadline}`);
  if (item.completedAt) parts.push(`완료 ${String(item.completedAt).slice(0, 10)}`);
  return parts.join(" · ") || "날짜 없음";
}''', '''function dateMeta(item) {
  const parts = [];
  if (item.startDate) parts.push(`시작 ${item.startDate}`);
  if (item.deadline) parts.push(`마감 ${item.deadline}`);
  if (item.completedAt) parts.push(`${item.kind === "goal" ? "달성" : "완료"} ${String(item.completedAt).slice(0, 10)}`);
  return parts.join(" · ") || "날짜 없음";
}''', 'goal completed meta')
text = replace_once(text, '''function renderKind(kind) {
  const root = $(kind === "goal" ? "#goalSections" : "#projectSections");
  if (!root || !state) return;
  const status = kind === "goal" ? goalStatus : projectStatus;
  const allItems = state.projects.filter((item) => item.kind === kind);
  $$('[data-work-kind="' + kind + '"][data-work-status]').forEach((button) => button.classList.toggle("active", button.dataset.workStatus === status));
  if (status === "all") {
    root.innerHTML = `<div class="uw-work-status-board">${statusDefs.map((definition) => statusSection(kind, definition, allItems.filter((item) => item.status === definition.id))).join("")}</div>`;
    return;
  }
  const items = allItems.filter((item) => item.status === status);
  const grouped = state.eventGroups.map((group) => ({ group, items: items.filter((item) => groupOf(item).id === group.id) })).filter((entry) => entry.items.length);
  const definition = statusDefs.find((entry) => entry.id === status);
  root.innerHTML = `<div class="uw-work-filtered-drop" data-work-kind="${kind}" data-work-drop-status="${status}">${grouped.length ? grouped.map(({ group, items: rows }) => `<section class="uw-work-group" style="--uw-group:${group.color}"><div class="uw-work-group-head"><span></span><strong>${esc(group.name)}</strong><small>${rows.length}</small></div><div class="uw-work-list">${sorted(rows).map((item) => workRow(item, false)).join("")}</div></section>`).join("") : `<div class="empty uw-work-empty">${definition?.label || "이 상태"} 항목이 없어요.</div>`}</div>`;
}''', '''function renderKind(kind) {
  const root = $(kind === "goal" ? "#goalSections" : "#projectSections");
  if (!root || !state) return;
  const status = kind === "goal" ? goalStatus : projectStatus;
  const allItems = state.projects.filter((item) => item.kind === kind);
  $$('[data-work-kind="' + kind + '"][data-work-status]').forEach((button) => button.classList.toggle("active", button.dataset.workStatus === status));

  if (kind === "goal") {
    const matchesGoalSection = (item, section) => section === "done" ? item.status === "done" : item.status !== "done" && item.goalTerm === section;
    if (status === "all") {
      root.innerHTML = `<div class="uw-work-status-board uw-goal-status-board">${goalDefs.map((definition) => statusSection(kind, definition, allItems.filter((item) => matchesGoalSection(item, definition.id)))).join("")}</div>`;
      return;
    }
    const items = allItems.filter((item) => matchesGoalSection(item, status));
    const grouped = state.eventGroups.map((group) => ({ group, items: items.filter((item) => groupOf(item).id === group.id) })).filter((entry) => entry.items.length);
    const definition = goalDefs.find((entry) => entry.id === status);
    root.innerHTML = `<div class="uw-work-filtered-drop" data-work-kind="goal" data-work-drop-status="${status}">${grouped.length ? grouped.map(({ group, items: rows }) => `<section class="uw-work-group" style="--uw-group:${group.color}"><div class="uw-work-group-head"><span></span><strong>${esc(group.name)}</strong><small>${rows.length}</small></div><div class="uw-work-list">${sorted(rows).map((item) => workRow(item, false)).join("")}</div></section>`).join("") : `<div class="empty uw-work-empty">${definition?.label || "목표"}가 없어요.</div>`}</div>`;
    return;
  }

  if (status === "all") {
    root.innerHTML = `<div class="uw-work-status-board">${statusDefs.map((definition) => statusSection(kind, definition, allItems.filter((item) => item.status === definition.id))).join("")}</div>`;
    return;
  }
  const items = allItems.filter((item) => item.status === status);
  const grouped = state.eventGroups.map((group) => ({ group, items: items.filter((item) => groupOf(item).id === group.id) })).filter((entry) => entry.items.length);
  const definition = statusDefs.find((entry) => entry.id === status);
  root.innerHTML = `<div class="uw-work-filtered-drop" data-work-kind="${kind}" data-work-drop-status="${status}">${grouped.length ? grouped.map(({ group, items: rows }) => `<section class="uw-work-group" style="--uw-group:${group.color}"><div class="uw-work-group-head"><span></span><strong>${esc(group.name)}</strong><small>${rows.length}</small></div><div class="uw-work-list">${sorted(rows).map((item) => workRow(item, false)).join("")}</div></section>`).join("") : `<div class="empty uw-work-empty">${definition?.label || "이 상태"} 항목이 없어요.</div>`}</div>`;
}''', 'goal render')
text = replace_once(text, '''  $("#projectTitle").value = item?.title || "";
  $("#projectStatus").value = item?.status || "before";
  $("#projectGroup").value = item?.groupId || state.eventGroups[0]?.id || "default";
  const goalField = $("#projectGoalField");''', '''  $("#projectTitle").value = item?.title || "";
  const statusSelect = $("#projectStatus");
  const statusLabel = $("#workStatusLabel");
  const goalTermField = $("#goalTermField");
  const goalTermSelect = $("#goalTerm");
  if (kind === "goal") {
    statusSelect.innerHTML = '<option value="doing">진행 중</option><option value="done">달성</option>';
    statusSelect.value = item?.status === "done" ? "done" : "doing";
    if (statusLabel) statusLabel.textContent = "상태";
    if (goalTermField) goalTermField.hidden = false;
    if (goalTermSelect) goalTermSelect.value = item?.goalTerm === "long" ? "long" : "short";
  } else {
    statusSelect.innerHTML = '<option value="before">시작 전</option><option value="doing">하는 중</option><option value="done">완료</option><option value="stopped">중단</option>';
    statusSelect.value = item?.status || "before";
    if (statusLabel) statusLabel.textContent = "상태";
    if (goalTermField) goalTermField.hidden = true;
  }
  $("#projectGroup").value = item?.groupId || state.eventGroups[0]?.id || "default";
  const goalField = $("#projectGoalField");''', 'dialog goal fields')
text = replace_once(text, '''async function moveWorkItem(id, status) {
  if (!id || !statusDefs.some((entry) => entry.id === status)) return;
  await writeState((current) => {
    const item = current.projects.find((entry) => entry.id === id);
    if (!item || item.status === status) return;
    item.status = status;
    if (status === "done") {
      item.completedAt ||= new Date().toISOString();
    } else {
      item.completedAt = null;
    }
  });
}''', '''async function moveWorkItem(id, status) {
  if (!id) return;
  await writeState((current) => {
    const item = current.projects.find((entry) => entry.id === id);
    if (!item) return;
    if (item.kind === "goal") {
      if (!goalDefs.some((entry) => entry.id === status)) return;
      if (status === "done") {
        item.status = "done";
        item.completedAt ||= new Date().toISOString();
      } else {
        item.goalTerm = status;
        item.status = "doing";
        item.completedAt = null;
      }
      return;
    }
    if (!statusDefs.some((entry) => entry.id === status) || item.status === status) return;
    item.status = status;
    if (status === "done") item.completedAt ||= new Date().toISOString();
    else item.completedAt = null;
  });
}''', 'goal drag move')
text = replace_once(text, '''      if (nextKind === "goal") {
        delete item.goalId;
        current.tasks.forEach((task) => {''', '''      if (nextKind === "goal") {
        delete item.goalId;
        item.goalTerm = "short";
        item.status = item.status === "done" ? "done" : "doing";
        current.tasks.forEach((task) => {''', 'convert to goal')
text = replace_once(text, '''      } else {
        delete item.goalId;
      }
      if (oldKind === "goal" && nextKind === "project") {''', '''      } else {
        delete item.goalId;
        delete item.goalTerm;
        if (!["before", "doing", "done", "stopped"].includes(item.status)) item.status = "before";
      }
      if (oldKind === "goal" && nextKind === "project") {''', 'convert to project')
text = replace_once(text, '''      item.title = title;
      item.kind = kind;
      item.status = $("#projectStatus").value;
      item.groupId = $("#projectGroup").value || current.eventGroups[0]?.id;''', '''      item.title = title;
      item.kind = kind;
      item.status = kind === "goal" ? ($("#projectStatus").value === "done" ? "done" : "doing") : $("#projectStatus").value;
      if (kind === "goal") item.goalTerm = $("#goalTerm")?.value === "long" ? "long" : "short";
      else delete item.goalTerm;
      item.groupId = $("#projectGroup").value || current.eventGroups[0]?.id;''', 'save goal term')
path.write_text(text)

# work-status-inline-add.js
path = ROOT / 'js/work-status-inline-add.js'
text = path.read_text()
text = replace_once(text, '''  const item = {
    id: crypto.randomUUID(),
    kind,
    title,
    status,
    groupId: group?.id || current.eventGroups[0]?.id || "default",
    startDate: todayKey(),
    deadline: "",
    createdAt: new Date().toISOString(),
  };
  if (status === "done") item.completedAt = new Date().toISOString();''', '''  const goalSection = kind === "goal" ? status : null;
  const item = {
    id: crypto.randomUUID(),
    kind,
    title,
    status: kind === "goal" ? (goalSection === "done" ? "done" : "doing") : status,
    groupId: group?.id || current.eventGroups[0]?.id || "default",
    startDate: todayKey(),
    deadline: "",
    createdAt: new Date().toISOString(),
  };
  if (kind === "goal") item.goalTerm = goalSection === "long" ? "long" : "short";
  if (item.status === "done") item.completedAt = new Date().toISOString();''', 'quick goal data')
path.write_text(text)

# CSS
path = ROOT / 'css/unified-workspace.css'
text = path.read_text()
append = '''\n/* Goal horizon layout */\n.uw-goal-status-board{grid-template-columns:repeat(3,minmax(0,1fr))!important}\n@media(max-width:900px){.uw-goal-status-board{grid-template-columns:repeat(3,minmax(230px,76vw))!important}}\n'''
if '/* Goal horizon layout */' not in text:
    text += append
path.write_text(text)
