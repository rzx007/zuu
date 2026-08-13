import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { backupJsonStoreFile, unwrapStoreData, writeJsonStoreValue } from "./json-store-file-io";
import { inspectStoreLock } from "./json-store-lock";

export interface JsonStoreStatus {
  name: string;
  path: string;
  ok: boolean;
  exists: boolean;
  recordCount: number;
  recovered: boolean;
  lockPath: string;
  locked: boolean;
  lockStale: boolean;
  lockAgeMs?: number;
  backupPath?: string;
  error?: string;
}

export interface JsonFileStoreOptions<T> {
  name: string;
  path: string;
  defaultValue: T;
  countRecords?: (value: T) => number;
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
      const backupPath = backupJsonStoreFile(this.path);
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
    writeJsonStoreValue(this.path, value);
  }

  inspect(): JsonStoreStatus {
    const status = statuses.get(this.path) ?? this.createStatus(this.defaultValue, { exists: existsSync(this.path) });
    return withCurrentLockStatus(status);
  }

  private updateStatus(value: T, patch: Partial<JsonStoreStatus> = {}) {
    statuses.set(this.path, this.createStatus(value, patch));
  }

  private createStatus(value: T, patch: Partial<JsonStoreStatus> = {}): JsonStoreStatus {
    const lock = inspectStoreLock(this.path);
    return {
      name: this.options.name,
      path: this.path,
      ok: !patch.error && !lock.lockStale,
      exists: patch.exists ?? existsSync(this.path),
      recordCount: this.countRecords(value),
      recovered: false,
      ...lock,
      ...patch,
    };
  }
}

export function inspectJsonStore(options: JsonFileStoreOptions<unknown>): JsonStoreStatus {
  return new JsonFileStore(options).inspect();
}

function defaultCountRecords(value: unknown) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.keys(value).length;
  return value === undefined ? 0 : 1;
}

function withCurrentLockStatus(status: JsonStoreStatus): JsonStoreStatus {
  const lock = inspectStoreLock(status.path);
  return {
    ...status,
    ...lock,
    ok: !status.error && !lock.lockStale,
  };
}
