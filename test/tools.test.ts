import { describe, expect, test } from "bun:test";
import { asSchema, generateText, stepCountIs, type Tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import {
  ASSISTANT_TOOL_NAMES,
  DEFAULT_TOOL_NAMES,
  SerpKite,
  SerpKiteError,
  serpkiteAIMode,
  serpkiteAnswer,
  serpkiteBraveAI,
  serpkiteChatGPT,
  serpkiteCopilot,
  serpkiteCrawl,
  serpkiteCrawlResult,
  serpkiteExtract,
  serpkiteGemini,
  serpkiteMaps,
  serpkitePlace,
  serpkiteRank,
  serpkiteResearch,
  serpkiteResearchResult,
  serpkiteReviews,
  serpkiteSearch,
  serpkiteTools,
  serpkiteWebpage,
  TOOL_NAMES,
} from "../src/index";

interface Seen {
  url: string;
  method: string;
  headers: Headers;
  body: Record<string, unknown> | undefined;
  signal: AbortSignal | undefined;
}

function mockFetch(reply: (req: Seen) => Response) {
  const seen: Seen[] = [];
  const fn = async (input: string | URL | Request, init?: RequestInit) => {
    const req: Seen = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      signal: init?.signal ?? undefined,
    };
    seen.push(req);
    return reply(req);
  };
  return { fetch: fn as unknown as typeof fetch, seen };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const markdown = (text: string) =>
  new Response(text, { status: 200, headers: { "content-type": "text/markdown" } });

const opts = (f: typeof fetch) => ({ apiKey: "skt_live_test", fetch: f, maxRetries: 0 });
const ctx = { toolCallId: "call_1", messages: [] };

// biome-ignore lint/suspicious/noExplicitAny: test helper over every tool type
const run = (t: Tool<any, any>, input: unknown, extra: object = {}) => {
  if (!t.execute) throw new Error("tool has no execute");
  return t.execute(input, { ...ctx, ...extra } as never) as Promise<unknown>;
};

const props = (t: Tool) =>
  Object.keys(
    (asSchema(t.inputSchema).jsonSchema as { properties: Record<string, unknown> }).properties,
  );
const required = (t: Tool) =>
  (asSchema(t.inputSchema).jsonSchema as { required?: string[] }).required ?? [];

describe("search verticals", () => {
  test("search posts the model's input with format=markdown and returns the text", async () => {
    const { fetch, seen } = mockFetch(() => markdown("# Results\n\n1. Espresso"));
    const t = serpkiteSearch(opts(fetch));
    const out = await run(t, { q: "best espresso", country: "de" });
    expect(out).toBe("# Results\n\n1. Espresso");
    expect(seen[0].url).toBe("https://api.serpkite.com/v1/search");
    expect(seen[0].method).toBe("POST");
    expect(seen[0].headers.get("authorization")).toBe("Bearer skt_live_test");
    expect(seen[0].body).toEqual({ q: "best espresso", country: "de", format: "markdown" });
  });

  test("defaults apply under the input, fixed over it; nulls are dropped", async () => {
    const { fetch, seen } = mockFetch(() => markdown("ok"));
    const t = serpkiteSearch({
      ...opts(fetch),
      defaults: { country: "us", num: 20 },
      fixed: { country: "gb", max_age: 3600, engine: "auto" },
    });
    await run(t, { q: "tea", num: 30, language: null });
    expect(seen[0].body).toEqual({
      q: "tea",
      num: 30,
      country: "gb",
      max_age: 3600,
      engine: "auto",
      format: "markdown",
    });
  });

  test("format json returns the parsed response", async () => {
    const body = {
      request: { endpoint: "search", q: "x" },
      results: [{ position: 1, title: "X", link: "https://x.test/", domain: "x.test" }],
      meta: { request_id: "req_1", credits_used: 1 },
    };
    const { fetch, seen } = mockFetch(() => json(body));
    const out = await run(serpkiteSearch({ ...opts(fetch), format: "json" }), { q: "x" });
    expect(out).toEqual(body);
    expect(seen[0].body?.format).toBe("json");
  });

  test("forwards the abort signal", async () => {
    const { fetch, seen } = mockFetch((r) => {
      if (r.signal?.aborted) throw new DOMException("aborted", "AbortError");
      return markdown("ok");
    });
    const ac = new AbortController();
    ac.abort();
    const err = await run(
      serpkiteSearch(opts(fetch)),
      { q: "x" },
      { abortSignal: ac.signal },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(seen.length).toBeLessThanOrEqual(1);
  });

  test("API errors surface as SerpKiteError", async () => {
    const { fetch } = mockFetch(() =>
      json({ error: { code: "insufficient_credits", message: "top up", request_id: "r" } }, 402),
    );
    const err = (await run(serpkiteSearch(opts(fetch)), { q: "x" }).catch(
      (e: unknown) => e,
    )) as SerpKiteError;
    expect(err).toBeInstanceOf(SerpKiteError);
    expect(err.code).toBe("insufficient_credits");
  });

  test("maps, place, reviews and webpage hit their endpoints", async () => {
    const { fetch, seen } = mockFetch(() => markdown("ok"));
    await run(serpkiteMaps(opts(fetch)), { q: "coffee", ll: "@52.52,13.40,14z" });
    await run(serpkitePlace(opts(fetch)), { place_id: "ChIJ", language: "ru" });
    await run(serpkiteReviews(opts(fetch)), { place_id: "ChIJ", sort: "newest" });
    await run(serpkiteWebpage(opts(fetch)), { url: "https://example.com/" });
    expect(seen.map((r) => new URL(r.url).pathname)).toEqual([
      "/v1/maps",
      "/v1/place",
      "/v1/reviews",
      "/v1/webpage",
    ]);
    expect(seen[1].body).toEqual({ place_id: "ChIJ", language: "ru", format: "markdown" });
    expect(seen[2].body).toEqual({ place_id: "ChIJ", sort: "newest", format: "markdown" });
  });
});

describe("site tools", () => {
  test("extract, rank", async () => {
    const extracted = {
      request: { endpoint: "extract" },
      results: [],
      failed: [],
      meta: { request_id: "r", credits_used: 0, succeeded: 0, failed: 0 },
    };
    const { fetch, seen } = mockFetch((r) =>
      r.url.endsWith("/v1/extract") ? json(extracted) : json({ position: 3 }),
    );
    expect(
      await run(serpkiteExtract(opts(fetch)), { urls: ["https://a.test/"], query: "price" }),
    ).toEqual(extracted);
    expect(await run(serpkiteRank(opts(fetch)), { q: "tea", domain: "a.test" })).toEqual({
      position: 3,
    });
    expect(seen[0].body).toEqual({ urls: ["https://a.test/"], query: "price" });
    expect(seen[1].body).toEqual({ q: "tea", domain: "a.test" });
  });

  test("crawl returns the task, or waits for it", async () => {
    const created = { id: "t1", kind: "crawl", status: "queued", poll_url: "/v1/crawl/t1" };
    const done = { id: "t1", kind: "crawl", status: "completed", result: { pages: [] } };
    const { fetch, seen } = mockFetch((r) => (r.method === "POST" ? json(created) : json(done)));
    expect(await run(serpkiteCrawl(opts(fetch)), { url: "https://a.test/" })).toEqual(created);
    expect(
      await run(serpkiteCrawl({ ...opts(fetch), wait: { pollIntervalMs: 1 } }), {
        url: "https://a.test/",
        limit: 5,
      }),
    ).toEqual(done);
    expect(await run(serpkiteCrawlResult(opts(fetch)), { id: "t1" })).toEqual(done);
    expect(seen.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      "POST /v1/crawl",
      "POST /v1/crawl",
      "GET /v1/crawl/t1",
      "GET /v1/crawl/t1",
    ]);
  });
});

describe("AI tools", () => {
  test("answer posts the question and returns the cited answer", async () => {
    const body = {
      request: { endpoint: "answer", q: "what is rag" },
      answer: "Retrieval-augmented generation [1].",
      citations: [{ index: 1, title: "RAG", link: "https://a.test/" }],
      results: [{ index: 1, title: "RAG", link: "https://a.test/" }],
      meta: { request_id: "r", credits_used: 5, credits: { search: 1, answer: 4 } },
    };
    const { fetch, seen } = mockFetch(() => json(body));
    const out = await run(serpkiteAnswer({ ...opts(fetch), fixed: { depth: "fast" } }), {
      q: "what is rag",
      depth: "standard",
      num_sources: null,
    });
    expect(out).toEqual(body);
    expect(seen[0].url).toBe("https://api.serpkite.com/v1/answer");
    expect(seen[0].body).toEqual({ q: "what is rag", depth: "fast" });
  });

  test("search include_answer and extract summary reach the API", async () => {
    const { fetch, seen } = mockFetch(() => json({ results: [], failed: [], meta: {} }));
    await run(serpkiteSearch(opts(fetch)), { q: "rag", include_answer: true });
    await run(serpkiteExtract(opts(fetch)), { urls: ["https://a.test/"], summary: true });
    expect(seen[0].body).toEqual({ q: "rag", include_answer: true, format: "markdown" });
    expect(seen[1].body).toEqual({ urls: ["https://a.test/"], summary: true });
  });

  test("research returns the task, or waits for the report", async () => {
    const created = { id: "r1", kind: "research", status: "queued", poll_url: "/v1/research/r1" };
    const done = {
      id: "r1",
      kind: "research",
      status: "completed",
      result: { report: "# Report [1]", citations: [], sources: [], queries: [] },
    };
    const { fetch, seen } = mockFetch((r) => (r.method === "POST" ? json(created) : json(done)));
    expect(await run(serpkiteResearch(opts(fetch)), { input: "vector dbs" })).toEqual(created);
    const waiting = serpkiteResearch({ ...opts(fetch), wait: { pollIntervalMs: 1 } });
    expect(waiting.description).toContain("Takes one to several minutes");
    expect(await run(waiting, { input: "vector dbs", effort: "lite" })).toEqual(done);
    expect(await run(serpkiteResearchResult(opts(fetch)), { id: "r1" })).toEqual(done);
    expect(seen[1].body).toEqual({ input: "vector dbs", effort: "lite" });
    expect(seen.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      "POST /v1/research",
      "POST /v1/research",
      "GET /v1/research/r1",
      "GET /v1/research/r1",
    ]);
  });
});

describe("AI assistant tools", () => {
  const answer = {
    request: { endpoint: "chatgpt", prompt: "best crm" },
    text: "HubSpot [1]",
    markdown: "HubSpot [1](https://hubspot.com/)",
    sources: [{ position: 1, link: "https://hubspot.com/", domain: "hubspot.com", cited: true }],
    search_queries: ["best crm"],
    products: [],
    mentions: [
      { term: "hubspot.com", mentioned: true, cited: true, sources: [1], text_position: 1 },
    ],
    meta: { request_id: "r", credits_used: 5 },
  };

  test("chatgpt posts the prompt with format=markdown and returns the text", async () => {
    const { fetch, seen } = mockFetch(() => markdown("HubSpot [1](https://hubspot.com/)"));
    const out = await run(serpkiteChatGPT(opts(fetch)), {
      prompt: "best crm",
      web_search: false,
      track: ["hubspot.com"],
      country: null,
    });
    expect(out).toBe("HubSpot [1](https://hubspot.com/)");
    expect(seen[0].url).toBe("https://api.serpkite.com/v1/chatgpt");
    expect(seen[0].body).toEqual({
      prompt: "best crm",
      web_search: false,
      track: ["hubspot.com"],
      format: "markdown",
    });
  });

  test("each assistant hits its endpoint; json returns the typed response", async () => {
    const { fetch, seen } = mockFetch(() => json(answer));
    const o = { ...opts(fetch), format: "json" as const };
    const tools = [serpkiteGemini(o), serpkiteCopilot(o), serpkiteAIMode(o), serpkiteBraveAI(o)];
    for (const t of tools) {
      expect(await run(t, { prompt: "best crm", language: "de" })).toEqual(answer);
    }
    expect(seen.map((r) => new URL(r.url).pathname)).toEqual([
      "/v1/gemini",
      "/v1/copilot",
      "/v1/ai_mode",
      "/v1/brave_ai",
    ]);
    expect(seen[0].body).toEqual({ prompt: "best crm", language: "de", format: "json" });
  });

  test("fixed track applies over the model's input", async () => {
    const { fetch, seen } = mockFetch(() => markdown("ok"));
    await run(serpkiteGemini({ ...opts(fetch), fixed: { track: ["Acme"], include_html: false } }), {
      prompt: "x",
      track: ["Other"],
    });
    expect(seen[0].body).toEqual({
      prompt: "x",
      track: ["Acme"],
      include_html: false,
      format: "markdown",
    });
  });

  test("opt-in in serpkiteTools", async () => {
    const all = serpkiteTools({ apiKey: "k" });
    for (const n of ASSISTANT_TOOL_NAMES) expect(n in all).toBe(false);
    const { fetch, seen } = mockFetch(() => markdown("ok"));
    const tools = serpkiteTools({ ...opts(fetch), only: ["search", "chatgpt", "brave_ai"] });
    expect(Object.keys(tools)).toEqual(["search", "chatgpt", "brave_ai"]);
    expect(await run(tools.brave_ai, { prompt: "x" })).toBe("ok");
    expect(seen[0].url).toBe("https://api.serpkite.com/v1/brave_ai");
  });
});

describe("serpkiteTools", () => {
  test("all tools but the assistants by default, with only and exclude", () => {
    expect(Object.keys(serpkiteTools({ apiKey: "k" })).sort()).toEqual(
      [...DEFAULT_TOOL_NAMES].sort(),
    );
    expect(DEFAULT_TOOL_NAMES.length + ASSISTANT_TOOL_NAMES.length).toBe(TOOL_NAMES.length);
    expect(Object.keys(serpkiteTools({ apiKey: "k", only: ["search", "webpage"] }))).toEqual([
      "search",
      "webpage",
    ]);
    const rest = serpkiteTools({ apiKey: "k", exclude: ["crawl", "crawl_result"] });
    expect("crawl" in rest).toBe(false);
    expect("search" in rest).toBe(true);
  });

  test("shares one client and applies format", async () => {
    const { fetch, seen } = mockFetch(() => json({ results: [], meta: {} }));
    const client = new SerpKite(opts(fetch));
    const tools = serpkiteTools({ client, only: ["search", "news"], format: "compact" });
    await run(tools.search, { q: "a" });
    await run(tools.news, { q: "b", time: "day" });
    expect(seen.map((r) => r.body)).toEqual([
      { q: "a", format: "compact" },
      { q: "b", time: "day", format: "compact" },
    ]);
  });

  test("no API key needed until a tool runs", async () => {
    const saved = process.env.SERPKITE_API_KEY;
    delete process.env.SERPKITE_API_KEY;
    try {
      const tools = serpkiteTools({ only: ["search"] });
      const err = (await run(tools.search, { q: "x" }).catch((e: unknown) => e)) as SerpKiteError;
      expect(err).toBeInstanceOf(SerpKiteError);
      expect(err.code).toBe("missing_api_key");
    } finally {
      if (saved !== undefined) process.env.SERPKITE_API_KEY = saved;
    }
  });
});

// The fields each endpoint honours (backend/cmd/serp-api/params.go verticalParams,
// RankRequest, ExtractRequest, MapRequest, CrawlRequest). The API rejects any other
// field with 400, so a tool must never offer one to the model.
const ALLOWED: Record<string, { allowed: string[]; required: string[] }> = {
  search: {
    allowed: [
      "q",
      "country",
      "language",
      "location",
      "num",
      "page",
      "time",
      "device",
      "safe",
      "include_content",
      "include_domains",
      "exclude_domains",
      "boost_domains",
      "start_date",
      "end_date",
      "highlights",
      "include_answer",
    ],
    required: ["q"],
  },
  news: {
    allowed: [
      "q",
      "country",
      "language",
      "location",
      "num",
      "page",
      "time",
      "device",
      "safe",
      "include_domains",
      "exclude_domains",
      "boost_domains",
      "start_date",
      "end_date",
      "include_answer",
    ],
    required: ["q"],
  },
  images: {
    allowed: [
      "q",
      "country",
      "language",
      "location",
      "num",
      "page",
      "time",
      "device",
      "safe",
      "include_domains",
      "exclude_domains",
      "start_date",
      "end_date",
    ],
    required: ["q"],
  },
  shopping: {
    allowed: ["q", "country", "language", "location", "num", "page", "time", "device", "safe"],
    required: ["q"],
  },
  maps: {
    allowed: ["q", "country", "language", "location", "ll", "num", "page", "device", "safe"],
    required: ["q"],
  },
  scholar: { allowed: ["q", "country", "language", "num", "page", "safe"], required: ["q"] },
  patents: { allowed: ["q", "country", "language", "num", "page"], required: ["q"] },
  autocomplete: { allowed: ["q", "country", "language"], required: ["q"] },
  reviews: {
    allowed: ["place_id", "cid", "fid", "sort", "page_token", "num", "country", "language"],
    required: [],
  },
  place: { allowed: ["place_id", "cid", "fid", "oid", "country", "language"], required: [] },
  webpage: {
    allowed: ["url", "country", "include_html", "include_links", "include_images"],
    required: ["url"],
  },
  extract: {
    allowed: [
      "urls",
      "format",
      "query",
      "highlights",
      "max_tokens",
      "include_links",
      "include_images",
      "max_age",
      "country",
      "timeout",
      "summary",
      "output_schema",
      "prompt",
    ],
    required: ["urls"],
  },
  map: {
    allowed: [
      "url",
      "search",
      "limit",
      "include_subdomains",
      "include_paths",
      "exclude_paths",
      "ignore_query_parameters",
      "sitemap",
    ],
    required: ["url"],
  },
  rank: {
    allowed: ["q", "domain", "num", "country", "language", "location", "device", "max_age"],
    required: ["q", "domain"],
  },
  crawl: {
    allowed: [
      "url",
      "limit",
      "max_depth",
      "include_paths",
      "exclude_paths",
      "include_subdomains",
      "sitemap",
      "query",
      "ignore_query_parameters",
      "format",
      "include_links",
      "max_tokens",
      "max_age",
    ],
    required: ["url"],
  },
  crawl_result: { allowed: ["id"], required: ["id"] },
  // AnswerRequest and ResearchRequest (backend/api/serp-api.yaml).
  answer: {
    allowed: [
      "q",
      "depth",
      "num_sources",
      "output_schema",
      "country",
      "language",
      "location",
      "uule",
      "time",
      "tbs",
      "device",
      "safe",
      "autocorrect",
      "max_age",
      "engine",
      "include_domains",
      "exclude_domains",
      "boost_domains",
      "start_date",
      "end_date",
    ],
    required: ["q"],
  },
  research: {
    allowed: [
      "input",
      "effort",
      "output_schema",
      "country",
      "language",
      "include_domains",
      "exclude_domains",
      "webhook_url",
    ],
    required: ["input"],
  },
  research_result: { allowed: ["id"], required: ["id"] },
  chatgpt: {
    allowed: ["prompt", "country", "include_html", "web_search", "track"],
    required: ["prompt"],
  },
  gemini: {
    allowed: ["prompt", "country", "language", "include_html", "track"],
    required: ["prompt"],
  },
};
ALLOWED.copilot = ALLOWED.gemini;
ALLOWED.ai_mode = ALLOWED.gemini;
ALLOWED.brave_ai = ALLOWED.gemini;
ALLOWED.videos = ALLOWED.images;
ALLOWED.places = ALLOWED.maps;

describe("input schemas", () => {
  const tools = serpkiteTools({ apiKey: "k", only: TOOL_NAMES });
  for (const name of TOOL_NAMES) {
    test(`${name} offers only fields the endpoint honours`, () => {
      const spec = ALLOWED[name];
      const t = tools[name] as Tool;
      expect(spec).toBeDefined();
      for (const p of props(t)) expect(spec.allowed).toContain(p);
      expect(required(t).sort()).toEqual([...spec.required].sort());
      expect(typeof t.description).toBe("string");
    });
  }

  test("validation rejects a bad country code", async () => {
    const r = await asSchema(serpkiteSearch({ apiKey: "k" }).inputSchema).validate?.({
      q: "x",
      country: "germany",
    });
    expect(r?.success).toBe(false);
  });
});

describe("with generateText", () => {
  test("the model calls the tool and gets the Markdown back", async () => {
    const { fetch, seen } = mockFetch(() => markdown("1. [Node 24 LTS](https://nodejs.org/)"));
    let step = 0;
    const usage = {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    };
    const model = new MockLanguageModelV4({
      doGenerate: async () =>
        step++ === 0
          ? {
              content: [
                {
                  type: "tool-call",
                  toolCallId: "c1",
                  toolName: "search",
                  input: JSON.stringify({ q: "node lts" }),
                },
              ],
              finishReason: { unified: "tool-calls", raw: undefined },
              usage,
              warnings: [],
            }
          : {
              content: [{ type: "text", text: "Node 24 is the LTS." }],
              finishReason: { unified: "stop", raw: undefined },
              usage,
              warnings: [],
            },
    });
    const result = await generateText({
      model,
      tools: serpkiteTools({ ...opts(fetch), only: ["search"] }),
      stopWhen: stepCountIs(3),
      prompt: "What is the latest Node LTS?",
    });
    expect(result.text).toBe("Node 24 is the LTS.");
    expect(seen[0].body).toEqual({ q: "node lts", format: "markdown" });
    const toolResult = result.steps[0].toolResults[0];
    expect(toolResult?.output).toBe("1. [Node 24 LTS](https://nodejs.org/)");
  });
});
