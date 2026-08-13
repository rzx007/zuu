import type { PackageMutationRequest } from "@zuu/client";
import { assertObject, requireString } from "../server";

export function parsePackageMutation(value: unknown): PackageMutationRequest {
  assertObject(value);
  return { source: requireString(value.source, "source") };
}
