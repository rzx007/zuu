import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface PackageJson {
  name?: string;
  version?: string;
  description?: string;
  type?: string;
  sideEffects?: boolean;
  main?: string;
  types?: string;
  exports?: Record<string, unknown>;
  files?: string[];
  publishConfig?: { access?: string };
}

const root = process.cwd();
const clientDir = join(root, "packages", "client");
const packageJsonPath = join(clientDir, "package.json");
const packageJson = readJson<PackageJson>(packageJsonPath);
const errors: string[] = [];

expect(packageJson.name === "@zuu/client", "package name must be @zuu/client");
expect(Boolean(packageJson.version?.match(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)), "package version must be semver");
expect(packageJson.type === "module", "package type must be module");
expect(packageJson.sideEffects === false, "package sideEffects must be false");
expect(packageJson.main === "./dist/index.js", "package main must point at ./dist/index.js");
expect(packageJson.types === "./dist/index.d.ts", "package types must point at ./dist/index.d.ts");
expect(packageJson.publishConfig?.access === "public", "publishConfig.access must be public");

const rootExport = packageJson.exports?.["."] as Record<string, unknown> | undefined;
expect(rootExport?.import === packageJson.main, "exports[.].import must match main");
expect(rootExport?.types === packageJson.types, "exports[.].types must match types");

for (const entry of ["dist", "README.md", "CHANGELOG.md"]) {
  expect(packageJson.files?.includes(entry) === true, `files must include ${entry}`);
}

for (const file of ["dist/index.js", "dist/index.d.ts", "README.md", "CHANGELOG.md"]) {
  expect(existsSync(join(clientDir, file)), `${file} must exist before publishing`);
}

const readme = readFileSync(join(clientDir, "README.md"), "utf8");
expect(readme.includes("createZuuClient"), "README must document createZuuClient usage");
expect(readme.includes("createAuthToken"), "README must document auth token management");

const changelog = readFileSync(join(clientDir, "CHANGELOG.md"), "utf8");
expect(Boolean(packageJson.version && changelog.includes(`## ${packageJson.version}`)), "CHANGELOG must contain the current package version");

if (errors.length) {
  for (const error of errors) console.error(`client release check failed: ${error}`);
  process.exitCode = 1;
} else {
  console.log(`@zuu/client ${packageJson.version} release metadata ok`);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function expect(condition: boolean, message: string) {
  if (!condition) errors.push(message);
}
