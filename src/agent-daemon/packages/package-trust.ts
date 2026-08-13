import type { PackageTrustRecord } from "@zuu/client";
import { JsonFileStore } from "../storage/json-file-store";

function isPackageTrustRecord(value: unknown): value is PackageTrustRecord {
  return Boolean(
    value &&
      typeof value === "object" &&
      "source" in value &&
      "status" in value,
  );
}

function loadPackageTrust(path: string): PackageTrustRecord[] {
  return createPackageTrustStore(path).load(Array.isArray).filter(isPackageTrustRecord);
}

function savePackageTrust(path: string, records: PackageTrustRecord[]) {
  createPackageTrustStore(path).save(records);
}

function createPackageTrustStore(path: string) {
  return new JsonFileStore<unknown[]>({
    name: "package-trust",
    path,
    defaultValue: [],
    countRecords: (value) => value.length,
  });
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
