import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const STORE_VERSION = 1;
const STORE_LOCK_TIMEOUT_MS = 5_000;
const STORE_LOCK_STALE_MS = 30_000;
const STORE_LOCK_RETRY_MS = 25;

export interface JsonStoreStatus {
  name: string;
  path: string;
  ok: boolean;
  exists: boolean;
  recordCount: number;
  recovered: boolean;
  backupPath?: string;
  error?: string;
}

export interface JsonFileStoreOptions<T> {
  name: string;
  path: string;
  defaultValue: T;
  countRecords?: (value: T) => number;
}

interface StoreEnvelope<T> {
  version: number;
  data: T;
}

const statuses = new Map<string, JsonStoreStatus>();

export class JsonFileStore<T> {
  private readonly path: string;
  private readonly defaultValue: T;
  private readonly countRecords: (value: T) => number;

  constructor(private readonly options: JsonFileStoreOptions<T>) {
    this.path = resolve(options.path);
    this.defaultValue = options.defaultValue;
    this.countRecords = options.countRecords ?? defaultCountRecords;
  }

  load(filter?: (value: unknown) => value is T): T {
    if (!existsSync(this.path)) {
      this.updateStatus(this.defaultValue, { exists: false });
      return this.defaultValue;
    }

    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8")) as unknown;
      const data = unwrapStoreData(raw);
      if (filter && !filter(data)) {
        throw new Error("Store data failed validation");
      }
      const value = data as T;
      this.updateStatus(value, { exists: true });
      return value;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const backupPath = this.backupCorruptFile();
      this.writeValue(this.defaultValue);
      this.updateStatus(this.defaultValue, {
        exists: true,
        recovered: true,
        backupPath,
        error: message,
      });
      return this.defaultValue;
    }
  }

  save(value: T) {
    this.writeValue(value);
    this.updateStatus(value, { exists: true });
  }

  private writeValue(value: T) {
    mkdirSync(dirname(this.path), { recursive: true });
    withStoreLock(this.path, () => {
      const payload: StoreEnvelope<T> = {
        version: STORE_VERSION,
        data: value,
      };
      const tmpPath = `${this.path}.${process.pid}.${crypto.randomUUID()}.tmp`;
      writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
      renameSync(tmpPath, this.path);
    });
  }

  inspect(): JsonStoreStatus {
    return statuses.get(this.path) ?? this.createStatus(this.defaultValue, { exists: existsSync(this.path) });
  }

  private backupCorruptFile() {
    const backupPath = `${this.path}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}.bak`;
    try {
      copyFileSync(this.path, backupPath);
      return backupPath;
    } catch {
      return undefined;
    }
  }

  private updateStatus(value: T, patch: Partial<JsonStoreStatus> = {}) {
    statuses.set(this.path, this.createStatus(value, patch));
  }

  private createStatus(value: T, patch: Partial<JsonStoreStatus> = {}): JsonStoreStatus {
    return {
      name: this.options.name,
      path: this.path,
      ok: !patch.error,
      exists: patch.exists ?? existsSync(this.path),
      recordCount: this.countRecords(value),
      recovered: false,
      ...patch,
    };
  }
}

export function inspectJsonStore(options: JsonFileStoreOptions<unknown>): JsonStoreStatus {
  return new JsonFileStore(options).inspect();
}

function unwrapStoreData<T>(value: unknown): T {
  if (value && typeof value === "object" && "version" in value && "data" in value) {
    return (value as StoreEnvelope<T>).data;
  }
  return value as T;
}

function defaultCountRecords(value: unknown) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.keys(value).length;
  return value === undefined ? 0 : 1;
}

function withStoreLock<T>(storePath: string, fn: () => T): T {
  const lockPath = `${storePath}.lock`;
  acquireStoreLock(lockPath);
  try {
    return fn();
  } finally {
    releaseStoreLock(lockPath);
  }
}

function acquireStoreLock(lockPath: string) {
  const startedAt = Date.now();
  while (true) {
    try {
      const fd = openSync(lockPath, "wx");
      try {
        writeFileSync(fd, `${process.pid}\n${new Date().toISOString()}\n`, "utf8");
      } catch (error) {
        releaseStoreLock(lockPath);
        throw error;
      } finally {
        closeSync(fd);
      }
      return;
    } catch (error) {
      cleanupStaleLock(lockPath);
      if (Date.now() - startedAt >= STORE_LOCK_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for JSON store lock: ${lockPath}`);
      }
      sleepSync(STORE_LOCK_RETRY_MS);
      if (!isFileExistsError(error)) throw error;
    }
  }
}

function cleanupStaleLock(lockPath: string) {
  try {
    if (Date.now() - statSync(lockPath).mtimeMs > STORE_LOCK_STALE_MS) {
      unlinkSync(lockPath);
    }
  } catch {
    // Missing or unreadable lock files are handled by the next acquisition attempt.
  }
}

function releaseStoreLock(lockPath: string) {
  try {
    unlinkSync(lockPath);
  } catch {
    // Best effort cleanup; stale lock handling protects future writers.
  }
}

function isFileExistsError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}

function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
