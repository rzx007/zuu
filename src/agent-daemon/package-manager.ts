import { DefaultPackageManager, type SettingsManager } from "@earendil-works/pi-coding-agent";
import { createSettingsManager } from "./package-settings";

export function createPackageManager(cwd: string, agentDir: string, settingsManager?: SettingsManager) {
  return new DefaultPackageManager({
    cwd,
    agentDir,
    settingsManager: settingsManager ?? createSettingsManager(cwd, agentDir),
  });
}
