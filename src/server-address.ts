const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3001;

export interface ServerAddressOptions {
  hostname?: string;
  port?: number | string;
}

export function resolveServerAddress(options: ServerAddressOptions = {}) {
  const hostname = (options.hostname ?? process.env.ZUU_HOST ?? DEFAULT_HOST).trim() || DEFAULT_HOST;
  const port = parsePort(options.port ?? process.env.ZUU_PORT ?? process.env.PORT ?? DEFAULT_PORT);
  return {
    hostname,
    port,
    loopback: isLoopbackHostname(hostname),
    url: `http://${hostForUrl(hostname)}:${port}`,
  };
}

function parsePort(value: number | string) {
  const port = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("ZUU_PORT must be an integer from 1 to 65535");
  }
  return port;
}

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "::1" || normalized.startsWith("127.");
}

function hostForUrl(hostname: string) {
  return hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname;
}
