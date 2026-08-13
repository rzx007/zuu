import type { PromptRequest } from "@zuu/client";
import { jsonError, readJson, toStatus } from "../server";
import { parsePrompt } from "../validation";
import { streamPromptResponse } from "./prompt-stream";
import type { RouteDeps } from "./types";

export function registerSessionPromptRoutes({ app, daemon }: RouteDeps) {
  app.post("/v1/prompt", async (c) => {
    let request: PromptRequest;
    try {
      request = parsePrompt(await readJson(c.req));
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }

    return streamPromptResponse(c, daemon, request);
  });

  app.post("/v1/sessions/:sessionId/prompts", async (c) => {
    let request: PromptRequest;
    try {
      request = { ...parsePrompt(await readJson(c.req)), sessionId: c.req.param("sessionId") };
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }

    return streamPromptResponse(c, daemon, request);
  });

  app.post("/v1/sessions/:sessionId/steer", async (c) => {
    let request: PromptRequest;
    try {
      request = {
        ...parsePrompt(await readJson(c.req)),
        sessionId: c.req.param("sessionId"),
        streamingBehavior: "steer",
      };
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }

    return streamPromptResponse(c, daemon, request);
  });

  app.post("/v1/sessions/:sessionId/follow-ups", async (c) => {
    let request: PromptRequest;
    try {
      request = {
        ...parsePrompt(await readJson(c.req)),
        sessionId: c.req.param("sessionId"),
        streamingBehavior: "followUp",
      };
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }

    return streamPromptResponse(c, daemon, request);
  });
}
