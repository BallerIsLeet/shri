import { AIClient } from "./client.js";
import { loadAIConfig } from "./config.js";

// Lazy singleton: building the namespaces requires env, and we want tests
// that don't set OPENAI_API_KEY (i.e. skipIf-skipped tests) to still load
// this module without throwing at import time.
let _client: AIClient | undefined;

function getClient(): AIClient {
  if (!_client) _client = new AIClient(loadAIConfig());
  return _client;
}

export const aiClient = new Proxy({} as AIClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getClient(), prop, receiver);
  },
});

export { AIClient } from "./client.js";
export { loadAIConfig } from "./config.js";
export type { AIConfig, NamespaceConfig, TtsConfig } from "./config.js";
export * from "./types.js";

// Test-only escape hatch: drop the cached singleton so a test that sets env
// can rebuild the client.
export function __resetAIClientForTests(): void {
  _client = undefined;
}
