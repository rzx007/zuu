import { JsonFileStore } from "./json-file-store";

interface ScheduleLeaseRecord {
  ownerId: string;
  pid: number;
  updatedAt: string;
  expiresAt: string;
}

export interface ScheduleLeaseOptions {
  ownerId?: string;
  ttlMs?: number;
}

const DEFAULT_LEASE_TTL_MS = 15_000;

export class ScheduleLease {
  readonly ownerId: string;
  private readonly ttlMs: number;
  private readonly store: JsonFileStore<ScheduleLeaseRecord | null>;

  constructor(path: string, options: ScheduleLeaseOptions = {}) {
    this.ownerId = options.ownerId ?? `${process.pid}-${crypto.randomUUID()}`;
    this.ttlMs = options.ttlMs ?? DEFAULT_LEASE_TTL_MS;
    this.store = new JsonFileStore<ScheduleLeaseRecord | null>({
      name: "scheduler-lease",
      path,
      defaultValue: null,
      countRecords: (value) => (value ? 1 : 0),
    });
  }

  acquire(now = Date.now()) {
    const current = this.store.load(isScheduleLeaseRecordOrNull);
    if (current && current.ownerId !== this.ownerId && Date.parse(current.expiresAt) > now) {
      return false;
    }

    this.store.save(this.createRecord(now));
    return true;
  }

  heartbeat(now = Date.now()) {
    const current = this.store.load(isScheduleLeaseRecordOrNull);
    if (!current || current.ownerId !== this.ownerId) return false;
    this.store.save(this.createRecord(now));
    return true;
  }

  release() {
    const current = this.store.load(isScheduleLeaseRecordOrNull);
    if (current?.ownerId === this.ownerId) this.store.save(null);
  }

  private createRecord(now: number): ScheduleLeaseRecord {
    return {
      ownerId: this.ownerId,
      pid: process.pid,
      updatedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.ttlMs).toISOString(),
    };
  }
}

function isScheduleLeaseRecordOrNull(value: unknown): value is ScheduleLeaseRecord | null {
  return value === null || isScheduleLeaseRecord(value);
}

function isScheduleLeaseRecord(value: unknown): value is ScheduleLeaseRecord {
  return Boolean(
    value &&
      typeof value === "object" &&
      "ownerId" in value &&
      typeof value.ownerId === "string" &&
      "pid" in value &&
      typeof value.pid === "number" &&
      "updatedAt" in value &&
      typeof value.updatedAt === "string" &&
      "expiresAt" in value &&
      typeof value.expiresAt === "string",
  );
}
