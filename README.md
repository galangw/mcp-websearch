# MCP WebSearch Server

MCP Server for web search and advanced web scraping. Uses SearchAPI.io for Google Search and AI Mode.

## Quick Start

### Option 1: Stdio (npx)

```json
{
  "mcpServers": {
    "websearch": {
      "command": "npx",
      "args": ["-y", "mcp-websearch-server"],
      "env": {
        "SEARCHAPI_KEY": "your-api-key-here"
      }
    }
  }
}
```

### Option 2: HTTP Server (Streamable HTTP)

Run as HTTP server:
```bash
MCP_TRANSPORT=http SEARCHAPI_KEY=your-key PORT=3000 npx mcp-websearch-server
```

Then configure MCP client:
```json
{
  "mcpServers": {
    "websearch": {
      "url": "http://localhost:3000/mcp",
      "transport": "streamable-http"
    }
  }
}
```

The server implements MCP Streamable HTTP transport (spec 2025-03-26) with:
- Session management with `Mcp-Session-Id` headers
- SSE streaming for server-initiated messages
- Resumability support with `Last-Event-ID`

Get your API key at [searchapi.io](https://www.searchapi.io/)

## Tools

| Tool | Description |
|------|-------------|
| `web_search` | Google Search with pagination, time filter, site filter |
| `ai_search` | Google AI Mode - get AI-generated answers with sources |
| `web_scrape` | Advanced scraper with multiple extract modes (text/markdown/structured) |
| `get_links` | Extract links from a webpage with optional filter |
| `scrape_multiple` | Scrape up to 5 URLs at once |

## Parameters

### web_search
- `query` - Search query
- `num_results` - Number of results (1-20, default 10)
- `page` - Page number for pagination (1-10)
- `time_period` - Filter: last_hour, last_day, last_week, last_month, last_year
- `site` - Limit to specific site (e.g., "github.com")

### ai_search
- `query` - Question or topic
- `image_url` - Optional image URL for visual questions
- `location` - Location for local queries

### web_scrape
- `url` - URL to scrape
- `selector` - CSS selector (optional)
- `extract_mode` - text, markdown, or structured
- `include_links` - Include links in output
- `max_length` - Max content length (1000-50000)

### get_links
- `url` - URL to extract links from
- `filter` - Text filter for URLs/anchors

### scrape_multiple
- `urls` - Array of URLs (max 5)
- `max_per_page` - Max content per page (500-5000)

## Roadmap

- [ ] Add Serper.dev provider support
- [ ] Add SerpAPI provider support
- [ ] Provider auto-fallback

## License

MIT
