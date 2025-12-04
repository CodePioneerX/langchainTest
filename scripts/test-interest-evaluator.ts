import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { createWorkflow } from "../src/graph/workflow.js";
import { getRetriever } from "../src/database/vector-store.js";
import { logger } from "../src/utils/logger.js";

/**
 * Test the interest evaluator with a realistic conversation
 */
async function testInterestEvaluator() {
  logger.info("Testing Interest Evaluator...");
  logger.info("=".repeat(60));

  try {
    // Initialize retriever and LLM
    const retriever = await getRetriever(5);
    const llm = new ChatOpenAI({
      modelName: process.env.LLM_MODEL || "gpt-4o",
      temperature: parseFloat(process.env.LLM_TEMPERATURE || "0.7"),
      openAIApiKey: process.env.OPENAI_API_KEY,
    });

    // Create workflow
    const workflow = createWorkflow(retriever, llm);
    const app = workflow.compile();

    // Simulate the conversation you had
    const messages = [
      new HumanMessage("Hello"),
      new AIMessage("Hello! How can I assist you with Botpress today?"),
      new HumanMessage("What can you do?"),
      new AIMessage("I'm here to help with any questions you might have about Botpress..."),
      new HumanMessage("I'm interested in having a web chat for my company? But not sure if botpress is the right solution?"),
      new AIMessage("Botpress could potentially be a great fit for your company's web chat needs..."),
      new HumanMessage("I think those are all good points and I would definitely like to sign up"),
      new AIMessage("I don't have that information in my documentation. Please check the official Botpress docs..."),
      new HumanMessage("What would the pricing plan be?"),
    ];

    logger.info("\nSimulating conversation with the following messages:");
    messages.forEach((msg, i) => {
      const type = msg instanceof HumanMessage ? "Human" : "AI";
      logger.info(`${i + 1}. ${type}: ${msg.content.toString().substring(0, 80)}...`);
    });

    // Invoke workflow with the last message
    logger.info("\n" + "=".repeat(60));
    logger.info("Invoking workflow...\n");

    const result = await app.invoke({
      messages: messages,
    });

    // Display results
    logger.info("\n" + "=".repeat(60));
    logger.info("RESULTS:");
    logger.info("=".repeat(60));
    logger.info(`Interest Score: ${result.interestScore}/10`);
    logger.info(`Collecting Contact: ${result.collectingContact}`);
    logger.info(`Contact Info Collected: ${result.contactInfo.collected}`);

    if (result.appendMessage) {
      logger.info(`\nAppend Message:\n${result.appendMessage}`);
    }

    if (result.answer) {
      logger.info(`\nFinal Answer:\n${result.answer.substring(0, 200)}...`);
    }

    logger.info("\n" + "=".repeat(60));

    if (result.interestScore >= 7) {
      logger.info("✓ SUCCESS: Interest score is high enough to trigger contact collection!");
    } else {
      logger.error("✗ FAILED: Interest score too low. Expected >= 7, got " + result.interestScore);
    }

  } catch (error: any) {
    logger.error("Test failed:", error);
    throw error;
  }
}

// Run the test
testInterestEvaluator().catch((error) => {
  logger.error("Unhandled error:", error);
  process.exit(1);
});
