import { SitemapLoader } from "@langchain/community/document_loaders/web/sitemap";
import { Document } from "langchain/document";
import { logger } from "../utils/logger.js";
import * as cheerio from "cheerio";

/**
 * Custom parser that removes navigation/headers/footers but KEEPS code blocks
 * Code blocks are valuable for technical documentation retrieval
 */
function parseHtml(html: string): string {
  const $ = cheerio.load(html);

  // Remove only navigation, headers, footers (keep code blocks!)
  $(
    'script, style, nav, header, footer, [role="navigation"], .sidebar, .nav, [class*="navigation"]'
  ).remove();

  // Extract main content area
  const main = $('main, article, [role="main"], .content').first();
  const text = main.length > 0 ? main.text() : $("body").text();

  // Clean up whitespace
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Load and scrape pages from sitemap using LangChain's SitemapLoader
 * This is the official LangChain pattern for documentation sites
 */
export async function loadPagesFromSitemap(
  sitemapUrl: string = "https://botpress.com/sitemap.xml",
  maxPages: number = parseInt(process.env.MAX_PAGES || "500", 10)
): Promise<Document[]> {
  logger.info(`Loading pages from sitemap: ${sitemapUrl}`);

  try {
    // Use SitemapLoader - handles concurrent scraping automatically
    const loader = new SitemapLoader(sitemapUrl, {
      // Custom parser to remove nav/footer but keep code blocks
      parsingFunction: parseHtml,
    } as any);

    logger.info("Starting concurrent scraping with SitemapLoader...");
    let docs = await loader.load();

    // Limit to maxPages if needed
    if (docs.length > maxPages) {
      logger.info(`Limiting from ${docs.length} to ${maxPages} pages`);
      docs = docs.slice(0, maxPages);
    }

    logger.info(`✓ Successfully scraped ${docs.length} pages`);
    return docs;
  } catch (error: any) {
    logger.error(`Error loading sitemap from ${sitemapUrl}:`, error.message);
    throw new Error(`Failed to load sitemap: ${error.message}`);
  }
}
