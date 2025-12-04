import { PlaywrightWebBaseLoader } from "@langchain/community/document_loaders/web/playwright";
import { Document } from "@langchain/core/documents";
import { logger } from "../utils/logger.js";
import axios from "axios";
import * as xml2js from "xml2js";

/**
 * Load and scrape pages from sitemap using Playwright
 * Playwright executes JavaScript, giving us clean rendered content from Next.js sites
 */
export async function loadPagesFromSitemap(
  sitemapUrl: string = "https://botpress.com/sitemap.xml",
  maxPages: number = parseInt(process.env.MAX_PAGES || "500", 10)
): Promise<Document[]> {
  logger.info(`Loading pages from sitemap: ${sitemapUrl}`);

  try {
    // Step 1: Fetch and parse sitemap XML
    logger.info("Fetching sitemap XML...");
    const response = await axios.get(sitemapUrl);
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(response.data);

    // Extract URLs from sitemap
    const urls: string[] = result.urlset.url.map((entry: any) => entry.loc[0]);
    logger.info(`Found ${urls.length} URLs in sitemap`);

    // Limit to maxPages
    const urlsToScrape = urls.slice(0, maxPages);
    logger.info(`Scraping ${urlsToScrape.length} pages with Playwright...`);

    // Step 2: Use PlaywrightWebBaseLoader to scrape each URL
    const docs: Document[] = [];

    for (let i = 0; i < urlsToScrape.length; i++) {
      const url = urlsToScrape[i];

      try {
        const loader = new PlaywrightWebBaseLoader(url, {
          launchOptions: {
            headless: true,
          },
          gotoOptions: {
            waitUntil: "domcontentloaded",
          },
          evaluate: async (page): Promise<string> => {
            // Wait for main content to load
            await page.waitForSelector('main, article, [role="main"]', { timeout: 5000 }).catch(() => {});

            // Extract main content (runs in browser context)
            const content: string = await page.evaluate(`
              (() => {
                // Remove unwanted elements
                const selectors = 'script, style, nav, header, footer, [role="navigation"], .sidebar, .nav, [class*="navigation"], iframe, noscript';
                document.querySelectorAll(selectors).forEach((el) => el.remove());

                // Get main content
                const main = document.querySelector('main, article, [role="main"], .content');
                return main ? main.textContent : document.body.textContent;
              })()
            `);

            return content || "";
          },
        });

        const pageDocs = await loader.load();
        docs.push(...pageDocs);

        if ((i + 1) % 50 === 0) {
          logger.info(`Progress: ${i + 1}/${urlsToScrape.length} pages scraped`);
        }
      } catch (error: any) {
        logger.warn(`Failed to scrape ${url}: ${error.message}`);
      }
    }

    logger.info(`✓ Successfully scraped ${docs.length} pages`);
    return docs;
  } catch (error: any) {
    logger.error(`Error loading sitemap from ${sitemapUrl}:`, error.message);
    throw new Error(`Failed to load sitemap: ${error.message}`);
  }
}
