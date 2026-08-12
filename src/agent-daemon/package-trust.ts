import { readFileSync, writeFileSync } from "node:fs";
import type { PackageTrustRecord } from "@zuu/client";

function isPackageTrustRecord(value: unknown): value is PackageTrustRecord {
  return Boolean(
    value &&
      typeof value === "object" &&
      "source" in value &&
      "status" in value,
  );
}

function loadPackageTrust(path: string): PackageTrustRecord[] {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isPackageTrustRecord) : [];
  } catch {
    return [];
  }
}

function savePackageTrust(path: string, records: PackageTrustRecord[]) {
  writeFileSync(path, `${JSON.stringify(records, null, 2)}\n`, "utf8");
}

export class PackageTrustStore {
  private readonly records: Map<string, PackageTrustRecord>;

  constructor(private readonly path: string) {
    this.records = new Map(loadPackageTrust(path).map((record) => [record.source, record]));
  }

  get(source: string): PackageTrustRecord {
    return this.records.get(source) ?? { source, status: "untrusted" };
  }

  isTrusted(source: string) {
    return this.get(source).status === "trusted";
  }

  trust(source: string) {
    const record: PackageTrustRecord = {
      source,
      status: "trusted",
      trustedAt: new Date().toISOString(),
    };
    this.records.set(source, record);
    this.persist();
    return record;
  }

  revoke(source: string) {
    const record: PackageTrustRecord = { source, status: "untrusted" };
    this.records.set(source, record);
    this.persist();
    return record;
  }

  private persist() {
    savePackageTrust(this.path, [...this.records.values()].sort((a, b) => a.source.localeCompare(b.source)));
  }
}
