import { closeSync, openSync, statSync, unlinkSync, writeFileSync } from "node:fs";

const STORE_LOCK_TIMEOUT_MS = 5_000;
const STORE_LOCK_STALE_MS = 30_000;
const STORE_LOCK_RETRY_MS = 25;

export interface JsonStoreLockStatus {
  lockPath: string;
  locked: boolean;
  lockStale: boolean;
  lockAgeMs?: number;
}

export function inspectStoreLock(storePath: string): JsonStoreLockStatus {
  const lockPath = `${storePath}.lock`;
  try {
    const lockAgeMs = Math.max(0, Date.now() - statSync(lockPath).mtimeMs);
    return {
      lockPath,
      locked: true,
      lockStale: lockAgeMs > STORE_LOCK_STALE_MS,
      lockAgeMs,
    };
  } catch {
    return {
      lockPath,
      locked: false,
      lockStale: false,
    };
  }
}

export function withStoreLock<T>(storePath: string, fn: () => T): T {
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
