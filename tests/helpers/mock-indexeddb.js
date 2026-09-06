"use strict";

function copy(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

class MockIDBKeyRange {
  constructor(value) { this.value = value; }
  static only(value) { return new MockIDBKeyRange(value); }
  includes(value) { return value === this.value; }
}

class MockRequest {
  constructor() {
    this.result = undefined;
    this.error = null;
    this.onsuccess = null;
    this.onerror = null;
  }
  success(result) {
    this.result = result;
    if (typeof this.onsuccess === "function") this.onsuccess({ target: this });
  }
  fail(error) {
    this.error = error;
    if (typeof this.onerror === "function") this.onerror({ target: this });
  }
}

class MockCursor {
  constructor(entries, records, request) {
    this.entries = entries;
    this.records = records;
    this.request = request;
    this.position = 0;
  }
  get primaryKey() { return this.entries[this.position]?.[0]; }
  delete() { this.records.delete(this.primaryKey); }
  continue() {
    this.position += 1;
    queueMicrotask(() => this.request.success(
      this.position < this.entries.length ? this : null
    ));
  }
}

class MockIndex {
  constructor(definition, store) {
    this.definition = definition;
    this.store = store;
  }
  matches(value, query) {
    const indexedValue = value && value[this.definition.keyPath];
    return query instanceof MockIDBKeyRange
      ? query.includes(indexedValue)
      : indexedValue === query;
  }
  getAll(query) {
    return this.store.enqueue(() => [...this.store.records.values()]
      .filter(value => this.matches(value, query)).map(copy));
  }
  openKeyCursor(query) {
    const request = new MockRequest();
    this.store.transaction.enqueue(() => {
      const entries = [...this.store.records.entries()]
        .filter(([, value]) => this.matches(value, query));
      const cursor = new MockCursor(entries, this.store.records, request);
      request.success(entries.length ? cursor : null);
    });
    return request;
  }
}

class MockObjectStore {
  constructor(definition, records, transaction) {
    this.definition = definition;
    this.records = records;
    this.transaction = transaction;
  }
  createIndex(name, keyPath, options = {}) {
    this.definition.indexes.set(name, { keyPath, options });
    return new MockIndex(this.definition.indexes.get(name), this);
  }
  index(name) {
    const definition = this.definition.indexes.get(name);
    if (!definition) throw new Error(`Index "${name}" fehlt.`);
    return new MockIndex(definition, this);
  }
  enqueue(operation) {
    const request = new MockRequest();
    this.transaction.enqueue(() => request.success(operation()));
    return request;
  }
  put(value) {
    return this.enqueue(() => {
      const key = value && value[this.definition.keyPath];
      if (!key) throw new Error(`Key "${this.definition.keyPath}" fehlt.`);
      this.records.set(key, copy(value));
      return key;
    });
  }
  get(key) { return this.enqueue(() => copy(this.records.get(key))); }
  getAll() { return this.enqueue(() => [...this.records.values()].map(copy)); }
  count(key) {
    return this.enqueue(() => key === undefined
      ? this.records.size
      : (key instanceof MockIDBKeyRange
        ? [...this.records.keys()].filter(value => key.includes(value)).length
        : Number(this.records.has(key))));
  }
  delete(key) { return this.enqueue(() => this.records.delete(key)); }
  clear() { return this.enqueue(() => this.records.clear()); }
}

class MockTransaction {
  constructor(database, storeNames) {
    this.database = database;
    this.storeNames = Array.isArray(storeNames) ? storeNames : [storeNames];
    this.oncomplete = null;
    this.onerror = null;
    this.onabort = null;
    this.error = null;
    this.queue = [];
    this.running = false;
    this.completed = false;
  }
  objectStore(name) {
    if (!this.storeNames.includes(name)) throw new Error(`Store "${name}" ist nicht Teil der Transaktion.`);
    return new MockObjectStore(
      this.database.definitions.get(name),
      this.database.records.get(name),
      this
    );
  }
  enqueue(operation) {
    this.queue.push(operation);
    if (!this.running) {
      this.running = true;
      queueMicrotask(() => this.flush());
    }
  }
  flush() {
    try {
      while (this.queue.length) this.queue.shift()();
      this.running = false;
      setImmediate(() => {
        if (!this.running && !this.queue.length && !this.completed) {
          this.completed = true;
          if (typeof this.oncomplete === "function") this.oncomplete({ target: this });
        }
      });
    } catch (error) {
      this.error = error;
      if (typeof this.onerror === "function") this.onerror({ target: this });
    }
  }
}

class MockDatabase {
  constructor(name, version) {
    this.name = name;
    this.version = version;
    this.definitions = new Map();
    this.records = new Map();
    this.objectStoreNames = { contains: name => this.definitions.has(name) };
    this.onclose = null;
    this.onversionchange = null;
  }
  createObjectStore(name, options = {}) {
    const definition = { keyPath: options.keyPath || "id", indexes: new Map() };
    this.definitions.set(name, definition);
    this.records.set(name, new Map());
    return new MockObjectStore(definition, this.records.get(name), {
      enqueue(operation) { operation(); }
    });
  }
  transaction(storeNames) { return new MockTransaction(this, storeNames); }
  close() { if (typeof this.onclose === "function") this.onclose(); }
}

class MockIndexedDB {
  constructor() { this.databases = new Map(); }
  open(name, version = 1) {
    const request = new MockRequest();
    queueMicrotask(() => {
      let database = this.databases.get(name);
      const isNew = !database;
      if (!database) {
        database = new MockDatabase(name, version);
        this.databases.set(name, database);
      }
      request.result = database;
      if (isNew && typeof request.onupgradeneeded === "function") {
        request.onupgradeneeded({ target: request, oldVersion: 0, newVersion: version });
      }
      request.success(database);
    });
    return request;
  }
  deleteDatabase(name) {
    const request = new MockRequest();
    queueMicrotask(() => {
      this.databases.delete(name);
      request.success(undefined);
    });
    return request;
  }
}

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}

module.exports = { MockIDBKeyRange, MockIndexedDB, createMemoryStorage };
