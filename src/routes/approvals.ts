import type { ApprovalStatus } from "@zuu/client";
import { jsonError, readJson, toStatus } from "../server";
import { parseResolveApproval } from "../validation";
import type { RouteDeps } from "./types";

export function registerApprovalRoutes({ app, daemon }: RouteDeps) {
  app.get("/v1/approvals", (c) => {
    try {
      return c.json({ approvals: daemon.api.approvalApiService.listApprovals(c.req.query("status") as ApprovalStatus | undefined) });
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.get("/v1/approvals/:approvalId", (c) => {
    try {
      return c.json({ approval: daemon.api.approvalApiService.getApproval(c.req.param("approvalId")) });
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.post("/v1/approvals/:approvalId/resolve", async (c) => {
    try {
      const body = parseResolveApproval(await readJson(c.req));
      return c.json({ approval: daemon.api.approvalApiService.resolveApproval(c.req.param("approvalId"), body) });
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });
}
