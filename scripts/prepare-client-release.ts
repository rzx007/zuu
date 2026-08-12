import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface PackageJson {
  version: string;
}

const version = readVersionArg();
const root = process.cwd();
const clientDir = join(root, "packages", "client");
const packageJsonPath = join(clientDir, "package.json");
const changelogPath = join(clientDir, "CHANGELOG.md");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJson;

if (packageJson.version === version) {
  throw new Error(`@zuu/client is already at ${version}`);
}

packageJson.version = version;
writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

const date = new Date().toISOString().slice(0, 10);
const changelog = readFileSync(changelogPath, "utf8");
const releaseEntry = [
  `## ${version} - ${date}`,
  "",
  "- 发布前请把本版本的用户可见变更整理到这里。",
  "- 运行 `pnpm client:release:check` 确认 dist、README、CHANGELOG 和 package metadata 完整。",
  "",
].join("\n");
const nextChangelog = changelog.replace(/(# @zuu\/client 更新日志\r?\n\r?\n)/, `$1${releaseEntry}`);
if (nextChangelog === changelog) {
  throw new Error("Could not find changelog title");
}
writeFileSync(changelogPath, nextChangelog, "utf8");

console.log(`Prepared @zuu/client ${version}`);

function readVersionArg() {
  const flagIndex = process.argv.indexOf("--version");
  const value = flagIndex >= 0 ? process.argv[flagIndex + 1] : process.env.ZUU_CLIENT_VERSION;
  if (!value?.match(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)) {
    throw new Error("Usage: pnpm client:release:prepare --version <semver>");
  }
  return value;
}
