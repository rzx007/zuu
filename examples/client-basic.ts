import { createZuuClient } from "@zuu/client";

const client = createZuuClient({
  baseUrl: process.env.ZUU_BASE_URL ?? "http://127.0.0.1:3001",
  apiToken: process.env.ZUU_API_TOKEN,
});

const health = await client.health();
const models = await client.listModels();
const packages = await client.listPackages();

console.log("health", health);
console.log("models", models.models.map((model) => model.id));
console.log("packages", packages.packages.map((item) => `${item.source}:${item.loadStatus}`));

const prompt = process.env.ZUU_EXAMPLE_PROMPT?.trim();
if (prompt) {
  for await (const event of client.prompt({ prompt })) {
    console.log(event);
  }
}
