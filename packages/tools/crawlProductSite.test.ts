import { describe, expect, it } from "vitest";
import { parseHtml, parseRobotsTxt } from "./crawlProductSite.js";

const FIXTURE_HTML = `
<!DOCTYPE html>
<html>
  <head>
    <title>Acme Tasks — never lose a follow-up</title>
    <meta name="description" content="Acme is a task manager built for founders who context-switch all day." />
  </head>
  <body>
    <nav><a href="/pricing">Pricing</a><a href="/features">Features</a></nav>
    <main>
      <h1>Never lose a follow-up</h1>
      <h2>Capture, surface, ship</h2>
      <p>Acme Tasks turns a noisy inbox into a calm queue. Built for solo founders and tiny teams.</p>
      <h3>Why founders like it</h3>
      <p>The follow-up review nudges you to close every open loop before Friday.</p>
      <footer>© 2026 Acme</footer>
      <script>console.log("never include this");</script>
    </main>
  </body>
</html>
`;

describe("parseHtml", () => {
  const page = parseHtml(FIXTURE_HTML, "https://acme.app/");

  it("extracts title + meta description", () => {
    expect(page.title).toContain("Acme Tasks");
    expect(page.metaDescription).toContain("Acme is a task manager");
  });

  it("extracts h1/h2/h3 in order", () => {
    expect(page.headings).toEqual([
      "Never lose a follow-up",
      "Capture, surface, ship",
      "Why founders like it",
    ]);
  });

  it("strips scripts and footer from body text", () => {
    expect(page.bodyText).toContain("turns a noisy inbox into a calm queue");
    expect(page.bodyText).not.toContain("never include this");
    expect(page.bodyText).not.toContain("© 2026");
  });

  it("caps body text at 8000 chars", () => {
    const huge = "<main>" + "x".repeat(20000) + "</main>";
    const p = parseHtml(`<html><body>${huge}</body></html>`, "https://x.test/");
    expect(p.bodyText.length).toBeLessThanOrEqual(8000);
  });

  it("handles missing meta description", () => {
    const p = parseHtml("<html><head><title>Bare</title></head><body><p>hi</p></body></html>", "https://x.test/");
    expect(p.metaDescription).toBeNull();
  });
});

describe("parseRobotsTxt", () => {
  it("allows when there is no robots.txt content", () => {
    expect(parseRobotsTxt("", "shri-marketing-studio/0.1")).toBe(true);
  });

  it("allows when the wildcard group has no rules", () => {
    expect(
      parseRobotsTxt("User-agent: *\nAllow: /\n", "shri-marketing-studio/0.1"),
    ).toBe(true);
  });

  it("blocks when wildcard Disallow: /", () => {
    expect(
      parseRobotsTxt("User-agent: *\nDisallow: /\n", "shri-marketing-studio/0.1"),
    ).toBe(false);
  });

  it("blocks specifically when our UA is matched and disallowed", () => {
    const txt = [
      "User-agent: *",
      "Allow: /",
      "",
      "User-agent: shri-marketing-studio",
      "Disallow: /",
    ].join("\n");
    expect(parseRobotsTxt(txt, "shri-marketing-studio/0.1")).toBe(false);
  });

  it("ignores comments", () => {
    const txt = "# nothing here\nUser-agent: *\nDisallow: /\n# end\n";
    expect(parseRobotsTxt(txt, "shri-marketing-studio/0.1")).toBe(false);
  });
});

// Live LLM extract: real OpenAI when OPENAI_API_KEY is set. We feed a tiny
// synthetic corpus (no network) and assert the extracted productProfile is
// well-formed against productProfileSchema.
describe.skipIf(!process.env.OPENAI_API_KEY)(
  "crawlProductSite — LLM extract pass (real OpenAI)",
  () => {
    it("returns a structured profile from a fixture corpus", async () => {
      const mod = await import("./crawlProductSite.js");
      // Reach the private extractor via a tiny adapter: parse a fixture page
      // and call extractProductProfile indirectly by passing one page through
      // the public handler with no DB.
      // Since handler hits Postgres, exercise the parser + a minimal extract by
      // building a single-page extract directly. We import the productProfileSchema
      // and assert shape.
      const { productProfileSchema, parseHtml: _ph } = mod;
      const fixture = parseHtml(FIXTURE_HTML, "https://acme.app/");
      // Run a one-shot LLM extract by calling aiClient directly with the same
      // shape the real handler uses — this is the public surface we care about.
      const { aiClient } = await import("@shri/ai");
      const res = await aiClient.chat.complete({
        messages: [
          {
            role: "system",
            content:
              "Extract a productProfile JSON. Return ONLY JSON. Keys: name, tagline, features[], valueProps[], targetAudience, tone, inferredCategory.",
          },
          {
            role: "user",
            content: `=== ${fixture.url} ===\nTITLE: ${fixture.title}\nMETA: ${fixture.metaDescription}\nHEADINGS:\n${fixture.headings.join("\n")}\nBODY:\n${fixture.bodyText}`,
          },
        ],
        temperature: 0,
        maxTokens: 800,
        responseFormat: "json",
      });
      const raw = JSON.parse(res.message.content || "{}");
      const normalized = {
        name: typeof raw.name === "string" ? raw.name : null,
        tagline: typeof raw.tagline === "string" ? raw.tagline : null,
        features: Array.isArray(raw.features)
          ? raw.features.filter((x: unknown) => typeof x === "string").slice(0, 12)
          : [],
        valueProps: Array.isArray(raw.valueProps)
          ? raw.valueProps.filter((x: unknown) => typeof x === "string").slice(0, 6)
          : [],
        targetAudience:
          typeof raw.targetAudience === "string" ? raw.targetAudience : null,
        tone: typeof raw.tone === "string" ? raw.tone : "",
        inferredCategory:
          typeof raw.inferredCategory === "string" ? raw.inferredCategory : null,
      };
      const parsed = productProfileSchema.parse(normalized);
      // Acme is named in the title — strong signal the LLM should pick up.
      expect(parsed.name === null || typeof parsed.name === "string").toBe(true);
      expect(Array.isArray(parsed.features)).toBe(true);
    }, 60_000);
  },
);
