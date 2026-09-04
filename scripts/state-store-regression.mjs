import assert from "node:assert/strict";
import {
  STATE_STORE_META_KEY,
  createOnekanStateStore,
  stripStateStoreMeta,
  threeWayMerge,
} from "../js/state-store.js";

const base = {
  tasks: [{ id: "t1", title: "A", subtaskProgress: {} }],
  habitDays: { "2026-09-03": { h1: false } },
  ui: { sidebarCollapsed: false },
};

const remote = structuredClone(base);
remote.tasks[0].subtaskProgress.s1 = true;
const local = structuredClone(base);
local.habitDays["2026-09-03"].h1 = true;
const merged = threeWayMerge(base, local, remote);
assert.equal(merged.tasks[0].subtaskProgress.s1, true);
assert.equal(merged.habitDays["2026-09-03"].h1, true);

const added = threeWayMerge(
  { tasks: [{ id: "a", title: "a" }] },
  { tasks: [{ id: "a", title: "a" }, { id: "b", title: "b" }] },
  { tasks: [{ id: "a", title: "a" }, { id: "c", title: "c" }] },
);
assert.deepEqual(added.tasks.map((item) => item.id), ["a", "b", "c"]);

const fieldMerge = threeWayMerge(
  { tasks: [{ id: "a", title: "old", done: false }] },
  { tasks: [{ id: "a", title: "new", done: false }] },
  { tasks: [{ id: "a", title: "old", done: true }] },
);
assert.deepEqual(fieldMerge.tasks, [{ id: "a", title: "new", done: true }]);

const deleted = threeWayMerge(
  { tasks: [{ id: "a", title: "a" }, { id: "b", title: "b" }] },
  { tasks: [{ id: "b", title: "b" }] },
  { tasks: [{ id: "a", title: "a" }, { id: "b", title: "b" }, { id: "c", title: "c" }] },
);
assert.deepEqual(deleted.tasks.map((item) => item.id), ["b", "c"]);

const tagged = { tasks: [], [STATE_STORE_META_KEY]: "temporary" };
assert.equal(stripStateStoreMeta(tagged)[STATE_STORE_META_KEY], undefined);

class FakeBuilder {
  constructor(db, mode = "select", payload = null) {
    this.db = db;
    this.mode = mode;
    this.payload = payload;
  }

  select() { return this; }
  eq() { return this; }
  maybeSingle() { return this; }

  then(resolve, reject) {
    try {
      if (this.mode === "select") {
        return Promise.resolve({ data: { data: structuredClone(this.db.data) }, error: null }).then(resolve, reject);
      }
      if (this.mode === "upsert" || this.mode === "insert") {
        this.db.data = structuredClone(this.payload.data);
        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
      }
      throw new Error(`unknown fake mode: ${this.mode}`);
    } catch (error) {
      return Promise.reject(error).then(resolve, reject);
    }
  }
}

class FakeClient {
  constructor(data) {
    this.db = { data: structuredClone(data) };
    this.auth = {
      getSession: async () => ({ data: { session: { user: { id: "u1" } } } }),
    };
  }

  from() {
    const db = this.db;
    return {
      select() { return new FakeBuilder(db, "select"); },
      upsert(payload) { return new FakeBuilder(db, "upsert", payload); },
      insert(payload) { return new FakeBuilder(db, "insert", payload); },
    };
  }
}

const raw = new FakeClient(base);
const store = createOnekanStateStore(raw);
const first = await store.read({ userId: "u1" });
const repeated = await store.read({ userId: "u1" });
assert.ok(first[STATE_STORE_META_KEY]);
assert.equal(first[STATE_STORE_META_KEY], repeated[STATE_STORE_META_KEY]);

await store.mutate((current) => {
  current.tasks[0].subtaskProgress.s1 = true;
  return current;
}, { userId: "u1", source: "test-external" });
await store.mutate((current) => {
  current.habitDays["2026-09-03"].h1 = true;
  return current;
}, { userId: "u1", source: "test-app" });
assert.equal(raw.db.data.tasks[0].subtaskProgress.s1, true);
assert.equal(raw.db.data.habitDays["2026-09-03"].h1, true);
assert.equal(raw.db.data[STATE_STORE_META_KEY], undefined);

const concurrentRaw = new FakeClient(base);
const concurrentStore = createOnekanStateStore(concurrentRaw);
await Promise.all([
  concurrentStore.mutate((current) => {
    current.tasks[0].subtaskProgress.s2 = true;
    return current;
  }, { userId: "u1", source: "test-one" }),
  concurrentStore.mutate((current) => {
    current.ui.sidebarCollapsed = true;
    return current;
  }, { userId: "u1", source: "test-two" }),
]);
assert.equal(concurrentRaw.db.data.tasks[0].subtaskProgress.s2, true);
assert.equal(concurrentRaw.db.data.ui.sidebarCollapsed, true);

console.log("state store regression: ok");
