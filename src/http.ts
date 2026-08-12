import type { ApiErrorResponse } from "@zuu/client";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly retryable: boolean;

  constructor(message: string, options: { status?: number; code?: string; details?: unknown; retryable?: boolean } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = options.status ?? 500;
    this.code = options.code ?? "internal_error";
    this.details = options.details;
    this.retryable = options.retryable ?? false;
  }
}

export function jsonError(error: unknown, fallbackStatus = 500): ApiErrorResponse {
  if (error instanceof ApiError) {
    return {
      error: {
        message: error.message,
        status: error.status,
        retryable: error.retryable,
        code: error.code,
        details: error.details,
      },
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    error: {
      message,
      status: fallbackStatus,
      retryable: false,
      code: statusToCode(fallbackStatus),
    },
  };
}

export function toStatus(error: unknown, fallbackStatus = 500): ContentfulStatusCode {
  return asContentfulStatus(error instanceof ApiError ? error.status : fallbackStatus);
}

export function validationError(message: string, details?: unknown): never {
  throw new ApiError(message, { status: 400, code: "validation_failed", details });
}

export async function readJson(request: { raw?: Request; json(): Promise<unknown> }, options: { optional?: boolean } = {}) {
  if (request.raw) {
    const text = await request.raw.clone().text();
    if (!text.trim()) {
      if (options.optional) return {};
      throw new ApiError("Request body must be valid JSON", { status: 400, code: "invalid_json" });
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new ApiError("Request body must be valid JSON", { status: 400, code: "invalid_json" });
    }
  }

  try {
    return await request.json();
  } catch {
    if (options.optional) return {};
    throw new ApiError("Request body must be valid JSON", { status: 400, code: "invalid_json" });
  }
}

export function assertObject(value: unknown, label = "request body"): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    validationError(`${label} must be an object`);
  }
}

export function requireString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    validationError(`${field} is required`, { field });
  }
  return value;
}

export function optionalString(value: unknown, field: string) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") validationError(`${field} must be a string`, { field });
  return value;
}

export function optionalBoolean(value: unknown, field: string) {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") validationError(`${field} must be a boolean`, { field });
  return value;
}

export function optionalStringArray(value: unknown, field: string) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    validationError(`${field} must be a string array`, { field });
  }
  return value;
}

export function optionalRecord(value: unknown, field: string) {
  if (value === undefined) return undefined;
  assertObject(value, field);
  return value;
}

function statusToCode(status: number) {
  if (status === 400) return "validation_failed";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  return "internal_error";
}

function asContentfulStatus(status: number): ContentfulStatusCode {
  if (status >= 200 && status !== 204 && status !== 205 && status !== 304 && status < 600) {
    return status as ContentfulStatusCode;
  }
  return 500;
}
