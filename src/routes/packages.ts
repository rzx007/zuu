import { jsonError, readJson, toStatus } from "../http";
import { parsePackageMutation } from "../request-validation";
import type { RouteDeps } from "./types";

export function registerPackageRoutes({ app, daemon }: RouteDeps) {
  app.get("/v1/packages", (c) => c.json(daemon.listPackages()));

  app.get("/v1/package-operations", (c) => c.json(daemon.listPackageOperations()));

  app.get("/v1/package-operations/:operationId", (c) => {
    try {
      return c.json(daemon.getPackageOperation(c.req.param("operationId")));
    } catch (error) {
      return c.json(jsonError(error, 404), toStatus(error, 404));
    }
  });

  app.post("/v1/packages", async (c) => {
    try {
      const body = parsePackageMutation(await readJson(c.req));
      return c.json(await daemon.addPackage(body));
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.post("/v1/packages/install", async (c) => {
    try {
      const body = parsePackageMutation(await readJson(c.req));
      return c.json(await daemon.installPackage(body));
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.post("/v1/packages/update", async (c) => {
    try {
      const body = parsePackageMutation(await readJson(c.req));
      return c.json(await daemon.updatePackage(body));
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.delete("/v1/packages", async (c) => {
    try {
      const body = parsePackageMutation(await readJson(c.req));
      return c.json(await daemon.removePackage(body));
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.post("/v1/packages/trust", async (c) => {
    try {
      const body = parsePackageMutation(await readJson(c.req));
      return c.json(await daemon.trustPackage(body));
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });

  app.delete("/v1/packages/trust", async (c) => {
    try {
      const body = parsePackageMutation(await readJson(c.req));
      return c.json(await daemon.revokePackageTrust(body));
    } catch (error) {
      return c.json(jsonError(error, 400), toStatus(error, 400));
    }
  });
}
