import { supabase } from "./supabase.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
const uid = () => crypto.randomUUID();
const todayKey = () => {
  const date = new Date();
  date.setHours(date.getHours() - 3);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const palette = ["#8fa9c4", "#9fbf9f", "#c4a58f", "#ad9fc4", "#c49fae", "#8fbfc1"];
const statusDefs = [
  { id: "before", label: "시작 전", color: "#8fa9c4" },
  { id: "doing", label: "하는 중", color: "#88b49a" },
  { id: "done", label: "완료", color: "#a69ab8" },
  { id: "stopped", label: "중단", color: "#b89a91" },
];
const goalDefs = [
  { id: "short", label: "단기 목표", color: "#8fa9c4" },
  { id: "long", label: "장기 목표", color: "#88b49a" },
  { id: "done", label: "달성", color: "#a69ab8" },
  { id: "closed", label: "종료", color: "#b89a91" },
];

let user = null;
let state = null;
let goalStatus = "all";
let projectStatus = "all";
let rendering = false;
let renderTimer = null;
let touchDrag = null;
let suppressWorkClickUntil = 0;

function legacyGroupId(name) {
  let hash = 0;
  for (const char of String(name)) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return `legacy-group-${Math.abs(hash)}`;
}

function migrate(current) {
  current.eventGroups = Array.isArray(current.eventGroups) && current.eventGroups.length ? current.eventGroups : [{ id: "default", name: "기본", color: "#8fa9c4" }];
  current.projects = Array.isArray(current.projects) ? current.projects : [];
  current.tasks = Array.isArray(current.tasks) ? current.tasks : [];
  for (const item of current.projects) {
    if (item.category && !item.groupId) {
      let group = current.eventGroups.find((entry) => entry.name.trim() === item.category.trim());
      if (!group) {
        group = { id: legacyGroupId(item.category), name: item.category.trim(), color: palette[current.eventGroups.length % palette.length] };
        current.eventGroups.push(group);
      }
      item.groupId = group.id;
      item.legacyCategory = item.category;
    }
    item.groupId ||= current.eventGroups[0].id;
    if (!item.kind) item.kind = item.status === "목표" ? "goal" : "project";
    if (!["goal", "project"].includes(item.kind)) item.kind = "project";
    if (item.status === "active" || item.status === "진행중" || item.status === "진행 중") item.status = "doing";
    if (item.status === "시작 전") item.status = "before";
    if (item.status === "하는 중") item.status = "doing";
    if (item.status === "paused" || item.status === "보류" || item.status === "중단") item.status = "stopped";
    if (item.status === "완료") item.status = "done";
    if (item.status === "종료") item.status = "closed";
    if (item.kind === "goal") {
      item.status = item.status === "done" ? "done" : item.status === "closed" ? "closed" : "doing";
      if (!["short", "long"].includes(item.goalTerm)) item.goalTerm = "short";
    } else if (!statusDefs.some((status) => status.id === item.status)) {
      item.status = "before";
    }
    item.startDate ||= item.createdAt ? String(item.createdAt).slice(0, 10) : "";
    if (item.status === "done" && !item.completedAt) item.completedAt = new Date().toISOString();
    if (item.kind === "goal" && item.status === "closed" && !item.closedAt) item.closedAt = new Date().toISOString();
    delete item.progress;
  }
  const validGoalIds = new Set(current.projects.filter((item) => item.kind === "goal").map((item) => item.id));
  const validProjectIds = new Set(current.projects.filter((item) => item.kind === "project").map((item) => item.id));
  for (const item of current.projects) {
    if (item.kind === "goal") delete item.goalId;
    else if (item.goalId && !validGoalIds.has(item.goalId)) delete item.goalId;
  }
  for (const task of current.tasks) {
    if (task.projectId && !validProjectIds.has(task.projectId)) {
      delete task.projectId;
      if (task.projectPlan) delete task.projectPlan;
    }
    delete task.goalId;
  }
  return current;
}

async function readState() {
  const { data: { session } } = await supabase.auth.getSession();
  user = session?.user || null;
  if (!user) return null;
  const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  state = migrate(data?.data && typeof data.data === "object" ? data.data : {});
  return state;
}

async function writeState(mutator) {
  const current = await readState();
  if (!current || !user) return;
  mutator(current);
  migrate(current);
  const { error } = await supabase.from("onekan_state").upsert({ user_id: user.id, data: current }, { onConflict: "user_id" });
  if (error) throw error;
  state = current;
  document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source: "work-management" } }));
  scheduleRender(20);
}

function groupOf(item) {
  return state.eventGroups.find((group) => group.id === item.groupId) || state.eventGroups[0];
}


function dateMeta(item) {
  const parts = [];
  if (item.startDate) parts.push(`시작 ${item.startDate}`);
  if (item.deadline) parts.push(`마감 ${item.deadline}`);
  if (item.kind === "goal") {
    if (item.status === "done" && item.completedAt) parts.push(`달성 ${String(item.completedAt).slice(0, 10)}`);
    if (item.status === "closed" && item.closedAt) parts.push(`종료 ${String(item.closedAt).slice(0, 10)}`);
  } else if (item.completedAt) {
    parts.push(`완료 ${String(item.completedAt).slice(0, 10)}`);
  }
  return parts.join(" · ") || "날짜 없음";
}

function workRow(item, showGroup = false) {
  const meta = showGroup ? `${groupOf(item).name} · ${dateMeta(item)}` : dateMeta(item);
  return `<article class="uw-work-row" draggable="true" style="--uw-group:${groupOf(item).color}" data-context-kind="project" data-context-id="${item.id}" data-work-id="${item.id}" data-project-id="${item.id}"><div class="uw-work-row-main"><span class="uw-work-dot"></span><div><strong>${esc(item.title)}</strong><small>${esc(meta)}</small></div><button class="uw-icon-btn" data-work-edit="${item.id}" type="button" aria-label="수정">···</button></div></article>`;
}

function sorted(items) {
  return [...items].sort((a, b) => String(a.deadline || "9999").localeCompare(String(b.deadline || "9999")) || String(a.title).localeCompare(String(b.title), "ko"));
}

function statusSection(kind, definition, items) {
  const body = sorted(items).map((item) => workRow(item, true)).join("");
  return `<section class="uw-work-status-section" style="--uw-status:${definition.color}" data-work-kind="${kind}" data-work-drop-status="${definition.id}"><div class="uw-work-status-head"><span></span><strong>${definition.label}</strong><small>${items.length}</small></div><div class="uw-work-list">${items.length ? body : '<div class="uw-work-status-empty">여기로 옮길 수 있어요.</div>'}</div></section>`;
}

function renderKind(kind) {
  const root = $(kind === "goal" ? "#goalSections" : "#projectSections");
  if (!root || !state) return;
  const status = kind === "goal" ? goalStatus : projectStatus;
  const allItems = state.projects.filter((item) => item.kind === kind);
  $$('[data-work-kind="' + kind + '"][data-work-status]').forEach((button) => button.classList.toggle("active", button.dataset.workStatus === status));

  if (kind === "goal") {
    const matchesGoalSection = (item, section) => {
      if (section === "done") return item.status === "done";
      if (section === "closed") return item.status === "closed";
      return item.status === "doing" && item.goalTerm === section;
    };
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
}

function fillDialogOptions() {
  $("#projectGroup").innerHTML = state.eventGroups.map((group) => `<option value="${group.id}">${esc(group.name)}</option>`).join("");
  const goalSelect = $("#projectGoal");
  if (goalSelect) goalSelect.innerHTML = '<option value="">연결 안 함</option>' + state.projects.filter((item) => item.kind === "goal").map((goal) => `<option value="${goal.id}">${esc(goal.title)}</option>`).join("");
}

function renderGoalProjects(goalId) {
  const editor = $("#goalProjectsEditor");
  const list = $("#goalProjectList");
  const count = $("#goalProjectCount");
  if (!editor || !list) return;
  const projects = goalId ? sorted(state.projects.filter((item) => item.kind === "project" && item.goalId === goalId)) : [];
  editor.hidden = !goalId;
  if (!goalId) {
    list.innerHTML = "";
    if (count) count.textContent = "";
    return;
  }
  if (count) count.textContent = `${projects.length}개`;
  list.innerHTML = projects.length ? projects.map((project) => `<div class="uw-goal-project-row" style="--uw-group:${groupOf(project).color}"><span></span><strong>${esc(project.title)}</strong><small>${esc(statusDefs.find((entry) => entry.id === project.status)?.label || "시작 전")}</small></div>`).join("") : '<div class="uw-goal-project-empty">아직 연결된 프로젝트가 없어요.</div>';
}

function openDialog(kind, item = null) {
  const dialog = $("#projectDialog");
  fillDialogOptions(kind, item);
  $("#projectDialogTitle").textContent = item ? `${kind === "goal" ? "목표" : "프로젝트"} 수정` : `${kind === "goal" ? "목표" : "프로젝트"} 추가`;
  $("#projectId").value = item?.id || "";
  $("#projectKind").value = kind;
  $("#projectTitle").value = item?.title || "";
  const statusSelect = $("#projectStatus");
  const statusLabel = $("#workStatusLabel");
  const goalTermField = $("#goalTermField");
  const goalTermSelect = $("#goalTerm");
  if (kind === "goal") {
    statusSelect.innerHTML = '<option value="doing">진행 중</option><option value="done">달성</option><option value="closed">종료</option>';
    statusSelect.value = item?.status === "done" ? "done" : item?.status === "closed" ? "closed" : "doing";
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
  const goalField = $("#projectGoalField");
  const goalSelect = $("#projectGoal");
  if (goalField) {
    goalField.hidden = kind !== "project";
    goalField.style.display = kind === "project" ? "" : "none";
  }
  if (goalSelect) goalSelect.value = kind === "project" ? (item?.goalId || "") : "";
  renderGoalProjects(kind === "goal" ? (item?.id || "") : "");
  $("#projectStartDate").value = item?.startDate || todayKey();
  $("#projectDeadline").value = item?.deadline || "";
  const convertButton = $("#convertProjectBtn");
  convertButton.hidden = !item;
  convertButton.textContent = kind === "goal" ? "프로젝트로 전환" : "목표로 전환";
  convertButton.dataset.workConvertId = item?.id || "";
  convertButton.dataset.workConvertKind = kind === "goal" ? "project" : "goal";
  dialog.showModal();
  requestAnimationFrame(() => $("#projectTitle").focus({ preventScroll: true }));
}

function scheduleRender(delay = 60) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderAll, delay);
}

async function moveWorkItem(id, status) {
  if (!id) return;
  await writeState((current) => {
    const item = current.projects.find((entry) => entry.id === id);
    if (!item) return;
    if (item.kind === "goal") {
      if (!goalDefs.some((entry) => entry.id === status)) return;
      if (status === "done") {
        item.status = "done";
        item.completedAt ||= new Date().toISOString();
        item.closedAt = null;
      } else if (status === "closed") {
        item.status = "closed";
        item.closedAt ||= new Date().toISOString();
        item.completedAt = null;
      } else {
        item.goalTerm = status;
        item.status = "doing";
        item.completedAt = null;
        item.closedAt = null;
      }
      return;
    }
    if (!statusDefs.some((entry) => entry.id === status) || item.status === status) return;
    item.status = status;
    if (status === "done") item.completedAt ||= new Date().toISOString();
    else item.completedAt = null;
  });
}

function clearWorkDrop() {
  $$(".uw-work-drop-active").forEach((element) => element.classList.remove("uw-work-drop-active"));
}

function wireWorkDrag() {
  document.addEventListener("dragstart", (event) => {
    const row = event.target.closest?.(".uw-work-row[data-work-id]");
    if (!row || event.target.closest("button,select,details,a,input")) { event.preventDefault(); return; }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/onekan-work-id", row.dataset.workId);
    row.classList.add("uw-work-dragging");
  });
  document.addEventListener("dragend", (event) => {
    event.target.closest?.(".uw-work-row")?.classList.remove("uw-work-dragging");
    clearWorkDrop();
  });
  document.addEventListener("dragover", (event) => {
    const zone = event.target.closest?.("[data-work-drop-status]");
    if (!zone || !Array.from(event.dataTransfer.types).includes("text/onekan-work-id")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    clearWorkDrop();
    zone.classList.add("uw-work-drop-active");
  });
  document.addEventListener("drop", async (event) => {
    const zone = event.target.closest?.("[data-work-drop-status]");
    if (!zone) return;
    const id = event.dataTransfer.getData("text/onekan-work-id");
    if (!id) return;
    event.preventDefault();
    clearWorkDrop();
    await moveWorkItem(id, zone.dataset.workDropStatus);
  });

  document.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" || event.button > 0 || event.target.closest("button,select,details,a,input")) return;
    const row = event.target.closest(".uw-work-row[data-work-id]");
    if (!row) return;
    const drag = touchDrag = { row, id: row.dataset.workId, pointerId: event.pointerId, x: event.clientX, y: event.clientY, active: false, zone: null };
    drag.timer = setTimeout(() => {
      if (touchDrag !== drag) return;
      drag.active = true;
      row.classList.add("uw-work-dragging");
      drag.ghost = row.cloneNode(true);
      drag.ghost.className = "uw-work-drag-ghost";
      document.body.appendChild(drag.ghost);
      navigator.vibrate?.(18);
    }, 450);
  }, true);
  document.addEventListener("pointermove", (event) => {
    const drag = touchDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const distance = Math.hypot(event.clientX - drag.x, event.clientY - drag.y);
    if (!drag.active) {
      if (distance > 10) { clearTimeout(drag.timer); touchDrag = null; }
      return;
    }
    event.preventDefault();
    drag.ghost.style.left = `${event.clientX}px`;
    drag.ghost.style.top = `${event.clientY}px`;
    clearWorkDrop();
    drag.zone = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-work-drop-status]") || null;
    drag.zone?.classList.add("uw-work-drop-active");
  }, { passive: false, capture: true });
  document.addEventListener("pointerup", async (event) => {
    const drag = touchDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    clearTimeout(drag.timer);
    touchDrag = null;
    if (!drag.active) return;
    event.preventDefault();
    suppressWorkClickUntil = Date.now() + 650;
    drag.row.classList.remove("uw-work-dragging");
    drag.ghost?.remove();
    clearWorkDrop();
    if (drag.zone) await moveWorkItem(drag.id, drag.zone.dataset.workDropStatus);
  }, true);
  document.addEventListener("pointercancel", () => {
    if (!touchDrag) return;
    clearTimeout(touchDrag.timer);
    touchDrag.ghost?.remove();
    touchDrag.row?.classList.remove("uw-work-dragging");
    touchDrag = null;
    clearWorkDrop();
  });
}

async function renderAll() {
  if (rendering) return;
  rendering = true;
  try {
    await readState();
    if (!state) return;
    renderKind("goal");
    renderKind("project");
  } catch (error) {
    console.error("목표·프로젝트현황 렌더링 실패", error);
  } finally {
    rendering = false;
  }
}

function wireUI() {
  if (document.documentElement.dataset.workManagementWired) return;
  document.documentElement.dataset.workManagementWired = "1";
  wireWorkDrag();
  $("#addGoalBtn")?.addEventListener("click", () => openDialog("goal"));
  $("#addProjectBtn")?.addEventListener("click", () => openDialog("project"));
  $("#cancelProjectBtn")?.addEventListener("click", () => $("#projectDialog")?.close());
  $("#goalProjectAddBtn")?.addEventListener("click", async () => {
    const goalId = $("#projectKind")?.value === "goal" ? $("#projectId")?.value : "";
    const input = $("#goalProjectNewTitle");
    const title = input?.value.trim() || "";
    if (!goalId || !title) return;
    const button = $("#goalProjectAddBtn");
    if (button) button.disabled = true;
    try {
      await writeState((current) => {
        const goal = current.projects.find((item) => item.id === goalId && item.kind === "goal");
        if (!goal) return;
        current.projects.push({
          id: uid(),
          kind: "project",
          title,
          status: "before",
          groupId: $("#projectGroup")?.value || goal.groupId || current.eventGroups[0]?.id || "default",
          goalId,
          startDate: todayKey(),
          deadline: "",
          createdAt: new Date().toISOString(),
        });
      });
      if (input) input.value = "";
      renderGoalProjects(goalId);
      input?.focus({ preventScroll: true });
    } finally {
      if (button) button.disabled = false;
    }
  });
  $("#goalProjectNewTitle")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    $("#goalProjectAddBtn")?.click();
  });
  $("#convertProjectBtn")?.addEventListener("click", async (event) => {
    const id = event.currentTarget.dataset.workConvertId;
    const nextKind = event.currentTarget.dataset.workConvertKind;
    if (!id || !["goal", "project"].includes(nextKind)) return;
    await writeState((current) => {
      const item = current.projects.find((entry) => entry.id === id);
      if (!item) return;
      const oldKind = item.kind;
      item.kind = nextKind;
      if (nextKind === "goal") {
        delete item.goalId;
        item.goalTerm = "short";
        item.status = item.status === "done" ? "done" : "doing";
        item.closedAt = null;
        current.tasks.forEach((task) => {
          if (task.projectId !== id) return;
          delete task.projectId;
          if (task.projectPlan) delete task.projectPlan;
        });
      } else {
        delete item.goalId;
        delete item.goalTerm;
        delete item.closedAt;
        if (!["before", "doing", "done", "stopped"].includes(item.status)) item.status = "before";
      }
      if (oldKind === "goal" && nextKind === "project") {
        current.projects.forEach((project) => { if (project.goalId === id) delete project.goalId; });
      }
    });
    $("#projectDialog").close();
  });
  $("#projectForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = $("#projectTitle").value.trim();
    if (!title) return;
    const id = $("#projectId").value;
    const kind = $("#projectKind").value === "goal" ? "goal" : "project";
    await writeState((current) => {
      let item = id ? current.projects.find((entry) => entry.id === id) : null;
      if (!item) {
        item = { id: uid(), kind, createdAt: new Date().toISOString() };
        current.projects.push(item);
      }
      item.title = title;
      item.kind = kind;
      const selectedStatus = $("#projectStatus").value;
      item.status = kind === "goal" ? (selectedStatus === "done" ? "done" : selectedStatus === "closed" ? "closed" : "doing") : selectedStatus;
      if (kind === "goal") item.goalTerm = $("#goalTerm")?.value === "long" ? "long" : "short";
      else delete item.goalTerm;
      item.groupId = $("#projectGroup").value || current.eventGroups[0]?.id;
      item.startDate = $("#projectStartDate").value || "";
      item.deadline = $("#projectDeadline").value || "";
      const selectedGoalId = $("#projectGoal")?.value || "";
      if (kind === "project" && selectedGoalId) item.goalId = selectedGoalId;
      else delete item.goalId;
      if (item.status === "done") {
        item.completedAt ||= new Date().toISOString();
        item.closedAt = null;
      } else if (kind === "goal" && item.status === "closed") {
        item.closedAt ||= new Date().toISOString();
        item.completedAt = null;
      } else {
        item.completedAt = null;
        if (kind === "goal") item.closedAt = null;
      }
    });
    $("#projectDialog").close();
  });
  document.addEventListener("click", async (event) => {
    if (Date.now() < suppressWorkClickUntil && event.target.closest(".uw-work-row")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    const status = event.target.closest("[data-work-kind][data-work-status]");
    if (status) {
      if (status.dataset.workKind === "goal") goalStatus = status.dataset.workStatus;
      else projectStatus = status.dataset.workStatus;
      renderKind(status.dataset.workKind);
      return;
    }
    const edit = event.target.closest("[data-work-edit]");
    if (edit) {
      const item = state.projects.find((entry) => entry.id === edit.dataset.workEdit);
      if (item) openDialog(item.kind, item);
      return;
    }
    const unlink = event.target.closest("[data-work-unlink-task]");
    if (unlink) {
      await writeState((current) => {
        const task = current.tasks.find((entry) => entry.id === unlink.dataset.workUnlinkTask);
        if (!task) return;
        if (unlink.dataset.workKind === "goal") delete task.goalId;
        else delete task.projectId;
      });
    }
  });
  document.addEventListener("change", async (event) => {
    const picker = event.target.closest("[data-work-link-task]");
    if (!picker || !picker.value) return;
    const taskId = picker.value;
    const workId = picker.dataset.workId;
    const kind = picker.dataset.workKind;
    picker.value = "";
    await writeState((current) => {
      const task = current.tasks.find((entry) => entry.id === taskId);
      const item = current.projects.find((entry) => entry.id === workId);
      if (!task || !item) return;
      if (kind === "goal") task.goalId = workId;
      else task.projectId = workId;
    });
  });
  $$('.nav-item[data-page="goals"],.nav-item[data-page="projects"]').forEach((button) => button.addEventListener("click", () => scheduleRender(0)));
  $("#reloadCloudBtn")?.addEventListener("click", () => scheduleRender(80));
  document.addEventListener("onekan:state-changed", (event) => {
    if (event.detail?.source !== "work-management") scheduleRender(40);
  });
}

async function init(session) {
  if (!session?.user) return;
  wireUI();
  const current = await readState();
  if (!current) return;
  const { error } = await supabase.from("onekan_state").upsert({ user_id: user.id, data: current }, { onConflict: "user_id" });
  if (error) throw error;
  $("#reloadCloudBtn")?.click();
  await renderAll();
}

supabase.auth.onAuthStateChange((_event, session) => { if (session?.user) setTimeout(() => init(session), 0); });
const { data: { session } } = await supabase.auth.getSession();
if (session?.user) await init(session);
