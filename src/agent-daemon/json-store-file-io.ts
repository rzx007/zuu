import { copyFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { withStoreLock } from "./json-store-lock";

const STORE_VERSION = 1;

interface StoreEnvelope<T> {
  version: number;
  data: T;
}

export function unwrapStoreData<T>(value: unknown): T {
  if (value && typeof value === "object" && "version" in value && "data" in value) {
    return (value as StoreEnvelope<T>).data;
  }
  return value as T;
}

export function writeJsonStoreValue<T>(path: string, value: T) {
  mkdirSync(dirname(path), { recursive: true });
  withStoreLock(path, () => {
    const payload: StoreEnvelope<T> = {
      version: STORE_VERSION,
      data: value,
    };
    const tmpPath = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
    writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    renameSync(tmpPath, path);
  });
}

export function backupJsonStoreFile(path: string) {
  const backupPath = `${path}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}.bak`;
  try {
    copyFileSync(path, backupPath);
    return backupPath;
  } catch {
    return undefined;
  }
}
