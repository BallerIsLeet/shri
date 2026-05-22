import { describe, it, expect } from "vitest";
import { keys } from "./keys.js";

describe("storage/keys", () => {
  it("asset key uses projects/{slug}/assets/{id}.{ext}", () => {
    expect(keys.asset("my-app", "abc123", "png")).toBe(
      "projects/my-app/assets/abc123.png",
    );
  });

  it("asset key tolerates a leading dot in the extension", () => {
    expect(keys.asset("my-app", "abc123", ".jpg")).toBe(
      "projects/my-app/assets/abc123.jpg",
    );
  });

  it("character keys nest under the character id", () => {
    expect(keys.characterBase("a", "c1")).toBe("projects/a/characters/c1/base.png");
    expect(keys.characterSheet("a", "c1")).toBe("projects/a/characters/c1/sheet.jpg");
    expect(keys.characterView("a", "c1", "front")).toBe(
      "projects/a/characters/c1/views/front.png",
    );
  });

  it("output keys are scoped by itemId", () => {
    expect(keys.outputSlide("a", "i1", 0)).toBe("projects/a/outputs/i1/slide-0.png");
    expect(keys.outputSlide("a", "i1", 4)).toBe("projects/a/outputs/i1/slide-4.png");
    expect(keys.outputComposite("a", "i1")).toBe("projects/a/outputs/i1/composite.png");
    expect(keys.outputSeedance("a", "i1")).toBe("projects/a/outputs/i1/seedance.mp4");
    expect(keys.outputSeedanceScene("a", "i1", 2)).toBe(
      "projects/a/outputs/i1/seedance-2.mp4",
    );
    expect(keys.outputVoice("a", "i1")).toBe("projects/a/outputs/i1/voice.mp3");
    expect(keys.outputFinal("a", "i1")).toBe("projects/a/outputs/i1/final.mp4");
  });

  it("thumb key sits under thumbs/", () => {
    expect(keys.thumb("a", "i1")).toBe("projects/a/thumbs/i1.jpg");
  });

  it("every key is prefixed with projects/{slug}/ — the prefix invariant", () => {
    const slug = "my-app";
    const samples = [
      keys.asset(slug, "x", "png"),
      keys.characterBase(slug, "c"),
      keys.characterSheet(slug, "c"),
      keys.characterView(slug, "c", "front"),
      keys.outputSlide(slug, "i", 0),
      keys.outputComposite(slug, "i"),
      keys.outputSeedance(slug, "i"),
      keys.outputSeedanceScene(slug, "i", 1),
      keys.outputVoice(slug, "i"),
      keys.outputFinal(slug, "i"),
      keys.thumb(slug, "i"),
    ];
    for (const k of samples) {
      expect(k.startsWith(`projects/${slug}/`)).toBe(true);
    }
  });
});
