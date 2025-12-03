// Scraping statistics for indexing script
export interface ScrapeStats {
  pagesProcessed: number;
  duplicatesSkipped: number;
  chunksCreated: number;
  embeddingsGenerated: number;
  errors: number;
}
