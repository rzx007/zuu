const PATH_INPUT_KEYS = new Set([
  "cwd",
  "dir",
  "directory",
  "exclude",
  "file",
  "files",
  "glob",
  "include",
  "path",
  "paths",
  "root",
  "target",
]);
const SENSITIVE_PATH_BASENAMES = new Set([
  ".env",
  "id_rsa",
  "id_ed25519",
  "id_ecdsa",
  "id_dsa",
  "auth.json",
  "auth-token.json",
  ".npmrc",
  ".netrc",
  ".pypirc",
]);
const SENSITIVE_PATH_SEGMENTS = new Set([".ssh", "credential", "credentials", "secret", "secrets", "token", "tokens"]);
const SENSITIVE_PATH_EXTENSIONS = [".credential", ".secret", ".token", ".pem", ".key", ".p12", ".pfx"];

export function inputReferencesSensitivePath(input: unknown) {
  return collectPathCandidates(input).some(isSensitivePathCandidate);
}

function collectPathCandidates(value: unknown, key?: string): string[] {
  if (typeof value === "string") {
    return isPathInputKey(key) || looksLikePath(value) ? [value] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectPathCandidates(item, key));
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  return Object.entries(value).flatMap(([childKey, childValue]) => collectPathCandidates(childValue, childKey));
}

function isPathInputKey(key: string | undefined) {
  return Boolean(key && PATH_INPUT_KEYS.has(key.toLowerCase()));
}

function looksLikePath(value: string) {
  return value.startsWith(".") || value.includes("/") || value.includes("\\") || /^[a-z]:/i.test(value);
}

function isSensitivePathCandidate(value: string) {
  const normalized = value.replace(/\\/g, "/").toLowerCase();
  const segments = normalized.split("/").filter(Boolean);
  const basename = segments[segments.length - 1] || normalized;
  return (
    SENSITIVE_PATH_BASENAMES.has(basename) ||
    segments.some((segment) => SENSITIVE_PATH_SEGMENTS.has(segment)) ||
    SENSITIVE_PATH_EXTENSIONS.some((extension) => basename.endsWith(extension))
  );
}
