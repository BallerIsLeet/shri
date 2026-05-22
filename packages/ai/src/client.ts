import type { AIConfig } from "./config.js";
import { ChatNamespace } from "./chat.js";
import { ImageNamespace } from "./image.js";
import { TtsNamespace } from "./tts.js";

// Each namespace owns its own SDK instance so per-method provider overrides
// work without sharing config. See docs/18-ai-client.md.
export class AIClient {
  readonly chat: ChatNamespace;
  readonly image: ImageNamespace;
  readonly tts: TtsNamespace;

  constructor(cfg: AIConfig) {
    this.chat = new ChatNamespace(cfg.chat);
    this.image = new ImageNamespace(cfg.image);
    this.tts = new TtsNamespace(cfg.tts);
  }
}
