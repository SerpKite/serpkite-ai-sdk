import { type Tool, tool } from "ai";
import {
  type AnswerParams,
  type AnswerResponse,
  type AssistantParams,
  type AssistantResponse,
  type AutocompleteResponse,
  type ChatGPTParams,
  type CompactResponse,
  type CrawlParams,
  type CrawlTask,
  type ExtractParams,
  type ExtractResponse,
  type ImagesResponse,
  type MapParams,
  type MapResponse,
  type NewsResponse,
  type PatentsResponse,
  type PlaceParams,
  type PlacesResponse,
  type RankParams,
  type RankResponse,
  type ResearchParams,
  type ResearchTask,
  type ReviewsParams,
  type ReviewsResponse,
  type ScholarResponse,
  type SearchParams,
  type SearchResponse,
  SerpKite,
  type SerpKiteOptions,
  type ShoppingResponse,
  type TaskCreated,
  type VideosResponse,
  type WaitOptions,
  type WebpageParams,
  type WebpageResponse,
} from "serpkite";
import type { z } from "zod/v4";
import * as s from "./schemas";

/** Response shape of the search, place and page tools. `markdown` (default) is the leanest for a model. */
export type ToolFormat = "markdown" | "compact" | "json";

/** What a tool returns for a `format`: Markdown text, the compact object, or the full response. */
export type FormatOutput<F extends ToolFormat, R> = F extends "markdown"
  ? string
  : F extends "compact"
    ? CompactResponse
    : R;

export interface BaseToolOptions extends SerpKiteOptions {
  /**
   * A configured client. Without one, a client is built on the first tool call from the
   * other options (`apiKey` defaults to `SERPKITE_API_KEY`), so tools defined at module
   * scope don't throw during `next build` or other builds where the key isn't set.
   */
  client?: SerpKite;
  /** Replaces the description the model reads to decide when to call the tool. */
  description?: string;
}

export interface ParamsToolOptions<P> extends BaseToolOptions {
  /** Request fields applied before the model's input; the model may override them. */
  defaults?: Partial<P>;
  /** Request fields applied over the model's input; the model can't change them. */
  fixed?: Partial<P>;
}

export interface FormatToolOptions<P, F extends ToolFormat> extends ParamsToolOptions<P> {
  /** Response shape. Default `"markdown"`. */
  format?: F;
}

export interface CrawlToolOptions extends ParamsToolOptions<CrawlParams> {
  /**
   * Wait for the crawl to end and return its pages instead of a task id. Off by default:
   * a crawl can run for up to 30 minutes, longer than most serverless functions may (on
   * Vercel, raise the route's `maxDuration`). Pass `WaitOptions` to bound the wait.
   */
  wait?: boolean | WaitOptions;
}

export interface ResearchToolOptions extends ParamsToolOptions<ResearchParams> {
  /**
   * Wait for the report and return the finished task instead of a task id. Off by default:
   * research takes from about a minute (`lite`) to several (`deep`), longer than many
   * serverless functions may run. Pass `WaitOptions` to bound the wait.
   */
  wait?: boolean | WaitOptions;
}

type In<S extends z.ZodType> = z.infer<S>;

export type SearchToolInput = In<typeof s.searchInput>;
export type NewsToolInput = In<typeof s.newsInput>;
export type ImagesToolInput = In<typeof s.imagesInput>;
export type VideosToolInput = In<typeof s.videosInput>;
export type PlacesToolInput = In<typeof s.placesInput>;
export type PlaceToolInput = In<typeof s.placeInput>;
export type ReviewsToolInput = In<typeof s.reviewsInput>;
export type ShoppingToolInput = In<typeof s.shoppingInput>;
export type ScholarToolInput = In<typeof s.scholarInput>;
export type PatentsToolInput = In<typeof s.patentsInput>;
export type AutocompleteToolInput = In<typeof s.autocompleteInput>;
export type WebpageToolInput = In<typeof s.webpageInput>;
export type ExtractToolInput = In<typeof s.extractInput>;
export type MapToolInput = In<typeof s.mapInput>;
export type RankToolInput = In<typeof s.rankInput>;
export type CrawlToolInput = In<typeof s.crawlInput>;
export type CrawlResultToolInput = In<typeof s.crawlResultInput>;
export type AnswerToolInput = In<typeof s.answerInput>;
export type ResearchToolInput = In<typeof s.researchInput>;
export type ResearchResultToolInput = In<typeof s.researchResultInput>;
export type ChatGPTToolInput = In<typeof s.chatgptInput>;
export type AssistantToolInput = In<typeof s.assistantInput>;

// ── Plumbing ────────────────────────────────────────────────────────────

type GetClient = () => SerpKite;

/** Builds the client on first use (see `BaseToolOptions.client`). */
function lazyClient(o: BaseToolOptions): GetClient {
  let c = o.client;
  return () => {
    if (!c) {
      const { apiKey, baseUrl, timeoutMs, maxRetries, retryDelayMs, fetch, headers } = o;
      c = new SerpKite({ apiKey, baseUrl, timeoutMs, maxRetries, retryDelayMs, fetch, headers });
    }
    return c;
  };
}

/** Drops null and undefined: some providers send null for fields they skip, which the API rejects. */
function clean(input: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) if (v !== null && v !== undefined) out[k] = v;
  return out;
}

function merge<P>(o: ParamsToolOptions<P>, input: object): P {
  return { ...o.defaults, ...clean(input), ...o.fixed } as P;
}

interface Exec {
  abortSignal?: AbortSignal;
}

type FormatMethod =
  | "search"
  | "news"
  | "images"
  | "videos"
  | "maps"
  | "places"
  | "place"
  | "reviews"
  | "shopping"
  | "scholar"
  | "patents"
  | "autocomplete"
  | "webpage"
  | "chatgpt"
  | "gemini"
  | "copilot"
  | "aiMode"
  | "braveAi";

function formatTool<I, O>(
  method: FormatMethod,
  schema: z.ZodType<I>,
  description: string,
  o: FormatToolOptions<object, ToolFormat>,
  getClient: GetClient,
): Tool<I, O> {
  const format = o.format ?? "markdown";
  // tool() is an identity function that only drives inference. The output type here
  // follows `format`, which it can't infer, so the caller states it.
  const definition = {
    description: o.description ?? description,
    inputSchema: schema,
    execute: async (input: I, { abortSignal }: Exec = {}): Promise<O> => {
      const call = getClient()[method] as (p: object, r: object) => Promise<O>;
      return call({ ...merge(o, input as object), format }, { signal: abortSignal });
    },
  };
  return tool(definition as unknown as Tool<I, O>);
}

// ── Builders (shared by the single-tool factories and serpkiteTools) ─────

const DESCRIPTIONS = {
  search:
    "Search Google for current information. Returns organic results (title, link, snippet), the answer box, knowledge graph, People also ask and related searches. Set include_content to also read the top result pages, include_answer for a short cited answer over the results. 1 credit.",
  news: "Search Google News for recent articles: title, source, date, link and snippet. Use time to keep only the last hour, day or week; include_answer adds a short cited answer. 1 credit.",
  images:
    "Search Google Images: image URLs, sizes, titles and source pages, up to 100 per page. 1 credit per page.",
  videos:
    "Search Google Videos (YouTube and other sites): title, link, channel, duration and date. 1 credit.",
  maps: 'Find places on Google Maps: name, address, category, rating, review count, phone, website, hours, coordinates and place_id. Put the area in q ("coffee in Berlin") or set location or ll. 1 credit.',
  places:
    "Google local results: businesses with address, category, rating, phone, hours, coordinates and place_id (the same places as maps). 1 credit.",
  place:
    "Get the full Google Maps listing of one place: address, country, coordinates, time zone, categories, opening hours per weekday, website, phone, rating, description and photos. Pass the place_id (or cid / fid) from a maps or places result, or the oid of a Yandex Maps organisation. 1 credit.",
  reviews:
    "Get Google reviews of one place. Pass the place_id (or cid / fid) from a maps or places result; page with page_token = next_page_token. 1 credit per page.",
  shopping:
    "Search Google Shopping for products: title, price, merchant, rating and link. 1 credit.",
  scholar:
    "Search Google Scholar for academic papers: title, authors, publication, year, citation count and PDF links. 1 credit.",
  patents:
    "Search Google Patents: publication number, title, assignee, inventor, dates and PDF link. 1 credit.",
  autocomplete:
    "Get Google autocomplete suggestions for a partial query, for example to see what people search for. 0.5 credit.",
  webpage:
    "Fetch one public URL (HTML or PDF) and return its main content as clean Markdown. Use it to read a search result in full. 1 credit.",
  extract:
    "Read up to 20 URLs (HTML or PDF) as Markdown in one call. With query and highlights, return only the passages most relevant to the query instead of whole pages; with summary, also a short summary of each page. 1 credit per page read (more with summary); failed URLs are listed and free.",
  map: "List a website's URLs from its sitemaps and start page, optionally filtered and ranked by search words. Use it to find the right page on a site before reading it. 1 credit; free when nothing is found.",
  rank: "Find where a domain ranks on Google for a keyword: its best organic position (null when absent) and each matching result in the top num.",
  crawl:
    "Start an async crawl of one website: pages read as Markdown, following links up to max_depth hops and the site's sitemaps, honouring robots.txt. With query, the most relevant pages are read first. Returns a task id: call crawl_result with it to get the pages. 1 credit per page read; unused credits are refunded.",
  crawlWait:
    "Crawl one website and return its pages as Markdown, following links up to max_depth hops and the site's sitemaps, honouring robots.txt. With query, the most relevant pages are read first. 1 credit per page read.",
  crawl_result:
    "Get the status, progress or pages of a crawl started with the crawl tool. While status is queued or running, call it again later. Free.",
  answer:
    "Answer a question from live Google results: a short Markdown answer citing numbered sources with [n] markers, plus the cited links. depth fast answers from the result page; standard (default) also reads the top pages and costs more. If the answer fails, its model part is not charged.",
  research:
    "Start an async deep-research task: planned Google searches, page reading and a cited Markdown report. Returns a task id: call research_result with it in about a minute. A flat price per effort (lite, standard, deep), charged only when the report is written.",
  researchWait:
    "Research a question in depth: planned Google searches, page reading and a cited Markdown report with numbered sources. Takes one to several minutes. A flat price per effort (lite, standard, deep), charged only when the report is written.",
  research_result:
    "Get the status, progress or report of a research task started with the research tool. While status is queued or running, call it again later. Free.",
  chatgpt:
    "Ask ChatGPT (chatgpt.com, as a logged-out user, searching the web) and get its answer with the sources it cited and the products and places it showed: what ChatGPT tells people. track lists brands or domains to check the answer for. 4 credits; takes 10-90 s; free if it fails. If it fails with upstream_timeout saying the answer is being finished in the background, call again with the same input within 10 minutes.",
  gemini:
    "Ask Google Gemini (gemini.google.com, as a logged-out user) and get its answer with the sources it grounded on: what Gemini tells people. track lists brands or domains to check the answer for. 3 credits; takes 10-90 s; free if it fails. If it fails with upstream_timeout saying the answer is being finished in the background, call again with the same input within 10 minutes.",
  copilot:
    "Ask Microsoft Copilot Search on Bing and get its answer with cited sources and products. track lists brands or domains to check the answer for. 3 credits; takes 15-40 s; free if it fails.",
  ai_mode:
    "Ask Google AI Mode and get its answer with cited sources and products. track lists brands or domains to check the answer for. 2 credits; takes 10-45 s; free if it fails.",
  brave_ai:
    "Ask Brave Search's AI answer and get it with cited sources, the searches it ran and products. track lists brands or domains to check the answer for. 2 credits; about 10 s; free if it fails.",
} as const;

const build = {
  search: <F extends ToolFormat>(o: FormatToolOptions<SearchParams, F>, c: GetClient) =>
    formatTool<SearchToolInput, FormatOutput<F, SearchResponse>>(
      "search",
      s.searchInput,
      DESCRIPTIONS.search,
      o,
      c,
    ),
  news: <F extends ToolFormat>(o: FormatToolOptions<SearchParams, F>, c: GetClient) =>
    formatTool<NewsToolInput, FormatOutput<F, NewsResponse>>(
      "news",
      s.newsInput,
      DESCRIPTIONS.news,
      o,
      c,
    ),
  images: <F extends ToolFormat>(o: FormatToolOptions<SearchParams, F>, c: GetClient) =>
    formatTool<ImagesToolInput, FormatOutput<F, ImagesResponse>>(
      "images",
      s.imagesInput,
      DESCRIPTIONS.images,
      o,
      c,
    ),
  videos: <F extends ToolFormat>(o: FormatToolOptions<SearchParams, F>, c: GetClient) =>
    formatTool<VideosToolInput, FormatOutput<F, VideosResponse>>(
      "videos",
      s.videosInput,
      DESCRIPTIONS.videos,
      o,
      c,
    ),
  maps: <F extends ToolFormat>(o: FormatToolOptions<SearchParams, F>, c: GetClient) =>
    formatTool<PlacesToolInput, FormatOutput<F, PlacesResponse>>(
      "maps",
      s.placesInput,
      DESCRIPTIONS.maps,
      o,
      c,
    ),
  places: <F extends ToolFormat>(o: FormatToolOptions<SearchParams, F>, c: GetClient) =>
    formatTool<PlacesToolInput, FormatOutput<F, PlacesResponse>>(
      "places",
      s.placesInput,
      DESCRIPTIONS.places,
      o,
      c,
    ),
  place: <F extends ToolFormat>(o: FormatToolOptions<PlaceParams, F>, c: GetClient) =>
    formatTool<PlaceToolInput, FormatOutput<F, PlacesResponse>>(
      "place",
      s.placeInput,
      DESCRIPTIONS.place,
      o,
      c,
    ),
  reviews: <F extends ToolFormat>(o: FormatToolOptions<ReviewsParams, F>, c: GetClient) =>
    formatTool<ReviewsToolInput, FormatOutput<F, ReviewsResponse>>(
      "reviews",
      s.reviewsInput,
      DESCRIPTIONS.reviews,
      o,
      c,
    ),
  shopping: <F extends ToolFormat>(o: FormatToolOptions<SearchParams, F>, c: GetClient) =>
    formatTool<ShoppingToolInput, FormatOutput<F, ShoppingResponse>>(
      "shopping",
      s.shoppingInput,
      DESCRIPTIONS.shopping,
      o,
      c,
    ),
  scholar: <F extends ToolFormat>(o: FormatToolOptions<SearchParams, F>, c: GetClient) =>
    formatTool<ScholarToolInput, FormatOutput<F, ScholarResponse>>(
      "scholar",
      s.scholarInput,
      DESCRIPTIONS.scholar,
      o,
      c,
    ),
  patents: <F extends ToolFormat>(o: FormatToolOptions<SearchParams, F>, c: GetClient) =>
    formatTool<PatentsToolInput, FormatOutput<F, PatentsResponse>>(
      "patents",
      s.patentsInput,
      DESCRIPTIONS.patents,
      o,
      c,
    ),
  autocomplete: <F extends ToolFormat>(o: FormatToolOptions<SearchParams, F>, c: GetClient) =>
    formatTool<AutocompleteToolInput, FormatOutput<F, AutocompleteResponse>>(
      "autocomplete",
      s.autocompleteInput,
      DESCRIPTIONS.autocomplete,
      o,
      c,
    ),
  webpage: <F extends ToolFormat>(o: FormatToolOptions<WebpageParams, F>, c: GetClient) =>
    formatTool<WebpageToolInput, FormatOutput<F, WebpageResponse>>(
      "webpage",
      s.webpageInput,
      DESCRIPTIONS.webpage,
      o,
      c,
    ),
  extract: (
    o: ParamsToolOptions<ExtractParams>,
    c: GetClient,
  ): Tool<ExtractToolInput, ExtractResponse> =>
    tool({
      description: o.description ?? DESCRIPTIONS.extract,
      inputSchema: s.extractInput,
      execute: async (input, { abortSignal }: Exec = {}) =>
        c().extract(merge(o, input), { signal: abortSignal }),
    }),
  map: (o: ParamsToolOptions<MapParams>, c: GetClient): Tool<MapToolInput, MapResponse> =>
    tool({
      description: o.description ?? DESCRIPTIONS.map,
      inputSchema: s.mapInput,
      execute: async (input, { abortSignal }: Exec = {}) =>
        c().map(merge(o, input), { signal: abortSignal }),
    }),
  rank: (o: ParamsToolOptions<RankParams>, c: GetClient): Tool<RankToolInput, RankResponse> =>
    tool({
      description: o.description ?? DESCRIPTIONS.rank,
      inputSchema: s.rankInput,
      execute: async (input, { abortSignal }: Exec = {}) =>
        c().rank(merge(o, input), { signal: abortSignal }),
    }),
  crawl: (o: CrawlToolOptions, c: GetClient): Tool<CrawlToolInput, TaskCreated | CrawlTask> =>
    tool({
      description: o.description ?? (o.wait ? DESCRIPTIONS.crawlWait : DESCRIPTIONS.crawl),
      inputSchema: s.crawlInput,
      execute: async (input, { abortSignal }: Exec = {}): Promise<TaskCreated | CrawlTask> => {
        const sk = c();
        const task = await sk.crawl(merge(o, input), { signal: abortSignal });
        if (!o.wait) return task;
        const w = o.wait === true ? {} : o.wait;
        return sk.waitForCrawl(task, { ...w, signal: w.signal ?? abortSignal });
      },
    }),
  crawl_result: (o: BaseToolOptions, c: GetClient): Tool<CrawlResultToolInput, CrawlTask> =>
    tool({
      description: o.description ?? DESCRIPTIONS.crawl_result,
      inputSchema: s.crawlResultInput,
      execute: async ({ id }, { abortSignal }: Exec = {}) =>
        c().getCrawl(id, { signal: abortSignal }),
    }),
  answer: (
    o: ParamsToolOptions<AnswerParams>,
    c: GetClient,
  ): Tool<AnswerToolInput, AnswerResponse> =>
    tool({
      description: o.description ?? DESCRIPTIONS.answer,
      inputSchema: s.answerInput,
      execute: async (input, { abortSignal }: Exec = {}) =>
        c().answer(merge(o, input), { signal: abortSignal }),
    }),
  research: (
    o: ResearchToolOptions,
    c: GetClient,
  ): Tool<ResearchToolInput, TaskCreated | ResearchTask> =>
    tool({
      description: o.description ?? (o.wait ? DESCRIPTIONS.researchWait : DESCRIPTIONS.research),
      inputSchema: s.researchInput,
      execute: async (input, { abortSignal }: Exec = {}): Promise<TaskCreated | ResearchTask> => {
        const sk = c();
        const task = await sk.research(merge(o, input), { signal: abortSignal });
        if (!o.wait) return task;
        const w = o.wait === true ? {} : o.wait;
        return sk.waitResearch(task, { ...w, signal: w.signal ?? abortSignal });
      },
    }),
  research_result: (
    o: BaseToolOptions,
    c: GetClient,
  ): Tool<ResearchResultToolInput, ResearchTask> =>
    tool({
      description: o.description ?? DESCRIPTIONS.research_result,
      inputSchema: s.researchResultInput,
      execute: async ({ id }, { abortSignal }: Exec = {}) =>
        c().getResearch(id, { signal: abortSignal }),
    }),
  chatgpt: <F extends ToolFormat>(o: FormatToolOptions<ChatGPTParams, F>, c: GetClient) =>
    formatTool<ChatGPTToolInput, FormatOutput<F, AssistantResponse>>(
      "chatgpt",
      s.chatgptInput,
      DESCRIPTIONS.chatgpt,
      o,
      c,
    ),
  gemini: <F extends ToolFormat>(o: FormatToolOptions<AssistantParams, F>, c: GetClient) =>
    formatTool<AssistantToolInput, FormatOutput<F, AssistantResponse>>(
      "gemini",
      s.assistantInput,
      DESCRIPTIONS.gemini,
      o,
      c,
    ),
  copilot: <F extends ToolFormat>(o: FormatToolOptions<AssistantParams, F>, c: GetClient) =>
    formatTool<AssistantToolInput, FormatOutput<F, AssistantResponse>>(
      "copilot",
      s.assistantInput,
      DESCRIPTIONS.copilot,
      o,
      c,
    ),
  ai_mode: <F extends ToolFormat>(o: FormatToolOptions<AssistantParams, F>, c: GetClient) =>
    formatTool<AssistantToolInput, FormatOutput<F, AssistantResponse>>(
      "aiMode",
      s.assistantInput,
      DESCRIPTIONS.ai_mode,
      o,
      c,
    ),
  brave_ai: <F extends ToolFormat>(o: FormatToolOptions<AssistantParams, F>, c: GetClient) =>
    formatTool<AssistantToolInput, FormatOutput<F, AssistantResponse>>(
      "braveAi",
      s.assistantInput,
      DESCRIPTIONS.brave_ai,
      o,
      c,
    ),
};

// ── Single tools ────────────────────────────────────────────────────────

type Fmt<P, F extends ToolFormat> = FormatToolOptions<P, F>;

/** Google web search: organic results, answer box, knowledge graph, People also ask. */
export const serpkiteSearch = <F extends ToolFormat = "markdown">(o: Fmt<SearchParams, F> = {}) =>
  build.search(o, lazyClient(o));
/** Google News. */
export const serpkiteNews = <F extends ToolFormat = "markdown">(o: Fmt<SearchParams, F> = {}) =>
  build.news(o, lazyClient(o));
/** Google Images. */
export const serpkiteImages = <F extends ToolFormat = "markdown">(o: Fmt<SearchParams, F> = {}) =>
  build.images(o, lazyClient(o));
/** Google Videos. */
export const serpkiteVideos = <F extends ToolFormat = "markdown">(o: Fmt<SearchParams, F> = {}) =>
  build.videos(o, lazyClient(o));
/** Google Maps: places with coordinates and `place_id`. */
export const serpkiteMaps = <F extends ToolFormat = "markdown">(o: Fmt<SearchParams, F> = {}) =>
  build.maps(o, lazyClient(o));
/** Google local results. */
export const serpkitePlaces = <F extends ToolFormat = "markdown">(o: Fmt<SearchParams, F> = {}) =>
  build.places(o, lazyClient(o));
/** One place's full listing (hours, country, time zone, photos) by `place_id`, `cid` or `fid`. */
export const serpkitePlace = <F extends ToolFormat = "markdown">(o: Fmt<PlaceParams, F> = {}) =>
  build.place(o, lazyClient(o));
/** Reviews of a place by `place_id`, `cid` or `fid`. */
export const serpkiteReviews = <F extends ToolFormat = "markdown">(o: Fmt<ReviewsParams, F> = {}) =>
  build.reviews(o, lazyClient(o));
/** Google Shopping. */
export const serpkiteShopping = <F extends ToolFormat = "markdown">(o: Fmt<SearchParams, F> = {}) =>
  build.shopping(o, lazyClient(o));
/** Google Scholar. */
export const serpkiteScholar = <F extends ToolFormat = "markdown">(o: Fmt<SearchParams, F> = {}) =>
  build.scholar(o, lazyClient(o));
/** Google Patents. */
export const serpkitePatents = <F extends ToolFormat = "markdown">(o: Fmt<SearchParams, F> = {}) =>
  build.patents(o, lazyClient(o));
/** Google autocomplete suggestions. */
export const serpkiteAutocomplete = <F extends ToolFormat = "markdown">(
  o: Fmt<SearchParams, F> = {},
) => build.autocomplete(o, lazyClient(o));
/** One public URL (HTML or PDF) as clean Markdown plus metadata. */
export const serpkiteWebpage = <F extends ToolFormat = "markdown">(o: Fmt<WebpageParams, F> = {}) =>
  build.webpage(o, lazyClient(o));
/** Up to 20 URLs in one call, optionally reduced to query-ranked passages. */
export const serpkiteExtract = (o: ParamsToolOptions<ExtractParams> = {}) =>
  build.extract(o, lazyClient(o));
/** The URLs of a site, from its sitemaps and start page. */
export const serpkiteMap = (o: ParamsToolOptions<MapParams> = {}) => build.map(o, lazyClient(o));
/** Google position of a domain for a keyword. */
export const serpkiteRank = (o: ParamsToolOptions<RankParams> = {}) => build.rank(o, lazyClient(o));
/** Starts an async crawl of one site, or waits for its pages with `wait`. */
export const serpkiteCrawl = (o: CrawlToolOptions = {}) => build.crawl(o, lazyClient(o));
/** Status, progress or pages of a crawl. */
export const serpkiteCrawlResult = (o: BaseToolOptions = {}) =>
  build.crawl_result(o, lazyClient(o));
/** A cited answer from live Google results (`answer`, `citations`, `results`). */
export const serpkiteAnswer = (o: ParamsToolOptions<AnswerParams> = {}) =>
  build.answer(o, lazyClient(o));
/** Starts an async research task, or waits for its cited report with `wait`. */
export const serpkiteResearch = (o: ResearchToolOptions = {}) => build.research(o, lazyClient(o));
/** Status, progress or report of a research task. */
export const serpkiteResearchResult = (o: BaseToolOptions = {}) =>
  build.research_result(o, lazyClient(o));

/** ChatGPT's answer (logged out, searching the web) with sources, products and `mentions`. 4 credits. */
export const serpkiteChatGPT = <F extends ToolFormat = "markdown">(o: Fmt<ChatGPTParams, F> = {}) =>
  build.chatgpt(o, lazyClient(o));
/** Google Gemini's answer (logged out) with the sources it grounded on. 3 credits. */
export const serpkiteGemini = <F extends ToolFormat = "markdown">(
  o: Fmt<AssistantParams, F> = {},
) => build.gemini(o, lazyClient(o));
/** Microsoft Copilot Search (Bing) answer with cited sources and products. 3 credits. */
export const serpkiteCopilot = <F extends ToolFormat = "markdown">(
  o: Fmt<AssistantParams, F> = {},
) => build.copilot(o, lazyClient(o));
/** Google AI Mode answer with cited sources and products. 2 credits. */
export const serpkiteAIMode = <F extends ToolFormat = "markdown">(
  o: Fmt<AssistantParams, F> = {},
) => build.ai_mode(o, lazyClient(o));
/** Brave Search's AI answer with cited sources, its searches and products. 2 credits. */
export const serpkiteBraveAI = <F extends ToolFormat = "markdown">(
  o: Fmt<AssistantParams, F> = {},
) => build.brave_ai(o, lazyClient(o));

// ── Tool set ────────────────────────────────────────────────────────────

/** Tool names; the same as the SerpKite remote MCP server's where both have the tool. */
export type SerpKiteToolName = keyof typeof build;
export const TOOL_NAMES = Object.keys(build) as SerpKiteToolName[];

/**
 * The AI assistant tools (ChatGPT, Gemini, Copilot, AI Mode, Brave AI). `serpkiteTools` adds
 * them only when `only` names them: each answer costs 2-4 credits and takes 10-90 s.
 */
export const ASSISTANT_TOOL_NAMES = [
  "chatgpt",
  "gemini",
  "copilot",
  "ai_mode",
  "brave_ai",
] as const;
export type AssistantToolName = (typeof ASSISTANT_TOOL_NAMES)[number];
/** The tools `serpkiteTools` returns without `only`: every tool except the AI assistants. */
export type DefaultToolName = Exclude<SerpKiteToolName, AssistantToolName>;
export const DEFAULT_TOOL_NAMES = TOOL_NAMES.filter(
  (n): n is DefaultToolName => !(ASSISTANT_TOOL_NAMES as readonly string[]).includes(n),
);

/** The tools `serpkiteTools` returns for a `format`. */
export interface SerpKiteToolSet<F extends ToolFormat = "markdown"> {
  search: Tool<SearchToolInput, FormatOutput<F, SearchResponse>>;
  news: Tool<NewsToolInput, FormatOutput<F, NewsResponse>>;
  images: Tool<ImagesToolInput, FormatOutput<F, ImagesResponse>>;
  videos: Tool<VideosToolInput, FormatOutput<F, VideosResponse>>;
  maps: Tool<PlacesToolInput, FormatOutput<F, PlacesResponse>>;
  places: Tool<PlacesToolInput, FormatOutput<F, PlacesResponse>>;
  place: Tool<PlaceToolInput, FormatOutput<F, PlacesResponse>>;
  reviews: Tool<ReviewsToolInput, FormatOutput<F, ReviewsResponse>>;
  shopping: Tool<ShoppingToolInput, FormatOutput<F, ShoppingResponse>>;
  scholar: Tool<ScholarToolInput, FormatOutput<F, ScholarResponse>>;
  patents: Tool<PatentsToolInput, FormatOutput<F, PatentsResponse>>;
  autocomplete: Tool<AutocompleteToolInput, FormatOutput<F, AutocompleteResponse>>;
  webpage: Tool<WebpageToolInput, FormatOutput<F, WebpageResponse>>;
  extract: Tool<ExtractToolInput, ExtractResponse>;
  map: Tool<MapToolInput, MapResponse>;
  rank: Tool<RankToolInput, RankResponse>;
  crawl: Tool<CrawlToolInput, TaskCreated | CrawlTask>;
  crawl_result: Tool<CrawlResultToolInput, CrawlTask>;
  answer: Tool<AnswerToolInput, AnswerResponse>;
  research: Tool<ResearchToolInput, TaskCreated | ResearchTask>;
  research_result: Tool<ResearchResultToolInput, ResearchTask>;
  chatgpt: Tool<ChatGPTToolInput, FormatOutput<F, AssistantResponse>>;
  gemini: Tool<AssistantToolInput, FormatOutput<F, AssistantResponse>>;
  copilot: Tool<AssistantToolInput, FormatOutput<F, AssistantResponse>>;
  ai_mode: Tool<AssistantToolInput, FormatOutput<F, AssistantResponse>>;
  brave_ai: Tool<AssistantToolInput, FormatOutput<F, AssistantResponse>>;
}

export interface SerpKiteToolsOptions<K extends SerpKiteToolName, F extends ToolFormat>
  extends Omit<BaseToolOptions, "description"> {
  /**
   * Only these tools. Default: every tool except the AI assistants (`ASSISTANT_TOOL_NAMES`),
   * which are added only when listed here. A short list helps a model pick the right tool.
   */
  only?: readonly K[];
  /** Leave these tools out. */
  exclude?: readonly SerpKiteToolName[];
  /** Response shape of the search, place, page and AI assistant tools. Default `"markdown"`. */
  format?: F;
  /** `wait` of the crawl and research tools (see `serpkiteCrawl`, `serpkiteResearch`). */
  wait?: CrawlToolOptions["wait"];
}

/**
 * SerpKite tools sharing one client, ready for `generateText`, `streamText` or an `Agent`:
 * `tools: serpkiteTools({ only: ["search", "webpage"] })`.
 */
export function serpkiteTools<
  K extends SerpKiteToolName = DefaultToolName,
  F extends ToolFormat = "markdown",
>(options: SerpKiteToolsOptions<K, F> = {}): Pick<SerpKiteToolSet<F>, K> {
  const { only, exclude, format, wait } = options;
  const getClient = lazyClient(options);
  const out: Record<string, unknown> = {};
  for (const name of only ?? DEFAULT_TOOL_NAMES) {
    if (exclude?.includes(name)) continue;
    const make = build[name] as (o: object, c: GetClient) => unknown;
    out[name] = make({ format, wait }, getClient);
  }
  return out as Pick<SerpKiteToolSet<F>, K>;
}
