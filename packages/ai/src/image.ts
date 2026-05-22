import OpenAI from "openai";
import type { NamespaceConfig } from "./config.js";
import type { ImageEditOpts, ImageGenerateOpts, ImageResult } from "./types.js";

export class ImageNamespace {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(cfg: NamespaceConfig) {
    this.client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL });
    this.model = cfg.model;
  }

  async generate(opts: ImageGenerateOpts): Promise<ImageResult> {
    const res = await this.client.images.generate({
      model: this.model,
      prompt: opts.prompt,
      size: opts.size ?? "1024x1024",
      n: opts.n ?? 1,
      response_format: "b64_json",
    });
    const buffers = (res.data ?? []).map((d) => {
      if (!d.b64_json) {
        throw new Error("@shri/ai image.generate: response missing b64_json");
      }
      return Buffer.from(d.b64_json, "base64");
    });
    return { buffers, usage: { costUsd: 0 } };
  }

  async edit(opts: ImageEditOpts): Promise<ImageResult> {
    if (opts.references.length === 0) {
      throw new Error("@shri/ai image.edit: at least one reference is required");
    }
    // The OpenAI SDK's images.edit takes a single image input. For character-view
    // workflows we generally pass one base image; multi-reference compositing is
    // handled by `references[]` length 1 in v1 and richer multi-input edit is a
    // future capability addressed in docs/18-ai-client.md.
    const primary = opts.references[0];
    if (!primary) {
      throw new Error("@shri/ai image.edit: reference list is empty");
    }
    // OpenAI's SDK accepts a File-like (uploadable) for `image`. In Node 20+
    // we use `toFile` to wrap a Buffer.
    const { toFile } = await import("openai/uploads");
    const file = await toFile(primary, "reference.png", { type: "image/png" });
    const res = await this.client.images.edit({
      model: this.model,
      image: file,
      prompt: opts.prompt,
      size: opts.size ?? "1024x1024",
      response_format: "b64_json",
    });
    const buffers = (res.data ?? []).map((d) => {
      if (!d.b64_json) {
        throw new Error("@shri/ai image.edit: response missing b64_json");
      }
      return Buffer.from(d.b64_json, "base64");
    });
    return { buffers, usage: { costUsd: 0 } };
  }
}
