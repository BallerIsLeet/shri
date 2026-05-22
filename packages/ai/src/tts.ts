import OpenAI from "openai";
import type { TtsConfig } from "./config.js";
import type { AudioResult, TtsOpts } from "./types.js";

export class TtsNamespace {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly defaultVoice: string;

  constructor(cfg: TtsConfig) {
    this.client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL });
    this.model = cfg.model;
    this.defaultVoice = cfg.voice;
  }

  async speak(opts: TtsOpts): Promise<AudioResult> {
    const format = opts.format ?? "mp3";
    const res = await this.client.audio.speech.create({
      model: this.model,
      voice: opts.voice ?? this.defaultVoice,
      input: opts.text,
      response_format: format,
    });
    const arrayBuf = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    // Rough estimate; real duration becomes available post-encode in the muxAudio tool.
    // 150 wpm is a comfortable speaking rate; ~5 chars/word average English.
    const wordCount = Math.max(1, opts.text.trim().split(/\s+/).length);
    const durationS = (wordCount / 150) * 60;
    return { buffer, durationS, usage: { costUsd: 0 } };
  }
}
