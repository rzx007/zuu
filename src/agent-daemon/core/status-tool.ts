import { Type } from "typebox";
import {
  defineTool,
  type DefaultResourceLoader,
  type SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { packageSourceToString } from "./environment";

interface StatusToolOptions {
  cwd: string;
  startedAt: string;
  getSessionCount: () => number;
  settingsManager: SettingsManager;
  resourceLoader: DefaultResourceLoader;
}

export function createStatusTool(options: StatusToolOptions) {
  return defineTool({
    name: "zuu_status",
    label: "Zuu Status",
    description: "Report daemon, session, model, and resource status for this Zuu agent app.",
    parameters: Type.Object({}),
    execute: async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              daemonStartedAt: options.startedAt,
              cwd: options.cwd,
              sessions: options.getSessionCount(),
              packages: options.settingsManager.getPackages().map(packageSourceToString),
              resources: {
                skills: options.resourceLoader.getSkills().skills.length,
                prompts: options.resourceLoader.getPrompts().prompts.length,
                extensions: options.resourceLoader.getExtensions().extensions.length,
              },
            },
            null,
            2,
          ),
        },
      ],
      details: {},
    }),
  });
}
