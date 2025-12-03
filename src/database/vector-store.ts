import { Chroma } from "@langchain/community/vectorstores/chroma";
import { OpenAIEmbeddings } from "@langchain/openai";
import type { Document } from "@langchain/core/documents";
import { logger } from "../utils/logger.js";

/**
 * Initialize Chroma vector store
 * Uses Chroma Cloud for production or local persistence for development
 */
export async function initializeVectorStore(
  embeddings: OpenAIEmbeddings
): Promise<Chroma> {
  logger.info("Initializing Chroma vector store...");

  try {
    // For now, use local Chroma server (development)
    // Chroma Cloud configuration will be added when you sign up
    logger.info("Using local Chroma server (development mode)");

    const chromaUrl = process.env.CHROMA_URL || "http://localhost:8000";

    const vectorStore = new Chroma(embeddings, {
      collectionName: "botpress_docs",
      url: chromaUrl,
      collectionMetadata: {
        "hnsw:space": "cosine",
      },
    });

    // Note: For Chroma Cloud (production), you'll need to:
    // 1. Sign up at https://trychroma.com
    // 2. Get API credentials
    // 3. Set CHROMA_URL to your cloud endpoint

    logger.info("✓ Chroma vector store initialized");
    return vectorStore;
  } catch (error: any) {
    logger.error("Failed to initialize Chroma:", error);
    throw new Error(`Failed to initialize Chroma: ${error.message}`);
  }
}

/**
 * Add documents to Chroma vector store in batches
 * Chroma automatically generates embeddings for the documents
 * Max batch size is 5461 documents per batch
 */
export async function addDocuments(docs: Document[]): Promise<void> {
  logger.info(`Adding ${docs.length} documents to Chroma...`);

  try {
    const embeddings = new OpenAIEmbeddings({
      modelName: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
      openAIApiKey: process.env.OPENAI_API_KEY,
    });

    const vectorStore = await initializeVectorStore(embeddings);

    // Chroma has HTTP payload size limits - process in smaller batches
    const BATCH_SIZE = 1000; // Smaller batches to avoid HTTP 413 errors
    const batches = Math.ceil(docs.length / BATCH_SIZE);

    logger.info(`Processing ${batches} batches of ${BATCH_SIZE} documents each...`);

    for (let i = 0; i < batches; i++) {
      const start = i * BATCH_SIZE;
      const end = Math.min((i + 1) * BATCH_SIZE, docs.length);
      const batch = docs.slice(start, end);

      logger.info(`Adding batch ${i + 1}/${batches} (${batch.length} documents)...`);

      // Add documents with IDs (Chroma generates embeddings automatically)
      const ids = batch.map((_, j) => `doc_${Date.now()}_${start + j}`);
      await vectorStore.addDocuments(batch, { ids });

      logger.info(`✓ Batch ${i + 1}/${batches} completed`);
    }

    logger.info(`✓ Successfully added all ${docs.length} documents to Chroma`);
  } catch (error: any) {
    logger.error("Error adding documents to Chroma:", error);
    throw new Error(`Failed to add documents: ${error.message}`);
  }
}

/**
 * Get a retriever instance from Chroma
 */
export async function getRetriever(k: number = 5) {
  const embeddings = new OpenAIEmbeddings({
    modelName: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
    openAIApiKey: process.env.OPENAI_API_KEY,
  });

  const vectorStore = await initializeVectorStore(embeddings);
  return vectorStore.asRetriever({ k });
}
