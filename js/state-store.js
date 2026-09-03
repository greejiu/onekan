export const STATE_STORE_META_KEY = "__onekanStateStoreBase";
const MAX_BASES = 256;
const MISSING = Symbol("missing");

function cloneValue(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasId(value) {
  return isPlainObject(value) && value.id !== undefined && value.id !== null && String(value.id) !== "";
}

function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) if (!deepEqual(a[index], b[index])) return false;
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a).filter((key) => key !== STATE_STORE_META_KEY);
    const bKeys = Object.keys(b).filter((key) => key !== STATE_STORE_META_KEY);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, key) || !deepEqual(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
}

export function stripStateStoreMeta(value) {
  if (!isPlainObject(value)) return cloneValue(value);
  const clean = cloneValue(value);
  delete clean[STATE_STORE_META_KEY];
  return clean;
}

function arrayCanMergeById(base, local, remote) {
  const all = [...(Array.isArray(base) ? base : []), ...(Array.isArray(local) ? local : []), ...(Array.isArray(remote) ? remote : [])];
  return all.length > 0 && all.every(hasId);
}

function mergePresence(baseValue, localValue, remoteValue, baseHas, localHas, remoteHas) {
  if (!localHas && !remoteHas) return MISSING;
  if (!baseHas) {
    if (!localHas) return cloneValue(remoteValue);
    if (!remoteHas) return cloneValue(localValue);
    if (deepEqual(localValue, remoteValue)) return cloneValue(localValue);
    return mergeValue(MISSING, localValue, remoteValue, false);
  }

  if (!localHas) {
    if (!remoteHas) return MISSING;
    if (deepEqual(remoteValue, baseValue)) return MISSING;
    return MISSING;
  }

  if (!remoteHas) {
    if (deepEqual(localValue, baseValue)) return MISSING;
    return cloneValue(localValue);
  }

  return mergeValue(baseValue, localValue, remoteValue, true);
}

function mergeArrayById(base, local, remote) {
  const baseMap = new Map((base || []).map((item) => [String(item.id), item]));
  const localMap = new Map((local || []).map((item) => [String(item.id), item]));
  const remoteMap = new Map((remote || []).map((item) => [String(item.id), item]));
  const order = [];
  for (const item of local || []) order.push(String(item.id));
  for (const item of remote || []) {
    const id = String(item.id);
    if (!order.includes(id)) order.push(id);
  }

  const merged = [];
  for (const id of order) {
    const baseHas = baseMap.has(id);
    const localHas = localMap.has(id);
    const remoteHas = remoteMap.has(id);
    const value = mergePresence(baseMap.get(id), localMap.get(id), remoteMap.get(id), baseHas, localHas, remoteHas);
    if (value !== MISSING) merged.push(value);
  }
  return merged;
}

function mergeObject(base, local, remote) {
  const result = {};
  const keys = new Set([
    ...Object.keys(base || {}).filter((key) => key !== STATE_STORE_META_KEY),
    ...Object.keys(local || {}).filter((key) => key !== STATE_STORE_META_KEY),
    ...Object.keys(remote || {}).filter((key) => key !== STATE_STORE_META_KEY),
  ]);
  for (const key of keys) {
    const baseHas = Object.prototype.hasOwnProperty.call(base || {}, key);
    const localHas = Object.prototype.hasOwnProperty.call(local || {}, key);
    const remoteHas = Object.prototype.hasOwnProperty.call(remote || {}, key);
    const value = mergePresence(base?.[key], local?.[key], remote?.[key], baseHas, localHas, remoteHas);
    if (value !== MISSING) result[key] = value;
  }
  return result;
}

function mergeValue(base, local, remote, baseExists = true) {
  if (baseExists && deepEqual(local, base)) return cloneValue(remote);
  if (baseExists && deepEqual(remote, base)) return cloneValue(local);
  if (deepEqual(local, remote)) return cloneValue(local);

  if (Array.isArray(local) && Array.isArray(remote)) {
    const baseArray = Array.isArray(base) ? base : [];
    if (arrayCanMergeById(baseArray, local, remote)) return mergeArrayById(baseArray, local, remote);
    return cloneValue(local);
  }

  if (isPlainObject(local) && isPlainObject(remote)) {
    return mergeObject(isPlainObject(base) ? base : {}, local, remote);
  }

  return cloneValue(local);
}

export function threeWayMerge(baseState, localState, remoteState) {
  const base = isPlainObject(baseState) ? stripStateStoreMeta(baseState) : {};
  const local = isPlainObject(localState) ? stripStateStoreMeta(localState) : {};
  const remote = isPlainObject(remoteState) ? stripStateStoreMeta(remoteState) : {};
  return mergeObject(base, local, remote);
}

function browserDispatch(name, detail) {
  if (typeof document === "undefined" || typeof CustomEvent === "undefined") return;
  document.dispatchEvent(new CustomEvent(name, { detail }));
}

export function createOnekanStateStore(rawClient) {
  const bases = new Map();
  const objectBases = new WeakMap();
  const listeners = new Set();
  let sequence = 0;
  let writeChain = Promise.resolve();

  function baseFingerprint(state) {
    const text = JSON.stringify(state);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `${text.length.toString(36)}-${(hash >>> 0).toString(36)}`;
  }

  function rememberBase(state) {
    if (!isPlainObject(state)) return state;
    const clean = stripStateStoreMeta(state);
    const fingerprint = baseFingerprint(clean);
    let token = `onekan-${fingerprint}`;
    const existing = bases.get(token);
    if (existing && !deepEqual(existing, clean)) token = `${token}-${(++sequence).toString(36)}`;
    if (!bases.has(token)) bases.set(token, clean);
    else {
      const snapshot = bases.get(token);
      bases.delete(token);
      bases.set(token, snapshot);
    }
    objectBases.set(state, token);
    state[STATE_STORE_META_KEY] = token;
    while (bases.size > MAX_BASES) bases.delete(bases.keys().next().value);
    return state;
  }

  function tokenFor(state) {
    if (!isPlainObject(state)) return null;
    return objectBases.get(state) || (typeof state[STATE_STORE_META_KEY] === "string" ? state[STATE_STORE_META_KEY] : null);
  }

  function baseFor(state) {
    const token = tokenFor(state);
    if (!token || !bases.has(token)) return null;
    const snapshot = bases.get(token);
    bases.delete(token);
    bases.set(token, snapshot);
    return snapshot;
  }

  function tagReadResult(result) {
    if (!result || result.error) return result;
    const rows = Array.isArray(result.data) ? result.data : [result.data];
    for (const row of rows) {
      if (isPlainObject(row?.data)) rememberBase(row.data);
    }
    return result;
  }

  async function resolveUserId(provided) {
    if (provided) return provided;
    const { data } = await rawClient.auth.getSession();
    return data?.session?.user?.id || null;
  }

  async function fetchRemote(userId) {
    const { data, error } = await rawClient.from("onekan_state").select("data").eq("user_id", userId).maybeSingle();
    if (error) throw error;
    return isPlainObject(data?.data) ? stripStateStoreMeta(data.data) : {};
  }

  function notify(detail) {
    for (const listener of listeners) {
      try { listener(detail); } catch (error) { console.error("onekan state-store subscriber failed", error); }
    }
    browserDispatch("onekan:state-store-committed", detail);
  }

  async function withCrossTabLock(operation) {
    const locks = typeof navigator !== "undefined" ? navigator.locks : null;
    if (!locks?.request) return operation();
    return locks.request("onekan-state-write", { mode: "exclusive" }, operation);
  }

  function enqueue(operation) {
    const run = () => withCrossTabLock(operation);
    const next = writeChain.then(run, run);
    writeChain = next.catch(() => undefined);
    return next;
  }

  async function mergePayloadRow(row) {
    if (!isPlainObject(row) || !isPlainObject(row.data) || !row.user_id) return { row, mergedState: null };
    const local = stripStateStoreMeta(row.data);
    const remote = await fetchRemote(row.user_id);
    const base = baseFor(row.data) || remote;
    const mergedState = threeWayMerge(base, local, remote);
    return { row: { ...row, data: mergedState }, mergedState };
  }

  async function executeUpsert(payload, options, chain = []) {
    return enqueue(async () => {
      const rows = Array.isArray(payload) ? payload : [payload];
      const mergedRows = [];
      const mergedStates = [];
      for (const row of rows) {
        const merged = await mergePayloadRow(row);
        mergedRows.push(merged.row);
        if (merged.mergedState && row?.data) {
          mergedStates.push({ userId: row.user_id, state: cloneValue(merged.mergedState) });
        }
      }

      let builder = rawClient.from("onekan_state").upsert(Array.isArray(payload) ? mergedRows : mergedRows[0], options);
      for (const [method, args] of chain) builder = builder[method](...args);
      const result = tagReadResult(await builder);
      if (!result?.error) {
        for (const entry of mergedStates) notify({ source: "state-store-upsert", ...entry });
      }
      return result;
    });
  }

  async function executeInsert(payload, options, chain = []) {
    return enqueue(async () => {
      const cleanPayload = Array.isArray(payload)
        ? payload.map((row) => isPlainObject(row?.data) ? { ...row, data: stripStateStoreMeta(row.data) } : row)
        : isPlainObject(payload?.data) ? { ...payload, data: stripStateStoreMeta(payload.data) } : payload;
      let builder = rawClient.from("onekan_state").insert(cleanPayload, options);
      for (const [method, args] of chain) builder = builder[method](...args);
      const result = tagReadResult(await builder);
      if (!result?.error) {
        const rows = Array.isArray(payload) ? payload : [payload];
        for (const row of rows) {
          if (!isPlainObject(row?.data)) continue;
          rememberBase(row.data);
          notify({ source: "state-store-insert", userId: row.user_id || null, state: stripStateStoreMeta(row.data) });
        }
      }
      return result;
    });
  }

  async function read({ userId = null } = {}) {
    const resolved = await resolveUserId(userId);
    if (!resolved) return null;
    const { data, error } = await rawClient.from("onekan_state").select("data").eq("user_id", resolved).maybeSingle();
    if (error) throw error;
    const current = isPlainObject(data?.data) ? cloneValue(data.data) : {};
    return rememberBase(current);
  }

  async function mutate(mutator, { userId = null, source = "state-store" } = {}) {
    const resolved = await resolveUserId(userId);
    if (!resolved) return null;
    return enqueue(async () => {
      const remote = await fetchRemote(resolved);
      const next = cloneValue(remote);
      const maybeReplacement = await mutator(next);
      const finalState = isPlainObject(maybeReplacement) ? maybeReplacement : next;
      const clean = stripStateStoreMeta(finalState);
      const { error } = await rawClient.from("onekan_state").upsert({ user_id: resolved, data: clean }, { onConflict: "user_id" });
      if (error) throw error;
      const tagged = rememberBase(cloneValue(clean));
      const detail = { source, userId: resolved, state: cloneValue(clean) };
      notify(detail);
      browserDispatch("onekan:state-changed", { source, state: cloneValue(clean) });
      return tagged;
    });
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    read,
    mutate,
    subscribe,
    tagReadResult,
    executeUpsert,
    executeInsert,
    rememberBase,
  };
}

function wrapReadBuilder(builder, store) {
  return new Proxy(builder, {
    get(target, prop) {
      if (prop === "then") {
        return (resolve, reject) => target.then((result) => resolve(store.tagReadResult(result)), reject);
      }
      const value = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      return (...args) => {
        const result = value.apply(target, args);
        return result && typeof result === "object" && typeof result.then === "function" ? wrapReadBuilder(result, store) : result;
      };
    },
  });
}

function deferredWrite(executor) {
  const chain = [];
  let running = null;
  const execute = () => running || (running = executor([...chain]));
  const proxy = new Proxy({}, {
    get(_target, prop) {
      if (prop === "then") return (resolve, reject) => execute().then(resolve, reject);
      if (prop === "catch") return (reject) => execute().catch(reject);
      if (prop === "finally") return (handler) => execute().finally(handler);
      if (typeof prop === "symbol") return undefined;
      return (...args) => {
        if (running) throw new Error("Cannot extend an already executing onekan_state write query.");
        chain.push([prop, args]);
        return proxy;
      };
    },
  });
  return proxy;
}

export function createStateStoreClient(rawClient) {
  const store = createOnekanStateStore(rawClient);
  const client = new Proxy(rawClient, {
    get(target, prop) {
      if (prop === "from") {
        return (table) => {
          const builder = target.from(table);
          if (table !== "onekan_state") return builder;
          return new Proxy(builder, {
            get(tableTarget, tableProp) {
              if (tableProp === "upsert") return (payload, options) => deferredWrite((chain) => store.executeUpsert(payload, options, chain));
              if (tableProp === "insert") return (payload, options) => deferredWrite((chain) => store.executeInsert(payload, options, chain));
              const value = Reflect.get(tableTarget, tableProp, tableTarget);
              if (typeof value !== "function") return value;
              return (...args) => {
                const result = value.apply(tableTarget, args);
                return result && typeof result === "object" && typeof result.then === "function" ? wrapReadBuilder(result, store) : result;
              };
            },
          });
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { client, store };
}
