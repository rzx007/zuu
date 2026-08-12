import type { ApiErrorResponse, AuditEventsQuery } from "./protocol.js";

export class ZuuClientError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;
  readonly retryable: boolean;

  constructor(message: string, options: { status: number; retryable?: boolean; code?: string; details?: unknown }) {
    super(message);
    this.name = "ZuuClientError";
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
    this.retryable = options.retryable ?? false;
  }
}

export function joinUrl(baseUrl: string, path: string) {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  return `${normalizedBase}${path}`;
}

export function withQuery(path: string, query: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }
  return params.size ? `${path}?${params}` : path;
}

export function withAuditQuery(query: number | AuditEventsQuery | undefined) {
  if (typeof query === "number") return withQuery("/v1/audit-events", { limit: String(query) });
  return withQuery("/v1/audit-events", {
    limit: query?.limit === undefined ? undefined : String(query.limit),
    action: query?.action,
    outcome: query?.outcome,
    target: query?.target,
    authScope: query?.authScope,
    authActor: query?.authActor,
    authTokenId: query?.authTokenId,
    since: query?.since,
    until: query?.until,
  });
}

export async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const data = parseJson(text);

  if (!response.ok) {
    const error = isApiErrorResponse(data) ? data.error : undefined;
    throw new ZuuClientError(String(error?.message ?? response.statusText), {
      status: error?.status ?? response.status,
      retryable: error?.retryable,
      code: error?.code,
      details: error?.details,
    });
  }

  return data as T;
}

export async function requestJson<T>(
  fetchImpl: typeof fetch,
  baseUrl: string,
  path: string,
  init?: RequestInit,
  apiToken?: string,
): Promise<T> {
  const response = await fetchImpl(joinUrl(baseUrl, path), {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(apiToken ? { authorization: `Bearer ${apiToken}` } : {}),
      ...init?.headers,
    },
  });

  return parseJsonResponse<T>(response);
}

function parseJson(text: string) {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  return Boolean(
    value &&
      typeof value === "object" &&
      "error" in value &&
      value.error &&
      typeof value.error === "object" &&
      "message" in value.error,
  );
}
