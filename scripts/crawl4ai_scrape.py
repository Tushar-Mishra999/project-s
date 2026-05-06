import asyncio
import sys
from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig

async def main():
    if len(sys.argv) < 2:
        print("Usage: crawl4ai_scrape.py <url>", file=sys.stderr)
        sys.exit(1)
    url = sys.argv[1]
    async with AsyncWebCrawler() as crawler:
        result = await crawler.arun(url=url)
        print(result.markdown)

if __name__ == "__main__":
    asyncio.run(main())
