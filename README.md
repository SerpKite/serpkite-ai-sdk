# @serpkite/ai-sdk

[SerpKite](https://serpkite.com) tools for the [Vercel AI SDK](https://ai-sdk.dev): Google search,
news, maps, place details, reviews, shopping, scholar, patents, cited answers, deep research,
what ChatGPT, Gemini, Copilot, Google AI Mode and Brave AI answer, webpage-to-Markdown, multi-URL extract, site map and crawl, ready for `generateText`, `streamText` and agents in Next.js, Node and edge runtimes.

- One line per tool set: `tools: serpkiteTools()`.
- Markdown results by default, which use few tokens and need no post-processing.
- Each input schema lists only the fields its endpoint accepts, so the model can't send a
  parameter the API rejects.
- Built on the official [`serpkite`](https://www.npmjs.com/package/serpkite) SDK (retries, timeouts,
  typed errors). Works with AI SDK 5, 6 and 7 and zod 3.25+ or 4.

## Install

```bash
npm install @serpkite/ai-sdk ai zod
export SERPKITE_API_KEY=skt_live_...   # https://app.serpkite.com/keys
```

## Quickstart

```ts
import { openai } from "@ai-sdk/openai";
import { serpkiteTools } from "@serpkite/ai-sdk";
import { generateText, stepCountIs } from "ai";

const { text } = await generateText({
  model: openai("gpt-5-mini"),
  tools: serpkiteTools({ only: ["search", "webpage"] }),
  stopWhen: stepCountIs(5),
  prompt: "What changed in the latest Node.js LTS? Cite sources.",
});
```

## Next.js route handler

```ts
// app/api/chat/route.ts
import { openai } from "@ai-sdk/openai";
import { serpkiteTools } from "@serpkite/ai-sdk";
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";

export const maxDuration = 60;

// Safe at module scope: the client (and SERPKITE_API_KEY) is only read on the first call,
// so `next build` works without the key.
const tools = serpkiteTools({ only: ["search", "news", "webpage", "extract"] });

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();
  const result = streamText({
    model: openai("gpt-5-mini"),
    system: "Search before answering questions about current events. Cite the URLs you used.",
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(5),
  });
  return result.toUIMessageStreamResponse();
}
```

Keep the key on the server: set `SERPKITE_API_KEY` in `.env.local` and in your Vercel project, and
never as a `NEXT_PUBLIC_` variable. The tools run in route handlers, server actions and the edge
runtime (`export const runtime = "edge"`).

## Tools

| Name | Endpoint | What the model gets |
| --- | --- | --- |
| `search` | `/v1/search` | Google organic results, answer box, knowledge graph, People also ask; `include_content` reads the top pages, `include_answer` adds a cited answer |
| `news` | `/v1/news` | Google News articles (`include_answer` adds a cited answer) |
| `images` | `/v1/images` | Image URLs and source pages |
| `videos` | `/v1/videos` | Videos with channel, duration and date |
| `maps` | `/v1/maps` | Places with address, category, rating, phone, hours, coordinates and `place_id` |
| `places` | `/v1/places` | Google local results (the same places as `maps`) |
| `place` | `/v1/place` | One place's full listing: country, time zone, weekly hours, description, photos (Google ids, or a Yandex Maps `oid`) |
| `reviews` | `/v1/reviews` | Reviews of a place, paged with `page_token` |
| `shopping` | `/v1/shopping` | Products with price and merchant |
| `scholar` | `/v1/scholar` | Papers with citations and PDF links |
| `patents` | `/v1/patents` | Patents |
| `autocomplete` | `/v1/autocomplete` | Query suggestions |
| `webpage` | `/v1/webpage` | One URL (HTML or PDF) as clean Markdown |
| `extract` | `/v1/extract` | Up to 20 URLs, optionally reduced to query-ranked passages or summarised (`summary`) |
| `map` | `/v1/map` | A site's URLs from its sitemaps and links |
| `rank` | `/v1/rank` | A domain's Google position for a keyword |
| `crawl` | `/v1/crawl` | Starts an async site crawl (returns a task id) |
| `crawl_result` | `/v1/crawl/{id}` | The crawl's status and pages |
| `answer` | `/v1/answer` | A short Markdown answer from live Google results, citing numbered sources (`[n]`), and the cited links |
| `research` | `/v1/research` | Starts an async deep-research task (returns a task id) |
| `research_result` | `/v1/research/{id}` | The research task's status, progress and cited Markdown report |
| `chatgpt` | `/v1/chatgpt` | ChatGPT's answer (logged out, searching the web) with cited sources, products, places and `mentions` of `track` terms |
| `gemini` | `/v1/gemini` | Google Gemini's answer with the sources it grounded on |
| `copilot` | `/v1/copilot` | Microsoft Copilot Search (Bing) answer with cited sources and products |
| `ai_mode` | `/v1/ai_mode` | Google AI Mode answer with cited sources and products |
| `brave_ai` | `/v1/brave_ai` | Brave Search's AI answer with cited sources, the searches it ran and products |

`serpkiteTools()` returns every tool except the five AI assistants: an answer costs 2-4 credits and
takes 10-90 s, so add them by name (`only: ["search", "chatgpt", "gemini"]`) or use their factories.

Each tool also has its own factory (`serpkiteSearch()`, `serpkiteWebpage()`, `serpkiteChatGPT()`,
`serpkiteGemini()`, `serpkiteCopilot()`, `serpkiteAIMode()`, `serpkiteBraveAI()`, …) so you can name it
yourself: `tools: { webSearch: serpkiteSearch() }`. Credits per call are listed at
[serpkite.com/pricing](https://serpkite.com/pricing); failed and empty results are free.

## Options

```ts
serpkiteTools({
  only: ["search", "news"], // or exclude: ["crawl", "crawl_result"]
  format: "compact", // "markdown" (default) | "compact" | "json" for the search, page and assistant tools
  apiKey: "skt_live_...", // default: SERPKITE_API_KEY
  client: new SerpKite({ timeoutMs: 30_000 }), // or pass your own client
});

serpkiteSearch({
  description: "Search the web for recent facts about our products.", // what the model reads
  defaults: { country: "de", language: "de" }, // the model may override these
  fixed: { include_domains: ["example.com"], max_age: 3600 }, // the model can't
  format: "json", // execute() then returns the typed SearchResponse
});

serpkiteCrawl({ wait: { timeoutMs: 120_000 } }); // wait for the pages instead of returning a task id

serpkiteAnswer({ fixed: { depth: "fast" } }); // answers from the result page only (cheapest)
serpkiteResearch({ wait: true, fixed: { effort: "lite" } }); // returns the finished report (1-2 minutes)
serpkiteExtract({ fixed: { output_schema: { type: "object", properties: { price: { type: "number" } } } } }); // JSON per page
```

`research` without `wait` returns a task id and the model calls `research_result` later; with `wait`
the tool returns the finished task, so raise the route's `maxDuration` (deep research can take
several minutes). Research is charged a flat price per `effort` only when the report is written;
the model part of an AI step that fails (`ai_unavailable`) is free. Prices: [serpkite.com/pricing](https://serpkite.com/pricing).

`fixed` is how you pin the request fields that the model never sees: `engine` (`"auto"` falls back
to other search engines when Google is unavailable), `max_age` (accept cached results at half the
credits), `fields`, `uule`, `tbs` and `ads`; and the AI knobs `output_schema` / `prompt` (answer,
extract and research) and `webhook_url` (research).

Errors are thrown as `SerpKiteError` (`status`, `code`, `requestId`). The AI SDK turns a thrown
error into a `tool-error` part the model can read, so a failed search doesn't end the run.

## AI visibility: what assistants say about you

```ts
import { serpkiteChatGPT, serpkiteGemini } from "@serpkite/ai-sdk";

const tools = {
  chatgpt: serpkiteChatGPT({ fixed: { track: ["acme.com", "Acme"] } }), // the model can't drop track
  gemini: serpkiteGemini({ format: "json", defaults: { country: "de" } }), // typed AssistantResponse
};
```

The assistant tools return the answer as Markdown by default, with `[n](link)` citations, the
sources, products and places it showed, and how each `track` term was mentioned. With `format: "json"` they return the typed
`AssistantResponse` (`text`, `markdown`, `sources`, `search_queries`, `products`, `places`, and
`mentions` for each `track` term: named in the text, cited, listed as a source or product).
Answers take 10-90 s, so raise the route's `maxDuration`; failed and empty answers are free.
`web_search` is ChatGPT only, and `language` is offered to every assistant but ChatGPT.

## License

MIT
