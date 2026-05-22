import { z } from "zod";
import { request } from "undici";
import * as cheerio from "cheerio";
import { prisma } from "@shri/db";
import { aiClient } from "@shri/ai";
import type { ToolContext } from "./descriptors.js";

// crawl_product_site — undici + cheerio + robots.txt + LLM extract pass.
// See docs/13-crawling-and-prompt-gen.md.
//
// Design notes:
//   - No headless browser. Static HTML only. SPA sites yield a degraded crawl
//     and the LLM extract step handles sparse input gracefully.
//   - robots.txt fetched first. If we're disallowed, return status: "blocked".
//   - 1 concurrent request, 1s delay between pages. Not a bot farm.
//   - Each page text capped at 8000 chars.
//   - The LLM extract pass emits a productProfile JSON. Schema-validated;
//     malformed output gets a graceful fallback (empty profile) so a single bad
//     JSON response doesn't kill the project-creation flow.

const USER_AGENT = "shri-marketing-studio/0.1";
const DEFAULT_PREFER_PATHS = [
  "/pricing",
  "/features",
  "/about",
  "/product",
  "/how-it-works",
];
const PER_PAGE_TEXT_CAP = 8000;
const FETCH_TIMEOUT_MS = 15_000;

export const productProfileSchema = z.object({
  name: z.string().nullable(),
  tagline: z.string().nullable(),
  features: z.array(z.string()).max(12),
  valueProps: z.array(z.string()).max(6),
  targetAudience: z.string().nullable(),
  tone: z.string(),
  inferredCategory: z.string().nullable(),
});
export type ProductProfile = z.infer<typeof productProfileSchema>;

const pageSchema = z.object({
  url: z.string(),
  title: z.string(),
  metaDescription: z.string().nullable(),
  headings: z.array(z.string()),
  bodyText: z.string(),
});

export const inputSchema = z.object({
  projectSlug: z.string().describe("URL-safe project slug"),
  url: z.string().url().describe("Root URL of the product site, e.g. https://acme.app"),
  maxPages: z.number().int().min(1).max(20).default(6),
  preferPaths: z.array(z.string()).default(DEFAULT_PREFER_PATHS),
});

export const outputSchema = z.object({
  status: z.enum(["ok", "blocked", "empty"]),
  reason: z.string().optional(),
  pages: z.array(pageSchema),
  productProfile: productProfileSchema,
  crawlId: z.string().optional(),
});

export type CrawlProductSiteInput = z.infer<typeof inputSchema>;
export type CrawlProductSiteOutput = z.infer<typeof outputSchema>;

export async function handler(
  input: CrawlProductSiteInput,
  _ctx: ToolContext,
): Promise<CrawlProductSiteOutput> {
  const rootUrl = new URL(input.url);
  const project = await prisma.project.findUnique({
    where: { slug: input.projectSlug },
    select: { id: true },
  });
  if (!project) {
    throw new Error(`crawl_product_site: project not found for slug "${input.projectSlug}"`);
  }

  // Create the crawl row early — we update it as we go so a partial result is
  // still inspectable in the DB.
  const crawl = await prisma.projectCrawl.create({
    data: {
      projectId: project.id,
      url: input.url,
      status: "RUNNING",
    },
  });

  try {
    // 1. robots.txt — fail soft if disallowed.
    const robotsAllowed = await checkRobots(rootUrl);
    if (!robotsAllowed) {
      const empty = emptyProfile();
      await prisma.projectCrawl.update({
        where: { id: crawl.id },
        data: {
          status: "FAILED",
          error: "robots.txt disallows shri-marketing-studio/0.1",
          pagesJson: [],
          profileJson: empty,
        },
      });
      return {
        status: "blocked",
        reason: "robots.txt disallows shri-marketing-studio/0.1",
        pages: [],
        productProfile: empty,
        crawlId: crawl.id,
      };
    }

    // 2. Fetch the root, parse it, capture nav links from raw HTML.
    const visited = new Set<string>();
    const pages: z.infer<typeof pageSchema>[] = [];
    let navLinks: string[] = [];

    const rootFetch = await fetchHtml(rootUrl.toString());
    if (rootFetch) {
      const rootPage = parseHtml(rootFetch, rootUrl.toString());
      pages.push(rootPage);
      visited.add(rootUrl.toString());
      navLinks = extractSameOriginLinks(rootFetch, rootUrl);
    }

    // 3. Build the candidate list: prefer-path matches first, then nav links
    //    discovered on the homepage.
    const candidates = collectCandidateUrls(rootUrl, navLinks, input.preferPaths);
    for (const candidate of candidates) {
      if (pages.length >= input.maxPages) break;
      if (visited.has(candidate)) continue;
      visited.add(candidate);
      await sleep(1000); // 1 req/sec
      const html = await fetchHtml(candidate);
      if (html) pages.push(parseHtml(html, candidate));
    }

    if (pages.length === 0) {
      const empty = emptyProfile();
      await prisma.projectCrawl.update({
        where: { id: crawl.id },
        data: {
          status: "FAILED",
          error: "no pages fetched (network, JS-only site, or all 404)",
          pagesJson: [],
          profileJson: empty,
        },
      });
      return {
        status: "empty",
        reason: "no pages fetched",
        pages: [],
        productProfile: empty,
        crawlId: crawl.id,
      };
    }

    // 4. LLM extract pass → productProfile.
    const productProfile = await extractProductProfile(pages);

    await prisma.projectCrawl.update({
      where: { id: crawl.id },
      data: {
        status: "DONE",
        pagesJson: pages,
        profileJson: productProfile,
      },
    });
    // Mirror the latest profile onto Project.crawlJson for quick UI display.
    await prisma.project.update({
      where: { id: project.id },
      data: { crawlJson: productProfile, websiteUrl: input.url },
    });

    return {
      status: "ok",
      pages,
      productProfile,
      crawlId: crawl.id,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.projectCrawl.update({
      where: { id: crawl.id },
      data: { status: "FAILED", error: message },
    });
    throw err;
  }
}

// -----------------------------------------------------------------------------
// Pure helpers — exported so tests can hit them with local fixture HTML without
// needing a real network.
// -----------------------------------------------------------------------------

export function parseHtml(html: string, sourceUrl: string): z.infer<typeof pageSchema> {
  const $ = cheerio.load(html);
  const title = ($("title").first().text() || "").trim();
  const metaDescription =
    $('meta[name="description"]').attr("content") ??
    $('meta[property="og:description"]').attr("content") ??
    null;
  const headings: string[] = [];
  for (const sel of ["h1", "h2", "h3"]) {
    $(sel).each((_i, el) => {
      const text = $(el).text().replace(/\s+/g, " ").trim();
      if (text) headings.push(text);
    });
  }
  // Prefer main / article; fall back to body.
  const root = $("main").length ? $("main") : $("article").length ? $("article") : $("body");
  // Strip script/style/nav/footer noise before extracting text.
  root.find("script, style, nav, footer, header, noscript").remove();
  const bodyText = root.text().replace(/\s+/g, " ").trim().slice(0, PER_PAGE_TEXT_CAP);

  return {
    url: sourceUrl,
    title,
    metaDescription: metaDescription?.trim() ?? null,
    headings: headings.slice(0, 40),
    bodyText,
  };
}

export function collectCandidateUrls(
  rootUrl: URL,
  navLinks: string[],
  preferPaths: string[],
): string[] {
  const out: string[] = [];
  const origin = rootUrl.origin;

  // 1. Prefer-paths (regardless of whether they're linked from the homepage —
  //    SPAs hide them but they still exist server-side).
  for (const p of preferPaths) {
    try {
      out.push(new URL(p, origin).toString());
    } catch {
      // Ignore malformed paths.
    }
  }

  // 2. Same-origin links discovered on the root page.
  for (const href of navLinks) {
    try {
      const u = new URL(href, origin);
      if (u.origin === origin) out.push(u.toString());
    } catch {
      // Ignore malformed hrefs.
    }
  }
  return uniq(out);
}

export function extractSameOriginLinks(html: string, rootUrl: URL): string[] {
  const $ = cheerio.load(html);
  const links: string[] = [];
  $("a[href]").each((_i, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
    try {
      const u = new URL(href, rootUrl.origin);
      if (u.origin === rootUrl.origin) links.push(u.toString());
    } catch {
      // Skip malformed href.
    }
  });
  return uniq(links);
}

export function parseRobotsTxt(robotsTxt: string, userAgent: string): boolean {
  // Returns true if the given user-agent is ALLOWED to crawl "/".
  // Minimal implementation: walk groups, find the most specific matching UA, check Disallow rules.
  const lines = robotsTxt
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter((l) => l.length > 0);

  type Group = { agents: string[]; disallow: string[]; allow: string[] };
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasUA = false;

  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasUA) {
        current = { agents: [], disallow: [], allow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasUA = true;
    } else if (current && (key === "disallow" || key === "allow")) {
      if (key === "disallow") current.disallow.push(value);
      else current.allow.push(value);
      lastWasUA = false;
    } else {
      lastWasUA = false;
    }
  }

  // Pick the most specific matching group: exact UA match wins over "*".
  const uaLower = userAgent.toLowerCase();
  const exactMatch = groups.find((g) =>
    g.agents.some((a) => a !== "*" && uaLower.includes(a)),
  );
  const wildcardMatch = groups.find((g) => g.agents.includes("*"));
  const chosen = exactMatch ?? wildcardMatch;
  if (!chosen) return true;

  // If "/" is disallowed (Disallow: /), we're blocked at the root.
  for (const rule of chosen.disallow) {
    if (rule === "/" || rule === "/*") {
      // Allow overrides Disallow when more specific — but for the simple
      // "Disallow: /" case we treat any Allow line as override.
      const allowsRoot = chosen.allow.some((a) => a === "/" || a === "");
      if (!allowsRoot) return false;
    }
  }
  return true;
}

// -----------------------------------------------------------------------------
// Network + LLM helpers (live).
// -----------------------------------------------------------------------------

async function checkRobots(rootUrl: URL): Promise<boolean> {
  const robotsUrl = `${rootUrl.origin}/robots.txt`;
  try {
    const { statusCode, body } = await request(robotsUrl, {
      method: "GET",
      headers: { "user-agent": USER_AGENT },
      headersTimeout: FETCH_TIMEOUT_MS,
      bodyTimeout: FETCH_TIMEOUT_MS,
    });
    if (statusCode === 404 || statusCode >= 400) return true; // no robots → allowed
    const text = await body.text();
    return parseRobotsTxt(text, USER_AGENT);
  } catch {
    // If we can't fetch robots.txt, assume allowed (consistent with most crawlers).
    return true;
  }
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const { statusCode, headers, body } = await request(url, {
      method: "GET",
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml",
      },
      headersTimeout: FETCH_TIMEOUT_MS,
      bodyTimeout: FETCH_TIMEOUT_MS,
    });
    if (statusCode < 200 || statusCode >= 400) {
      await body.dump();
      return null;
    }
    const ct = (headers["content-type"] || headers["Content-Type"] || "").toString();
    if (!ct.includes("text/html") && !ct.includes("application/xhtml")) {
      await body.dump();
      return null;
    }
    return await body.text();
  } catch {
    return null;
  }
}

async function extractProductProfile(
  pages: z.infer<typeof pageSchema>[],
): Promise<ProductProfile> {
  const corpus = pages
    .map(
      (p) =>
        `=== ${p.url} ===\nTITLE: ${p.title}\nMETA: ${p.metaDescription ?? ""}\nHEADINGS:\n${p.headings.map((h) => `- ${h}`).join("\n")}\nBODY:\n${p.bodyText}`,
    )
    .join("\n\n");

  const system = [
    "You are a marketing analyst extracting a structured product profile from a website crawl.",
    "Return ONLY valid JSON matching the schema. No prose. Empty arrays/null are valid when info is absent.",
    "Be conservative: don't invent features that aren't supported by the text.",
  ].join(" ");

  const user = [
    "Given this multi-page corpus, return a productProfile JSON with these keys:",
    "- name: string|null",
    "- tagline: string|null",
    "- features: string[] (up to 12 short bullet-style)",
    "- valueProps: string[] (up to 6 — outcome-oriented)",
    "- targetAudience: string|null",
    "- tone: string (free-text, e.g. 'warm, playful, casual')",
    "- inferredCategory: string|null (e.g. 'consumer task-management app')",
    "",
    "CORPUS:",
    corpus,
  ].join("\n");

  const res = await aiClient.chat.complete({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0,
    maxTokens: 1500,
    responseFormat: "json",
  });

  try {
    const raw = JSON.parse(res.message.content || "{}");
    // Normalize: many LLMs return undefined/missing arrays — coerce to defaults.
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
    return productProfileSchema.parse(normalized);
  } catch {
    return emptyProfile();
  }
}

function emptyProfile(): ProductProfile {
  return {
    name: null,
    tagline: null,
    features: [],
    valueProps: [],
    targetAudience: null,
    tone: "",
    inferredCategory: null,
  };
}

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
