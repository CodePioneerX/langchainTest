import { SupabaseVectorStore } from "@langchain/community/vectorstores/supabase";
import { OpenAIEmbeddings } from "@langchain/openai";
import type { Document } from "@langchain/core/documents";
import { createClient } from "@supabase/supabase-js";
import { logger } from "../utils/logger.js";

/**
 * Initialize Supabase pgvector store
 * Uses the same PostgreSQL database as the checkpointer
 */
export async function initializeVectorStore(
  embeddings: OpenAIEmbeddings
): Promise<SupabaseVectorStore> {
  logger.info("Initializing Supabase pgvector store...");

  try {
    const supabaseUrl = process.env.SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_API_KEY!;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("SUPABASE_URL and SUPABASE_API_KEY must be set");
    }

    logger.info(`Connecting to Supabase at: ${supabaseUrl}`);

    const client = createClient(supabaseUrl, supabaseKey);

    const vectorStore = new SupabaseVectorStore(embeddings, {
      client,
      tableName: "documents",
      queryName: "match_documents",
    });

    logger.info("✓ Supabase pgvector store initialized");
    return vectorStore;
  } catch (error: any) {
    logger.error("Failed to initialize Supabase pgvector:", error);
    throw new Error(`Failed to initialize pgvector: ${error.message}`);
  }
}

/**
 * Add documents to Supabase pgvector store in batches
 * pgvector will generate and store embeddings automatically
 */
export async function addDocuments(docs: Document[]): Promise<void> {
  logger.info(`Adding ${docs.length} documents to Supabase pgvector...`);

  try {
    const embeddings = new OpenAIEmbeddings({
      modelName: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
      openAIApiKey: process.env.OPENAI_API_KEY,
    });

    const vectorStore = await initializeVectorStore(embeddings);

    // Process in smaller batches to avoid statement timeout
    const BATCH_SIZE = 100; // Smaller batches to stay under Supabase timeout
    const batches = Math.ceil(docs.length / BATCH_SIZE);

    logger.info(`Processing ${batches} batches of ${BATCH_SIZE} documents each...`);

    for (let i = 0; i < batches; i++) {
      const start = i * BATCH_SIZE;
      const end = Math.min((i + 1) * BATCH_SIZE, docs.length);
      const batch = docs.slice(start, end);

      logger.info(`Adding batch ${i + 1}/${batches} (${batch.length} documents)...`);

      await vectorStore.addDocuments(batch);

      logger.info(`✓ Batch ${i + 1}/${batches} completed`);
    }

    logger.info(`✓ Successfully added all ${docs.length} documents to pgvector`);
  } catch (error: any) {
    logger.error("Error adding documents to pgvector:", error);
    throw new Error(`Failed to add documents: ${error.message}`);
  }
}

/**
 * Get a retriever instance from Supabase pgvector
 */
export async function getRetriever(k: number = 5) {
  const embeddings = new OpenAIEmbeddings({
    modelName: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
    openAIApiKey: process.env.OPENAI_API_KEY,
  });

  const vectorStore = await initializeVectorStore(embeddings);
  return vectorStore.asRetriever({ k });
}
