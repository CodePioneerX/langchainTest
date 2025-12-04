import { StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import type { VectorStoreRetriever } from "@langchain/core/vectorstores";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { AIMessage } from "@langchain/core/messages";
import { GraphState, type GraphStateType } from "./state.js";
import { logger } from "../utils/logger.js";

/**
 * Factory function that creates a workflow with dependencies captured via closure
 * This is the official LangGraph pattern for dependency injection
 */
export function createWorkflow(
  retriever: VectorStoreRetriever,
  llm: ChatOpenAI
) {
  logger.info("Creating LangGraph workflow...");

  // Retriever node - closure captures retriever dependency
  const retrieverNode = async (state: GraphStateType): Promise<Partial<GraphStateType>> => {
    logger.debug("Retriever node: Searching for relevant context");

    try {
      // Extract query from last message
      const query = state.messages[state.messages.length - 1].content.toString();

      // Invoke retriever with query
      const docs = await retriever.invoke(query);

      logger.info(`Retrieved ${docs.length} documents`);

      if (docs.length === 0) {
        logger.warn("No relevant documents found");
        return {
          retrievedDocs: [],
          errors: ["No relevant documents found"],
        };
      }

      return {
        retrievedDocs: docs,
      };
    } catch (error: any) {
      logger.error("Error in retriever node:", error);
      return {
        retrievedDocs: [],
        errors: [`Retrieval failed: ${error.message}`],
      };
    }
  };

  // Generator node - closure captures llm dependency
  const generatorNode = async (state: GraphStateType): Promise<Partial<GraphStateType>> => {
    logger.debug("Generator node: Generating response");

    try {
      // Format context from raw documents (IN NODE, not in state)
      const context = state.retrievedDocs
        .map((doc) => {
          const title = doc.metadata.title || "Document";
          const source = doc.metadata.url || doc.metadata.source || "Unknown source";
          return `[${title}]\nSource: ${source}\n\n${doc.pageContent}`;
        })
        .join("\n\n---\n\n");

      const prompt = ChatPromptTemplate.fromMessages([
        [
          "system",
          `You are a helpful FAQ assistant for Botpress, a chatbot building platform.

CRITICAL RULES:
- ONLY answer questions using the provided documentation context below
- If the context doesn't contain the answer, you MUST say: "I don't have that information in my documentation. Please check the official Botpress docs at https://botpress.com/docs"
- NEVER make up information or use general knowledge
- NEVER provide installation instructions, localhost URLs, or outdated information unless it's in the context

Your role:
- Answer questions strictly based on the provided documentation context
- Handle greetings naturally and offer to help with Botpress questions
- For casual chat, respond politely and guide back to Botpress topics
- Provide specific examples from the docs when available
- Keep responses concise but helpful (under 2000 characters)
- Use markdown formatting for readability
- For follow-up questions, reference previous parts of the conversation

Context from Botpress documentation:
{context}

Guidelines:
- Be accurate and cite sources when appropriate
- If the question is off-topic, politely redirect to Botpress-related topics
- Stay focused on helping with Botpress`,
        ],
        ["placeholder", "{chat_history}"],
        ["human", "{query}"],
      ]);

      const query = state.messages[state.messages.length - 1].content.toString();
      const chain = prompt.pipe(llm).pipe(new StringOutputParser());

      const answer = await chain.invoke({
        context:
          context ||
          "No relevant documentation found for this query.",
        chat_history: state.messages.slice(0, -1), // All messages except current query
        query,
      });

      logger.debug(`Generated answer: ${answer.substring(0, 100)}...`);

      // Only add AI response message (user message already in state.messages)
      return {
        answer,
        messages: [new AIMessage(answer)],
      };
    } catch (error: any) {
      logger.error("Error in generator node:", error);

      const errorAnswer =
        "I apologize, but I encountered an error while processing your request. Please try again.";

      return {
        answer: errorAnswer,
        messages: [new AIMessage(errorAnswer)],
        errors: [`Generation failed: ${error.message}`],
      };
    }
  };

  // Build and return graph (NOT compiled - caller compiles with checkpointer)
  const workflow = new StateGraph(GraphState)
    .addNode("retriever", retrieverNode)
    .addNode("generator", generatorNode)
    .addEdge("__start__", "retriever")
    .addEdge("retriever", "generator")
    .addEdge("generator", "__end__");

  logger.info("✓ Workflow created (ready for compilation with checkpointer)");

  return workflow;
}

/**
 * Standalone graph export for LangGraph Platform deployment
 * This is required by langgraph.json
 *
 * For local bot usage, use createWorkflow() function instead
 *
 * NOTE: LangGraph Platform provides a managed checkpointer automatically.
 * We don't need to create our own PostgresSaver for deployment.
 */
export const graph = async () => {
  // Import dependencies dynamically for platform deployment
  const { getRetriever } = await import("../database/vector-store.js");
  const { ChatOpenAI } = await import("@langchain/openai");

  // Initialize retriever (uses Supabase for vector storage)
  const retriever = await getRetriever(parseInt(process.env.TOP_K_RESULTS || "5", 10));

  // Initialize LLM
  const llm = new ChatOpenAI({
    modelName: process.env.LLM_MODEL || "gpt-4o",
    temperature: parseFloat(process.env.LLM_TEMPERATURE || "0.7"),
    openAIApiKey: process.env.OPENAI_API_KEY,
    maxRetries: 3,
  });

  // Create and compile workflow
  // LangGraph Platform automatically provides a managed checkpointer
  // No need to pass checkpointer parameter - platform handles it!
  const workflow = createWorkflow(retriever, llm);
  return workflow.compile();
};
