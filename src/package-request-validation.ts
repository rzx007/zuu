import type { PackageMutationRequest } from "@zuu/client";
import { assertObject, requireString } from "./http";

export function parsePackageMutation(value: unknown): PackageMutationRequest {
  assertObject(value);
  return { source: requireString(value.source, "source") };
}
