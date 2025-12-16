#!/usr/bin/env node

/*
 * MCP WebSearch Server
 * Search & scrape the web via SearchAPI.io
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";
import * as cheerio from "cheerio";

const API_KEY = process.env.SEARCHAPI_KEY;
const API_URL = "https://www.searchapi.io/api/v1/search";

// warn if no key
if (!API_KEY) console.error("[warn] SEARCHAPI_KEY not set");

const mcp = new McpServer({
  name: "mcp-websearch",
  version: "2.0.0",
});

// selectors we try when looking for main content
const CONTENT_SELECTORS = [
  "article", "main", "[role='main']",
  ".post-content", ".article-content", ".entry-content",
  ".content", "#content", ".post-body", ".markdown-body"
];

// junk we strip out
const JUNK_SELECTORS = [
  "script", "style", "noscript", "iframe", "svg",
  "nav", "footer", "header", "aside",
  ".ads", ".sidebar", ".comments", ".cookie-banner"
].join(", ");

// browser-ish headers
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0",
  "Accept": "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9"
};

function trim(str, len = 10000) {
  return str.replace(/[\t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, len);
}

async function req(url, params, tries = 2) {
  let err;
  for (let i = 0; i <= tries; i++) {
    try {
      let res = await axios.get(url, { params, timeout: 15000 });
      return res.data;
    } catch (e) {
      err = e;
      if (i < tries) await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw err;
}

function fmtResults(items) {
  if (!items || !items.length) return "Nothing found.";
  let out = "";
  for (let i = 0; i < items.length; i++) {
    let r = items[i];
    out += `[${i + 1}] ${r.title}\n    URL: ${r.link}\n    ${r.snippet || "-"}\n\n`;
  }
  return out.trim();
}

function parseError(e) {
  if (e.code === "ENOTFOUND") return "Domain not found";
  if (e.code === "ETIMEDOUT") return "Timed out";
  let status = e.response?.status;
  if (status === 403) return "Forbidden (403)";
  if (status === 404) return "Not found (404)";
  if (status === 429) return "Rate limited";
  return e.message;
}


// ---- web_search ----
mcp.tool(
  "web_search",
  `Search the web using Google Search via SearchAPI.io.

USE THIS TOOL WHEN:
- User asks to find information, news, or current events
- User needs to research a topic
- User asks "search for...", "find...", "look up..."
- You need factual information that may have changed recently

RETURNS: List of search results with titles, URLs, and snippets.
After searching, you can use web_scrape to get full content from relevant URLs.`,
  {
    query: z.string().describe("The search query - be specific for better results"),
    num_results: z.number().min(1).max(20).default(10).optional()
      .describe("Number of results to return (1-20, default 10)"),
    page: z.number().min(1).max(10).default(1).optional()
      .describe("Page number for pagination (1-10, default 1). Use if first page doesn't have what you need."),
    time_period: z.enum(["last_hour", "last_day", "last_week", "last_month", "last_year"]).optional()
      .describe("Filter results by time period"),
    site: z.string().optional()
      .describe("Limit search to specific site (e.g., 'github.com', 'stackoverflow.com')"),
  },
  async (args) => {
    if (!API_KEY) {
      return { content: [{ type: "text", text: "Error: SEARCHAPI_KEY not configured." }], isError: true };
    }

    let { query, num_results, page, time_period, site } = args;
    num_results = num_results || 10;
    page = page || 1;

    try {
      let q = site ? `site:${site} ${query}` : query;

      let data = await req(API_URL, {
        engine: "google",
        q,
        api_key: API_KEY,
        page,
        time_period,
        hl: "en"
      });

      let results = (data.organic_results || []).slice(0, num_results);
      let total = data.search_information?.total_results || "?";

      let header = `Search: "${query}"`;
      if (site) header += ` (site:${site})`;
      if (time_period) header += ` [${time_period}]`;
      header += `\nPage ${page} | ~${total} results\n${"=".repeat(50)}\n\n`;

      let body = fmtResults(results.map(r => ({
        title: r.title,
        link: r.link,
        snippet: r.snippet
      })));

      let tip = results.length < 5
        ? `\n\nTip: try page=${page + 1} or use ai_search for better answers`
        : "";

      return { content: [{ type: "text", text: header + body + tip }] };

    } catch (e) {
      return { content: [{ type: "text", text: "Search failed: " + parseError(e) }], isError: true };
    }
  }
);

// ---- ai_search ----
mcp.tool(
  "ai_search",
  `Search using Google AI Mode - get AI-generated answers with sources.

USE THIS TOOL WHEN:
- User needs a comprehensive, synthesized answer (not just links)
- Complex questions that need explanation
- "Explain...", "What is...", "How does... work?"
- When regular search results aren't giving good answers
- Need code examples or technical explanations

RETURNS: AI-generated answer with markdown formatting and reference links.
This is more expensive than web_search, use wisely.`,
  {
    query: z.string().describe("The question or topic to get AI-generated answer for"),
    image_url: z.string().url().optional()
      .describe("Optional image URL for visual questions (e.g., 'What is in this image?')"),
    location: z.string().optional()
      .describe("Location for local queries (e.g., 'New York' for 'restaurants near me')"),
  },
  async (args) => {
    if (!API_KEY) {
      return { content: [{ type: "text", text: "Error: SEARCHAPI_KEY not configured." }], isError: true };
    }

    let { query, image_url, location } = args;

    try {
      let params = { engine: "google_ai_mode", q: query, api_key: API_KEY };
      if (image_url) params.url = image_url;
      if (location) params.location = location;

      let data = await req(API_URL, params);

      let out = `AI Answer: "${query}"\n${"=".repeat(50)}\n\n`;

      // prefer markdown response
      if (data.markdown) {
        out += data.markdown.slice(0, 8000);
      } else if (data.text_blocks) {
        // fallback: parse blocks
        for (let b of data.text_blocks.slice(0, 10)) {
          if (b.type === "header") out += `\n### ${b.answer}\n`;
          else if (b.type === "paragraph") out += b.answer + "\n\n";
          else if (b.type === "code_blocks") out += "```" + (b.language || "") + "\n" + b.code + "\n```\n\n";
          else if (b.type === "unordered_list" && b.items) {
            b.items.forEach(it => { out += "- " + (it.answer || it) + "\n"; });
            out += "\n";
          }
        }
      }

      // sources
      if (data.reference_links?.length) {
        out += "\n---\nSources:\n";
        data.reference_links.slice(0, 8).forEach(ref => {
          out += `[${ref.index}] ${ref.title}\n    ${ref.link}\n`;
        });
      }

      // local results (restaurants etc)
      if (data.local_results?.length) {
        out += "\n---\nNearby:\n";
        data.local_results.slice(0, 5).forEach(loc => {
          out += `- ${loc.title}`;
          if (loc.rating) out += ` (${loc.rating}★)`;
          if (loc.address) out += ` - ${loc.address}`;
          out += "\n";
        });
      }

      return { content: [{ type: "text", text: trim(out, 12000) }] };

    } catch (e) {
      return { content: [{ type: "text", text: "AI search failed: " + parseError(e) }], isError: true };
    }
  }
);


// ---- web_scrape ----
mcp.tool(
  "web_scrape",
  `Scrape and extract readable content from a webpage URL.

USE THIS TOOL WHEN:
- You have a URL and need to read its full content
- User shares a link and asks about its content
- After web_search, to get detailed information from a result
- User asks to "read", "summarize", or "extract" from a URL

RETURNS: Page title, meta description, and main text content (cleaned and truncated).
The content is automatically cleaned of scripts, styles, and navigation elements.`,
  {
    url: z.string().url().describe("Full URL to scrape (must start with http:// or https://)"),
    selector: z.string().optional()
      .describe("Optional CSS selector to extract specific elements (e.g., 'article', '.main-content', '#post-body')"),
    extract_mode: z.enum(["text", "markdown", "structured"]).default("text").optional()
      .describe("Output format: 'text' (plain), 'markdown' (preserve formatting), 'structured' (headings + paragraphs)"),
    include_links: z.boolean().default(false).optional()
      .describe("Include links found in the content"),
    max_length: z.number().min(1000).max(50000).default(10000).optional()
      .describe("Maximum content length (1000-50000, default 10000)"),
  },
  async (args) => {
    let { url, selector, extract_mode, include_links, max_length } = args;
    extract_mode = extract_mode || "text";
    max_length = max_length || 10000;

    try {
      let res = await axios.get(url, {
        headers: HEADERS,
        timeout: 20000,
        maxRedirects: 5,
        validateStatus: s => s < 400
      });

      let $ = cheerio.load(res.data);
      $(JUNK_SELECTORS).remove();

      // meta
      let title = $("title").text().trim()
        || $('meta[property="og:title"]').attr("content")
        || "Untitled";
      let desc = $('meta[name="description"]').attr("content")
        || $('meta[property="og:description"]').attr("content")
        || "";
      let author = $('meta[name="author"]').attr("content") || "";
      let date = $('meta[property="article:published_time"]').attr("content")
        || $("time[datetime]").attr("datetime")
        || "";

      // find content container
      let $main;
      if (selector) {
        $main = $(selector);
      } else {
        for (let sel of CONTENT_SELECTORS) {
          let el = $(sel);
          if (el.length && el.text().trim().length > 300) {
            $main = el;
            break;
          }
        }
      }
      if (!$main || !$main.length) $main = $("body");

      let body = "";
      let links = [];

      if (extract_mode === "structured") {
        $main.find("h1,h2,h3,h4,h5,h6,p,li,pre,blockquote").each((_, el) => {
          let tag = el.tagName.toLowerCase();
          let txt = $(el).text().trim();
          if (!txt) return;
          if (tag[0] === "h") body += "\n" + "#".repeat(+tag[1]) + " " + txt + "\n\n";
          else if (tag === "li") body += "- " + txt + "\n";
          else if (tag === "pre") body += "```\n" + txt + "\n```\n\n";
          else if (tag === "blockquote") body += "> " + txt + "\n\n";
          else body += txt + "\n\n";
        });
      } else if (extract_mode === "markdown") {
        $main.find("h1,h2,h3,h4,h5,h6").each((_, el) => {
          let lvl = +el.tagName[1];
          $(el).replaceWith("\n" + "#".repeat(lvl) + " " + $(el).text().trim() + "\n\n");
        });
        $main.find("strong,b").each((_, el) => $(el).replaceWith("**" + $(el).text() + "**"));
        $main.find("em,i").each((_, el) => $(el).replaceWith("*" + $(el).text() + "*"));
        $main.find("code").each((_, el) => $(el).replaceWith("`" + $(el).text() + "`"));
        $main.find("pre").each((_, el) => $(el).replaceWith("\n```\n" + $(el).text() + "\n```\n"));
        body = $main.text();
      } else {
        body = $main.text();
      }

      if (include_links) {
        $main.find("a[href]").each((_, el) => {
          let href = $(el).attr("href");
          let txt = $(el).text().trim();
          if (!href || href[0] === "#" || href.startsWith("javascript:")) return;
          if (!txt) return;
          try {
            links.push({ text: txt.slice(0, 80), url: new URL(href, url).href });
          } catch {}
        });
      }

      body = trim(body, max_length);

      // build output
      let out = `URL: ${url}\nTitle: ${title}\n`;
      if (desc) out += `Description: ${desc}\n`;
      if (author) out += `Author: ${author}\n`;
      if (date) out += `Date: ${date}\n`;
      out += "=".repeat(50) + "\n\n" + (body || "No content found.");

      if (include_links && links.length) {
        let uniq = [...new Map(links.map(l => [l.url, l])).values()].slice(0, 20);
        out += "\n\n---\nLinks:\n";
        uniq.forEach((l, i) => { out += `[${i + 1}] ${l.text}\n    ${l.url}\n`; });
      }

      return { content: [{ type: "text", text: out }] };

    } catch (e) {
      return { content: [{ type: "text", text: `Scrape failed (${url}): ${parseError(e)}` }], isError: true };
    }
  }
);


// ---- get_links ----
mcp.tool(
  "get_links",
  `Extract all links from a webpage.

USE THIS TOOL WHEN:
- User wants to see what pages are linked from a URL
- You need to find related pages or navigation options
- Exploring a website's structure
- Finding specific resources linked on a page

RETURNS: List of links with their anchor text and URLs (max 50 links).`,
  {
    url: z.string().url().describe("Full URL to extract links from"),
    filter: z.string().optional()
      .describe("Optional text filter - only return links containing this text in URL or anchor"),
  },
  async (args) => {
    let { url, filter } = args;

    try {
      let res = await axios.get(url, { headers: HEADERS, timeout: 15000 });
      let $ = cheerio.load(res.data);
      let links = [];

      $("a[href]").each((_, el) => {
        let href = $(el).attr("href");
        let txt = $(el).text().trim().replace(/\s+/g, " ");
        if (!href || href[0] === "#" || href.startsWith("javascript:") || href.startsWith("mailto:")) return;

        try {
          let abs = new URL(href, url).href;
          txt = txt.slice(0, 100) || "(no text)";

          if (filter) {
            let f = filter.toLowerCase();
            if (!abs.toLowerCase().includes(f) && !txt.toLowerCase().includes(f)) return;
          }
          links.push({ text: txt, url: abs });
        } catch {}
      });

      let uniq = [...new Map(links.map(l => [l.url, l])).values()];
      let show = uniq.slice(0, 50);

      let out = `Links from: ${url}\n`;
      out += `Found: ${uniq.length}`;
      if (uniq.length > 50) out += " (showing 50)";
      if (filter) out += ` | filter: "${filter}"`;
      out += "\n" + "=".repeat(50) + "\n\n";

      show.forEach((l, i) => { out += `[${i + 1}] ${l.text}\n    ${l.url}\n\n`; });

      return { content: [{ type: "text", text: out.trim() }] };

    } catch (e) {
      return { content: [{ type: "text", text: "Failed: " + parseError(e) }], isError: true };
    }
  }
);

// ---- scrape_multiple ----
mcp.tool(
  "scrape_multiple",
  `Scrape multiple URLs at once and return combined results.

USE THIS TOOL WHEN:
- You need to compare content from multiple pages
- Gathering information from several search results
- Research that requires reading multiple sources

RETURNS: Combined content from all URLs with clear separation.
Limited to 5 URLs to avoid timeout.`,
  {
    urls: z.array(z.string().url()).min(1).max(5)
      .describe("Array of URLs to scrape (max 5)"),
    max_per_page: z.number().min(500).max(5000).default(2000).optional()
      .describe("Max content length per page (500-5000, default 2000)"),
  },
  async (args) => {
    let { urls, max_per_page } = args;
    max_per_page = max_per_page || 2000;

    let jobs = urls.map(async (u) => {
      let res = await axios.get(u, { headers: HEADERS, timeout: 15000 });
      let $ = cheerio.load(res.data);
      $(JUNK_SELECTORS).remove();

      let title = $("title").text().trim() || "Untitled";
      let body = "";
      for (let sel of ["article", "main", ".content", "#content", "body"]) {
        if ($(sel).length) { body = $(sel).text().trim(); break; }
      }
      return { url: u, title, body: trim(body, max_per_page) };
    });

    let results = await Promise.allSettled(jobs);

    let out = "Multi-page scrape\n" + "=".repeat(50) + "\n\n";
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        let { url, title, body } = r.value;
        out += `[${i + 1}] ${title}\n${url}\n${"─".repeat(40)}\n${body}\n\n`;
      } else {
        out += `[${i + 1}] FAILED: ${urls[i]}\n${r.reason?.message || "error"}\n\n`;
      }
    });

    return { content: [{ type: "text", text: out }] };
  }
);

// ---- start ----
(async () => {
  const mode = process.env.MCP_TRANSPORT || "stdio";
  
  if (mode === "http") {
    // HTTP mode - for remote access
    const { SSEServerTransport } = await import("@modelcontextprotocol/sdk/server/sse.js");
    const express = (await import("express")).default;
    
    const app = express();
    const port = process.env.PORT || 3000;
    
    app.get("/sse", async (req, res) => {
      const transport = new SSEServerTransport("/message", res);
      await mcp.connect(transport);
      console.error(`[http] client connected`);
    });
    
    app.post("/message", async (req, res) => {
      // handled by SSE transport
    });
    
    app.listen(port, () => {
      console.error(`[http] mcp server running on http://localhost:${port}`);
    });
  } else {
    // stdio mode - default for npx
    let transport = new StdioServerTransport();
    await mcp.connect(transport);
    console.error("[stdio] websearch mcp ready");
  }
})();
