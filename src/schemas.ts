// Input schemas the model fills in. Each one lists exactly the fields its
// endpoint honours (backend/cmd/serp-api/params.go `verticalParams`, the same
// lists the remote MCP server advertises): the API answers 400 to a field a
// vertical ignores, so a schema must never offer one. Output and billing knobs
// (format, fields, max_age, engine, uule, tbs, ads, webhook_url) are left to the
// developer through a tool's `defaults` / `fixed` options.
//
// `zod/v4` resolves in both zod 3.25+ and zod 4, the versions the AI SDK supports.
import { z } from "zod/v4";

const q = z.string().min(1).max(2048).describe("The search query");
const country = z
  .string()
  .length(2)
  .describe("Two-letter country code (ISO 3166-1 alpha-2), e.g. us, de, gb. Default us");
const language = z
  .string()
  .describe("Interface language code with an optional region, e.g. en, de, pt-br. Default en");
const location = z
  .string()
  .describe('City-level location the search runs from, e.g. "Austin, Texas, United States"');
const page = z.number().int().min(1).max(10).describe("Result page, 1-10. Default 1");
const time = z
  .enum(["hour", "day", "week", "month", "year"])
  .describe("Only results from the last hour, day, week, month or year");
const device = z.enum(["desktop", "mobile"]).describe("Device to search as. Default desktop");
const safe = z.enum(["active", "off"]).describe("SafeSearch. Default off");
const domains = (what: string) =>
  z
    .array(z.string())
    .max(20)
    .describe(
      `${what}: a domain (example.com, subdomains match), a path prefix (github.com/org) or a TLD (.gov)`,
    );
const date = (when: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe(`Only results published ${when} this date (YYYY-MM-DD). Not together with time`);
const ll = z
  .string()
  .describe('Map point "@lat,lng,14z" to search around (zoom optional). Overrides location');
const url = z.string().min(1).describe("Absolute http(s) URL of an HTML page or a PDF");
const paths = (what: string) =>
  z.array(z.string()).max(20).describe(`Regular expressions matched against the URL path; ${what}`);
const maxTokens = z
  .number()
  .int()
  .min(100)
  .max(100_000)
  .describe("Trim each page to about this many tokens");

const includeAnswer = z
  .boolean()
  .describe(
    "Also write a short answer over the results that cites them with [n] markers (extra credits; free if it fails)",
  );

const geo = { q, country, language, location, page };
const filters = {
  include_domains: domains("Only results from these sources"),
  exclude_domains: domains("Drop results from these sources"),
  start_date: date("on or after"),
  end_date: date("on or before"),
};

export const searchInput = z
  .object({
    ...geo,
    ...filters,
    num: z
      .number()
      .int()
      .min(10)
      .max(100)
      .describe("Number of results, 10 (default) up to 100. More than 10 costs up to 7 credits"),
    time,
    device,
    safe,
    boost_domains: domains("Move results from these sources to the top"),
    include_content: z
      .number()
      .int()
      .min(0)
      .max(5)
      .describe("Also read the top N result pages as Markdown (+1 credit per page read)"),
    highlights: z
      .boolean()
      .describe("With include_content: return only the 3 passages of each page most relevant to q"),
    include_answer: includeAnswer,
  })
  .partial()
  .required({ q: true });

export const newsInput = z
  .object({
    ...geo,
    ...filters,
    num: z.number().int().min(10).max(100).describe("Number of articles, 10 (default) up to 100"),
    time,
    boost_domains: domains("Move articles from these sources to the top"),
    include_answer: includeAnswer,
  })
  .partial()
  .required({ q: true });

export const imagesInput = z
  .object({ ...geo, ...filters, time, safe })
  .partial()
  .required({ q: true });
export const videosInput = z
  .object({ ...geo, ...filters, time })
  .partial()
  .required({ q: true });
export const shoppingInput = z
  .object({ ...geo, time })
  .partial()
  .required({ q: true });
/** Maps and places. */
export const placesInput = z
  .object({ ...geo, ll })
  .partial()
  .required({ q: true });
export const scholarInput = z
  .object({ q, country, language, page })
  .partial()
  .required({ q: true });
export const patentsInput = z
  .object({
    q,
    country,
    language: z
      .string()
      .describe(
        "A non-English code (de, fr, ja, …) restricts results to that publication language",
      ),
    page,
  })
  .partial()
  .required({ q: true });
export const autocompleteInput = z.object({ q, country, language }).partial().required({ q: true });

export const reviewsInput = z
  .object({
    place_id: z.string().describe("Google place id, from a maps or places result"),
    cid: z.string().describe("Google cid of the place (instead of place_id)"),
    fid: z.string().describe("Google fid of the place (instead of place_id)"),
    sort: z
      .enum(["most_relevant", "newest", "highest_rating", "lowest_rating"])
      .describe(
        "Review order. Only most_relevant is served; other orders return 400 (Google shows them only to signed-in visitors)",
      ),
    num: z
      .number()
      .int()
      .min(1)
      .max(50)
      .describe(
        "Reviews per page. Default 10; the first 10 reviews of a place are all Google shows",
      ),
    page_token: z
      .string()
      .describe("next_page_token from the previous page, unchanged, for the next page"),
    country,
    language,
  })
  .partial();

export const placeInput = z
  .object({
    place_id: z.string().describe("Google place id, from a maps or places result"),
    cid: z.string().describe("Google cid of the place (instead of place_id)"),
    fid: z.string().describe("Google fid of the place (instead of place_id)"),
    oid: z
      .string()
      .regex(/^[0-9]{1,20}$/)
      .describe(
        "Yandex Maps organisation id (digits, from yandex.ru/maps/org/<name>/<oid>/), instead of the Google ids",
      ),
    country,
    language: language.describe(
      "Language of the address, categories, hours and description, e.g. en, ru. Default en",
    ),
  })
  .partial();

export const webpageInput = z
  .object({
    url,
    country: country.describe("Fetch through an exit in this country, for geo-dependent pages"),
    include_links: z.boolean().describe("Also return the page's outbound links"),
  })
  .partial()
  .required({ url: true });

export const extractInput = z
  .object({
    urls: z.array(url).min(1).max(20).describe("1-20 pages (HTML or PDF) to read"),
    query: z
      .string()
      .max(4096)
      .describe("What the pages are read for; ranks the passages returned with highlights"),
    highlights: z
      .number()
      .int()
      .min(0)
      .max(10)
      .describe("Return only this many passages per page ranked against query (0 = whole page)"),
    max_tokens: maxTokens,
    country: country.describe("Fetch through an exit in this country"),
    summary: z
      .boolean()
      .describe(
        "Add a 3-6 sentence summary of each page, focused on query when set (extra credits per page)",
      ),
  })
  .partial()
  .required({ urls: true });

export const mapInput = z
  .object({
    url: url.describe("Any page of the site; sitemaps are read from its origin"),
    search: z.string().max(512).describe("Keep only URLs relevant to these words, best first"),
    limit: z.number().int().min(1).max(5000).describe("Maximum URLs. Default 100"),
    include_paths: paths("keep only URLs matching one (e.g. ^/docs/)"),
    exclude_paths: paths("drop URLs matching one"),
  })
  .partial()
  .required({ url: true });

export const rankInput = z
  .object({
    q: q.describe("The keyword to check"),
    domain: z.string().min(1).describe('Domain to find, e.g. "example.com" (subdomains match)'),
    num: z
      .union([z.literal(10), z.literal(20), z.literal(30), z.literal(50), z.literal(100)])
      .describe("How many results to check. Default 100"),
    country,
    language,
    location,
    device,
  })
  .partial()
  .required({ q: true, domain: true });

export const crawlInput = z
  .object({
    url: url.describe("Start page"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .describe("Maximum pages read (credits reserved). Default 25"),
    max_depth: z.number().int().min(0).max(10).describe("Link hops from url. Default 2"),
    query: z.string().max(512).describe("Read the pages most relevant to these words first"),
    include_paths: paths("follow only paths matching one"),
    exclude_paths: paths("never follow paths matching one"),
    max_tokens: maxTokens,
  })
  .partial()
  .required({ url: true });

export const crawlResultInput = z.object({
  id: z.string().min(1).describe("The task id returned by the crawl tool"),
});

export const answerInput = z
  .object({
    q: z.string().min(1).max(2048).describe("The question to answer from live Google results"),
    depth: z
      .enum(["fast", "standard"])
      .describe(
        "fast answers from the result page (cheapest); standard (default) also reads the top pages",
      ),
    num_sources: z
      .number()
      .int()
      .min(1)
      .max(5)
      .describe("Pages read with depth standard. Default 3"),
    country,
    language,
    location,
    time,
    include_domains: domains("Only results from these sources"),
    exclude_domains: domains("Drop results from these sources"),
    start_date: date("on or after"),
    end_date: date("on or before"),
  })
  .partial()
  .required({ q: true });

export const researchInput = z
  .object({
    input: z.string().min(1).max(8000).describe("The research task or question in plain words"),
    effort: z
      .enum(["lite", "standard", "deep"])
      .describe(
        "How much to search and read: lite (fastest, cheapest), standard (default) or deep (most thorough, most credits)",
      ),
    country,
    language,
    include_domains: domains("Only research these sources"),
    exclude_domains: domains("Never use these sources"),
  })
  .partial()
  .required({ input: true });

export const researchResultInput = z.object({
  id: z.string().min(1).describe("The task id returned by the research tool"),
});
