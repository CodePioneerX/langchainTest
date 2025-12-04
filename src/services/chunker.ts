import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Document } from "@langchain/core/documents";

// RecursiveCharacterTextSplitter handles HTML natively
const textSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: parseInt(process.env.CHUNK_SIZE || "1000", 10),
  chunkOverlap: parseInt(process.env.CHUNK_OVERLAP || "200", 10),
  separators: ["\n\n", "\n", ". ", " ", ""],
});

/**
 * Split document into chunks using LangChain's RecursiveCharacterTextSplitter
 * Keeps it simple - just basic chunking with source URL metadata
 */
export async function chunkDocument(
  documentId: string,
  url: string,
  content: string,
  title?: string | null
): Promise<Document[]> {
  // Skip if content is too short
  if (content.length < 50) {
    return [];
  }

  // Split content into chunks using LangChain's built-in splitter
  const chunks = await textSplitter.createDocuments(
    [content],
    [{
      source: url,
      title: title || undefined,
      document_id: documentId,
    }]
  );

  return chunks;
}

/**
 * Chunk multiple documents in batch
 */
export async function chunkDocuments(
  documents: Array<{
    id: string;
    url: string;
    content: string;
    title?: string | null;
  }>
): Promise<Document[]> {
  const allChunks: Document[] = [];

  for (const doc of documents) {
    const chunks = await chunkDocument(doc.id, doc.url, doc.content, doc.title);
    allChunks.push(...chunks);
  }

  return allChunks;
}
