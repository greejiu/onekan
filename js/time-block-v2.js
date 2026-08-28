export const TIME_BLOCK_SYSTEM_VERSION = 2;
export const TIME_BLOCK_BASELINE_DATE = "1970-01-01";
export const TIME_BLOCK_START_ANCHOR = "block-start";

function cleanDateKey(value, fallback = TIME_BLOCK_BASELINE_DATE) {
  const text = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

function validDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function cleanTemplate(template, effectiveFrom = TIME_BLOCK_BASELINE_DATE) {
  if (!template || !template.id) return null;
  const startMinute = Number(template.startMinute);
  const endMinute = Number(template.endMinute);
  if (!Number.isFinite(startMinute) || !Number.isFinite(endMinute) || endMinute <= startMinute) return null;
  return {
    id: String(template.id),
    title: String(template.title || template.name || ""),
    startMinute,
    endMinute,
    effectiveFrom: cleanDateKey(template.effectiveFrom, effectiveFrom),
    ...(template.deleted ? { deleted: true } : {}),
  };
}

function sameTemplateShape(a, b) {
  return Boolean(a && b)
    && String(a.title || "") === String(b.title || "")
    && Number(a.startMinute) === Number(b.startMinute)
    && Number(a.endMinute) === Number(b.endMinute)
    && Boolean(a.deleted) === Boolean(b.deleted);
}

function cleanAssignment(value) {
  if (!value || !value.blockId) return null;
  const order = Math.max(1, Math.floor(Number(value.order) || 1));
  return {
    blockId: String(value.blockId),
    afterAnchor: String(value.afterAnchor || TIME_BLOCK_START_ANCHOR),
    order,
  };
}

function cleanDateOverride(value, id) {
  if (!value || !id || typeof value !== "object" || Array.isArray(value)) return null;
  const result = {
    id: String(id),
    hidden: Boolean(value.hidden),
    created: Boolean(value.created),
  };
  if (Object.prototype.hasOwnProperty.call(value, "title")) result.title = String(value.title || "");
  const startMinute = Number(value.startMinute);
  const endMinute = Number(value.endMinute);
  if (Number.isFinite(startMinute) && Number.isFinite(endMinute) && endMinute > startMinute) {
    result.startMinute = startMinute;
    result.endMinute = endMinute;
  }
  return result;
}

function sortTemplates(templates) {
  return [...templates].sort((a, b) => Number(a.startMinute) - Number(b.startMinute) || Number(a.endMinute) - Number(b.endMinute) || String(a.id).localeCompare(String(b.id)));
}

export function ensureTimeBlockV2State(state, options = {}) {
  if (!state || typeof state !== "object") return false;
  let changed = false;
  if (state.timeBlockSystemVersion !== TIME_BLOCK_SYSTEM_VERSION) {
    state.timeBlockSystemVersion = TIME_BLOCK_SYSTEM_VERSION;
    changed = true;
  }
  if (!Array.isArray(state.timeBlockTemplateVersions)) {
    state.timeBlockTemplateVersions = [];
    changed = true;
  }
  if (!state.timeBlockAssignments || typeof state.timeBlockAssignments !== "object" || Array.isArray(state.timeBlockAssignments)) {
    state.timeBlockAssignments = {};
    changed = true;
  }
  if (!state.timeBlockOverrides || typeof state.timeBlockOverrides !== "object" || Array.isArray(state.timeBlockOverrides)) {
    state.timeBlockOverrides = {};
    changed = true;
  }
  if (!state.timeBlockTemplateVersions.length) {
    const source = Array.isArray(state.timeBlockTemplates) && state.timeBlockTemplates.length
      ? state.timeBlockTemplates
      : (Array.isArray(options.fallbackTemplates) ? options.fallbackTemplates : []);
    const baselineDate = cleanDateKey(options.baselineDate, TIME_BLOCK_BASELINE_DATE);
    const seeded = source.map((item) => cleanTemplate(item, baselineDate)).filter(Boolean);
    if (seeded.length) {
      state.timeBlockTemplateVersions = seeded;
      changed = true;
    }
  }
  return changed;
}

export function timeBlockTemplatesForDate(state, dateKey) {
  const targetDate = cleanDateKey(dateKey);
  const versions = Array.isArray(state?.timeBlockTemplateVersions) ? state.timeBlockTemplateVersions : [];
  const selected = new Map();

  versions.forEach((raw, index) => {
    if (!raw?.id) return;
    const effectiveFrom = cleanDateKey(raw.effectiveFrom);
    if (effectiveFrom > targetDate) return;
    const current = selected.get(String(raw.id));
    if (!current || effectiveFrom > current.effectiveFrom || (effectiveFrom === current.effectiveFrom && index > current.index)) {
      selected.set(String(raw.id), { raw, effectiveFrom, index });
    }
  });

  return [...selected.values()]
    .map(({ raw, effectiveFrom }) => cleanTemplate(raw, effectiveFrom))
    .filter((item) => item && !item.deleted)
    .sort((a, b) => Number(a.startMinute) - Number(b.startMinute) || Number(a.endMinute) - Number(b.endMinute) || String(a.id).localeCompare(String(b.id)));
}

export function upsertTimeBlockTemplateVersion(state, template, effectiveFrom) {
  if (!state || typeof state !== "object" || !template?.id) return false;
  ensureTimeBlockV2State(state);
  const date = cleanDateKey(effectiveFrom);
  const normalized = template.deleted
    ? { id: String(template.id), title: "", startMinute: 0, endMinute: 1, effectiveFrom: date, deleted: true }
    : cleanTemplate({ ...template, effectiveFrom: date }, date);
  if (!normalized) return false;

  const versions = state.timeBlockTemplateVersions;
  const existingIndex = versions.findIndex((item) => String(item?.id || "") === normalized.id && cleanDateKey(item?.effectiveFrom) === date);
  if (existingIndex >= 0) {
    if (sameTemplateShape(versions[existingIndex], normalized)) return false;
    versions[existingIndex] = normalized;
    for (let index = versions.length - 1; index > existingIndex; index -= 1) {
      const item = versions[index];
      if (String(item?.id || "") === normalized.id && cleanDateKey(item?.effectiveFrom) === date) versions.splice(index, 1);
    }
    return true;
  }
  versions.push(normalized);
  return true;
}

export function setTimeBlockTemplatesForDate(state, nextTemplates, effectiveFrom) {
  if (!state || typeof state !== "object") return false;
  ensureTimeBlockV2State(state);
  const date = cleanDateKey(effectiveFrom);
  const active = timeBlockTemplatesForDate(state, date);
  const activeById = new Map(active.map((item) => [String(item.id), item]));
  const next = (Array.isArray(nextTemplates) ? nextTemplates : [])
    .map((item) => cleanTemplate({ ...item, effectiveFrom: date }, date))
    .filter(Boolean);
  const nextById = new Map(next.map((item) => [String(item.id), item]));
  let changed = false;

  for (const [id] of activeById) {
    if (!nextById.has(id)) changed = upsertTimeBlockTemplateVersion(state, { id, deleted: true }, date) || changed;
  }
  for (const [id, template] of nextById) {
    const current = activeById.get(id);
    if (!current || !sameTemplateShape(current, template)) changed = upsertTimeBlockTemplateVersion(state, template, date) || changed;
  }
  return changed;
}

export function validateTimeBlockTemplates(templates) {
  const normalized = (Array.isArray(templates) ? templates : [])
    .map((item) => cleanTemplate(item))
    .filter(Boolean)
    .sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);
  if (normalized.length !== (Array.isArray(templates) ? templates.length : 0)) {
    return { ok: false, message: "시간블럭의 시작/종료 시간을 확인해 주세요." };
  }
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index].startMinute < normalized[index - 1].endMinute) {
      return { ok: false, message: "서로 겹치는 시간블럭은 만들 수 없어요." };
    }
  }
  return { ok: true, templates: normalized };
}

export function timeBlockOccurrenceToken(kind, item, dateKey) {
  if (!kind || !item?.id || !validDateKey(dateKey)) return "";
  const sourceDate = validDateKey(item._occurrenceSource) ? item._occurrenceSource : dateKey;
  return `${String(kind)}:${String(item.id)}:${sourceDate}`;
}

export function timeBlockAssignmentsForDate(state, dateKey) {
  if (!state || !validDateKey(dateKey)) return {};
  ensureTimeBlockV2State(state);
  const raw = state.timeBlockAssignments?.[dateKey];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result = {};
  for (const [token, value] of Object.entries(raw)) {
    const cleaned = cleanAssignment(value);
    if (cleaned) result[token] = cleaned;
  }
  return result;
}

export function timeBlockAssignment(state, dateKey, token) {
  if (!token) return null;
  return timeBlockAssignmentsForDate(state, dateKey)[token] || null;
}

export function setTimeBlockAssignment(state, dateKey, token, value) {
  if (!state || !validDateKey(dateKey) || !token) return false;
  ensureTimeBlockV2State(state);
  const cleaned = cleanAssignment(value);
  if (!cleaned) return false;
  state.timeBlockAssignments[dateKey] ||= {};
  const current = cleanAssignment(state.timeBlockAssignments[dateKey][token]);
  if (current && current.blockId === cleaned.blockId && current.afterAnchor === cleaned.afterAnchor && current.order === cleaned.order) return false;
  state.timeBlockAssignments[dateKey][token] = cleaned;
  return true;
}

export function assignTimeBlockOccurrence(state, dateKey, token, blockId, afterAnchor = TIME_BLOCK_START_ANCHOR) {
  if (!state || !validDateKey(dateKey) || !token || !blockId) return false;
  const assignments = timeBlockAssignmentsForDate(state, dateKey);
  let maxOrder = 0;
  for (const [otherToken, value] of Object.entries(assignments)) {
    if (otherToken === token) continue;
    if (value.blockId === String(blockId) && value.afterAnchor === String(afterAnchor || TIME_BLOCK_START_ANCHOR)) {
      maxOrder = Math.max(maxOrder, Number(value.order) || 0);
    }
  }
  return setTimeBlockAssignment(state, dateKey, token, {
    blockId: String(blockId),
    afterAnchor: String(afterAnchor || TIME_BLOCK_START_ANCHOR),
    order: maxOrder + 1,
  });
}

export function clearTimeBlockAssignment(state, dateKey, token) {
  if (!state || !validDateKey(dateKey) || !token || !state.timeBlockAssignments?.[dateKey]?.[token]) return false;
  delete state.timeBlockAssignments[dateKey][token];
  if (!Object.keys(state.timeBlockAssignments[dateKey]).length) delete state.timeBlockAssignments[dateKey];
  return true;
}


export function timeBlockDateOverridesForDate(state, dateKey) {
  if (!state || !validDateKey(dateKey)) return {};
  ensureTimeBlockV2State(state);
  const raw = state.timeBlockOverrides?.[dateKey];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result = {};
  for (const [id, value] of Object.entries(raw)) {
    const cleaned = cleanDateOverride(value, id);
    if (cleaned) result[id] = cleaned;
  }
  return result;
}

export function effectiveTimeBlockTemplatesForDate(state, dateKey) {
  const base = timeBlockTemplatesForDate(state, dateKey);
  const byId = new Map(base.map((template) => [String(template.id), { ...template }]));
  const overrides = timeBlockDateOverridesForDate(state, dateKey);
  for (const [id, override] of Object.entries(overrides)) {
    if (override.hidden) {
      byId.delete(id);
      continue;
    }
    const current = byId.get(id);
    if (current) {
      const startMinute = Number.isFinite(Number(override.startMinute)) ? Number(override.startMinute) : Number(current.startMinute);
      const endMinute = Number.isFinite(Number(override.endMinute)) ? Number(override.endMinute) : Number(current.endMinute);
      byId.set(id, {
        ...current,
        title: Object.prototype.hasOwnProperty.call(override, "title") ? override.title : current.title,
        startMinute,
        endMinute,
        _dateOverride: true,
      });
      continue;
    }
    if (override.created && Number.isFinite(Number(override.startMinute)) && Number.isFinite(Number(override.endMinute)) && Number(override.endMinute) > Number(override.startMinute)) {
      byId.set(id, {
        id,
        title: String(override.title || ""),
        startMinute: Number(override.startMinute),
        endMinute: Number(override.endMinute),
        effectiveFrom: dateKey,
        _dateOverride: true,
        _dateCreated: true,
      });
    }
  }
  return sortTemplates([...byId.values()]);
}

export function hiddenTimeBlockTemplatesForDate(state, dateKey) {
  const baseById = new Map(timeBlockTemplatesForDate(state, dateKey).map((template) => [String(template.id), template]));
  const overrides = timeBlockDateOverridesForDate(state, dateKey);
  const hidden = [];
  for (const [id, override] of Object.entries(overrides)) {
    if (!override.hidden) continue;
    const base = baseById.get(id);
    if (!base && !override.created) continue;
    const startMinute = Number.isFinite(Number(override.startMinute)) ? Number(override.startMinute) : Number(base?.startMinute);
    const endMinute = Number.isFinite(Number(override.endMinute)) ? Number(override.endMinute) : Number(base?.endMinute);
    if (!Number.isFinite(startMinute) || !Number.isFinite(endMinute) || endMinute <= startMinute) continue;
    hidden.push({
      ...(base || {}),
      id,
      title: Object.prototype.hasOwnProperty.call(override, "title") ? override.title : String(base?.title || ""),
      startMinute,
      endMinute,
      _dateOverride: true,
      ...(override.created ? { _dateCreated: true } : {}),
    });
  }
  return sortTemplates(hidden);
}

export function setTimeBlockDateOverride(state, dateKey, blockId, value) {
  if (!state || !validDateKey(dateKey) || !blockId || !value || typeof value !== "object") return false;
  ensureTimeBlockV2State(state);
  const cleaned = cleanDateOverride(value, blockId);
  if (!cleaned) return false;
  state.timeBlockOverrides[dateKey] ||= {};
  const previous = cleanDateOverride(state.timeBlockOverrides[dateKey][blockId], blockId);
  const comparable = (item) => JSON.stringify(item || null);
  if (comparable(previous) === comparable(cleaned)) return false;
  const stored = {
    hidden: cleaned.hidden,
    created: cleaned.created,
    ...(Object.prototype.hasOwnProperty.call(cleaned, "title") ? { title: cleaned.title } : {}),
    ...(Number.isFinite(Number(cleaned.startMinute)) ? { startMinute: Number(cleaned.startMinute) } : {}),
    ...(Number.isFinite(Number(cleaned.endMinute)) ? { endMinute: Number(cleaned.endMinute) } : {}),
  };
  state.timeBlockOverrides[dateKey][String(blockId)] = stored;
  return true;
}

export function clearTimeBlockDateOverride(state, dateKey, blockId) {
  if (!state || !validDateKey(dateKey) || !blockId || !state.timeBlockOverrides?.[dateKey]?.[blockId]) return false;
  delete state.timeBlockOverrides[dateKey][blockId];
  if (!Object.keys(state.timeBlockOverrides[dateKey]).length) delete state.timeBlockOverrides[dateKey];
  return true;
}

export function clearTimeBlockAssignmentsForBlock(state, dateKey, blockId) {
  if (!state || !validDateKey(dateKey) || !blockId || !state.timeBlockAssignments?.[dateKey]) return false;
  let changed = false;
  for (const [token, assignment] of Object.entries(state.timeBlockAssignments[dateKey])) {
    if (String(assignment?.blockId || "") !== String(blockId)) continue;
    delete state.timeBlockAssignments[dateKey][token];
    changed = true;
  }
  if (!Object.keys(state.timeBlockAssignments[dateKey]).length) delete state.timeBlockAssignments[dateKey];
  return changed;
}
