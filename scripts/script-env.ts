export function envString(name: string, fallback?: string) {
  const value = process.env[name]?.trim();
  return value || fallback;
}

export function envFlag(name: string) {
  const value = envString(name);
  if (!value) return false;
  if (value === "1") return true;
  if (value === "0") return false;
  throw new Error(`${name} must be 1 or 0.`);
}

export function envPositiveInteger(name: string) {
  const raw = envString(name);
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}

export function envEnum<T extends string>(name: string, values: readonly T[]) {
  const value = envString(name);
  if (!value) return undefined;
  if (!values.includes(value as T)) {
    throw new Error(`${name} must be one of ${values.join(", ")}.`);
  }
  return value as T;
}
