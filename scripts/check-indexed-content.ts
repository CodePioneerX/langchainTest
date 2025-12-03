import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { logger } from "../src/utils/logger.js";

async function checkIndexedContent() {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_API_KEY!;

  const client = createClient(supabaseUrl, supabaseKey);

  // Get total count
  const { count } = await client
    .from("documents")
    .select("*", { count: "exact", head: true });

  logger.info(`Total documents: ${count}`);

  // Get 5 random samples
  const { data: samples, error } = await client
    .from("documents")
    .select("id, content, metadata")
    .limit(5);

  if (error) {
    logger.error("Error fetching samples:", error);
    return;
  }

  logger.info("\n=== SAMPLE DOCUMENTS ===\n");

  samples?.forEach((doc, i) => {
    logger.info(`\n--- Document ${i + 1} ---`);
    logger.info(`ID: ${doc.id}`);
    logger.info(`Metadata: ${JSON.stringify(doc.metadata, null, 2)}`);
    logger.info(`Content preview (first 500 chars):`);
    logger.info(doc.content.substring(0, 500));
    logger.info(`\nContent length: ${doc.content.length} characters`);
  });

  // Search for "chatbot" to see what comes up
  logger.info("\n\n=== SEARCH TEST: 'create chatbot' ===\n");

  const { data: searchResults } = await client.rpc("match_documents", {
    query_embedding: await getEmbedding("create chatbot botpress"),
    match_count: 3,
  });

  if (searchResults) {
    searchResults.forEach((doc: any, i: number) => {
      logger.info(`\n--- Result ${i + 1} (similarity: ${doc.similarity}) ---`);
      logger.info(`Metadata: ${JSON.stringify(doc.metadata, null, 2)}`);
      logger.info(`Content preview:`);
      logger.info(doc.content.substring(0, 300));
    });
  }
}

async function getEmbedding(text: string): Promise<number[]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text,
    }),
  });

  const data: any = await response.json();
  return data.data[0].embedding;
}

checkIndexedContent().catch((error) => {
  logger.error("Error:", error);
  process.exit(1);
});
