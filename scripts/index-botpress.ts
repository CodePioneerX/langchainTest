import "dotenv/config";
import { addDocuments } from "../src/database/vector-store.js";
import { loadPagesFromSitemap } from "../src/services/scraper.js";
import { chunkDocuments } from "../src/services/chunker.js";
import { logger } from "../src/utils/logger.js";
import type { ScrapeStats } from "../src/types/index.js";

const SITEMAP_URL = "https://botpress.com/sitemap.xml";


/**
 * Main indexing function
 */
async function indexBotpress() {
  const stats: ScrapeStats = {
    pagesProcessed: 0,
    duplicatesSkipped: 0,
    chunksCreated: 0,
    embeddingsGenerated: 0,
    errors: 0,
  };

  try {
    logger.info("Starting Botpress documentation indexing...");
    logger.info("=".repeat(60));

    // Step 1: Load pages from sitemap (combines URL discovery + scraping)
    logger.info("\n[1/4] Loading pages from sitemap...");
    const docs = await loadPagesFromSitemap(SITEMAP_URL);
    stats.pagesProcessed = docs.length;

    if (docs.length === 0) {
      logger.error("No pages loaded. Exiting.");
      return;
    }

    logger.info(`✓ Loaded ${docs.length} pages`);

    // Step 2: Chunk documents (no PostgreSQL storage needed with Chroma)
    logger.info(`\n[2/3] Chunking ${docs.length} documents...`);
    const documentsToChunk = docs.map((doc) => ({
      id: doc.metadata.source || doc.metadata.loc || 'unknown',
      url: doc.metadata.source || doc.metadata.loc || 'unknown',
      content: doc.pageContent,
      title: doc.metadata.title || null,
    }));

    const chunks = await chunkDocuments(documentsToChunk);
    stats.chunksCreated = chunks.length;
    stats.pagesProcessed = docs.length;
    logger.info(`✓ Created ${chunks.length} chunks`);

    // Step 3: Store chunks in vector database (Chroma will generate embeddings automatically)
    logger.info(`\n[3/3] Storing ${chunks.length} chunks in vector database...`);
    logger.info("Chroma will generate embeddings automatically. This may take a while...");
    await addDocuments(chunks);
    stats.embeddingsGenerated = chunks.length; // All chunks get embedded by Chroma
    logger.info("✓ Stored in vector database with embeddings");

    // Final summary
    logger.info("\n" + "=".repeat(60));
    logger.info("Indexing complete!");
    logger.info("=".repeat(60));
    logger.info(`Pages processed:        ${stats.pagesProcessed}`);
    logger.info(`Chunks created:         ${stats.chunksCreated}`);
    logger.info(`Embeddings generated:   ${stats.embeddingsGenerated}`);
    logger.info(`Errors:                 ${stats.errors}`);
    logger.info("=".repeat(60));

  } catch (error: any) {
    logger.error("Fatal error during indexing:", error);
    stats.errors++;
    throw error;
  }
}

// Run the indexing
indexBotpress().catch((error) => {
  logger.error("Unhandled error:", error);
  process.exit(1);
});
