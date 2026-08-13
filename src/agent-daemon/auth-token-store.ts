import { chmodSync } from "node:fs";
import { JsonFileStore } from "./json-file-store";
import {
  createStoredToken,
  DEFAULT_ACTOR,
  DEFAULT_TOKEN_RECORD,
  type AuthTokenRecord,
} from "./auth-tokens";
import { isAuthTokenRecord } from "./auth-token-validation";

const TOKEN_USAGE_TOUCH_INTERVAL_MS = 30_000;

export class LocalAuthTokenStore {
  private readonly store: JsonFileStore<AuthTokenRecord>;
  private record: AuthTokenRecord | undefined;

  constructor(private readonly path: string) {
    this.store = new JsonFileStore<AuthTokenRecord>({
      name: "auth-token",
      path,
      defaultValue: DEFAULT_TOKEN_RECORD,
      countRecords: (value) => value.tokens.length,
    });
    this.record = this.loadOrCreate();
  }

  get() {
    const record = this.record ?? this.loadOrCreate();
    this.record = record;
    return record;
  }

  save(record: AuthTokenRecord) {
    this.store.save(record);
    this.record = record;
    try {
      chmodSync(this.path, 0o600);
    } catch {
      // Best effort on Windows and filesystems that do not support POSIX modes.
    }
  }

  touchUsage(tokenId: string) {
    const record = this.get();
    const token = record.tokens.find((item) => item.id === tokenId);
    if (!token) return;
    const nowMs = Date.now();
    if (token.lastUsedAt && Date.parse(token.lastUsedAt) > nowMs - TOKEN_USAGE_TOUCH_INTERVAL_MS) return;
    const lastUsedAt = new Date(nowMs).toISOString();
    this.save({
      ...record,
      tokens: record.tokens.map((item) => (item.id === tokenId ? { ...item, lastUsedAt } : item)),
    });
  }

  private loadOrCreate() {
    const loaded = this.store.load(isAuthTokenRecord);
    if (loaded.tokens.some((token) => token.scope === "admin") && loaded.tokens.some((token) => token.scope === "read")) return loaded;

    const now = new Date().toISOString();
    const record: AuthTokenRecord = {
      createdAt: now,
      tokens: [
        createStoredToken("local-admin", DEFAULT_ACTOR, "admin", now),
        createStoredToken("local-read", DEFAULT_ACTOR, "read", now),
      ],
    };
    this.save(record);
    return record;
  }
}
