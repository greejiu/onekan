export const TIME_BLOCK_SYSTEM_VERSION = 2;
export const TIME_BLOCK_BASELINE_DATE = "1970-01-01";

function cleanDateKey(value, fallback = TIME_BLOCK_BASELINE_DATE) {
  const text = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
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
