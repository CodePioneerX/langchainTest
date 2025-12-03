import "dotenv/config";
import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { createWorkflow } from "../graph/workflow.js";
import { getRetriever } from "../database/vector-store.js";
import { logger } from "../utils/logger.js";

/**
 * Initialize bot with dependencies using closure pattern
 * This follows official LangGraph patterns for dependency injection
 */
async function initializeBot() {
  logger.info("🤖 Initializing Telegram bot...");

  // Initialize retriever from Chroma vector store
  logger.info("Initializing Chroma retriever...");
  const retriever = await getRetriever(parseInt(process.env.TOP_K_RESULTS || "5", 10));
  logger.info("✓ Chroma retriever initialized");

  // Initialize LLM
  const llm = new ChatOpenAI({
    modelName: process.env.LLM_MODEL || "gpt-4o",
    temperature: parseFloat(process.env.LLM_TEMPERATURE || "0.7"),
    openAIApiKey: process.env.OPENAI_API_KEY,
    maxRetries: 3,
  });

  logger.info("✓ LLM initialized");

  // Initialize PostgreSQL checkpointer for persistent conversation memory
  logger.info("Initializing PostgreSQL checkpointer...");
  const checkpointer = PostgresSaver.fromConnString(process.env.DATABASE_URL!);
  await checkpointer.setup();
  logger.info("✓ PostgreSQL checkpointer initialized");

  // Create workflow with dependencies via closure
  const graph = createWorkflow(retriever, llm);
  const workflow = graph.compile({ checkpointer });

  logger.info("✓ Workflow compiled with PostgreSQL checkpointer");

  // Initialize Telegram bot
  const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

  /**
   * /start command handler
   */
  bot.command("start", async (ctx) => {
    logger.info(`/start command from user ${ctx.from.id}`);

    await ctx.reply(
      `👋 Welcome to the Botpress FAQ Bot!

I'm here to help you with questions about Botpress, a powerful chatbot building platform.

**What I can do:**
• Answer questions about Botpress features
• Help with documentation and guides
• Explain integrations and APIs
• Provide troubleshooting assistance

**Commands:**
/help - Show this message
/reset - Clear conversation history
/stats - Show conversation statistics

Go ahead, ask me anything about Botpress!`
    );
  });

  /**
   * /help command handler
   */
  bot.command("help", async (ctx) => {
    logger.info(`/help command from user ${ctx.from.id}`);

    await ctx.reply(
      `💡 **How to use this bot:**

Simply type your question about Botpress, and I'll search through the official documentation to find the answer.

**Example questions:**
• How do I create a chatbot in Botpress?
• What integrations does Botpress support?
• How do I deploy my bot to production?
• What is the Botpress API?

**Commands:**
/start - Start the bot
/reset - Clear conversation history
/stats - Show your conversation statistics

**Tips:**
• I remember our conversation, so feel free to ask follow-up questions
• The more specific your question, the better I can help
• I can only answer questions about Botpress

Need help? Visit https://botpress.com/docs`
    );
  });

  /**
   * /reset command handler - Clear checkpointer state for thread
   */
  bot.command("reset", async (ctx) => {
    const threadId = ctx.chat.id.toString();
    logger.info(`/reset command from user ${ctx.from.id} (thread: ${threadId})`);

    try {
      // Delete checkpoint data for this thread
      if ("delete" in checkpointer && typeof checkpointer.delete === "function") {
        await (checkpointer as any).delete({ configurable: { thread_id: threadId } });
        logger.info(`✓ Cleared checkpoints for thread ${threadId}`);
        await ctx.reply("✅ Conversation history cleared! Let's start fresh.");
      } else {
        logger.warn("Checkpointer.delete method not available");
        await ctx.reply("⚠️ Clear history feature not available.");
      }
    } catch (error: any) {
      logger.error("Error in /reset command:", error);
      await ctx.reply("❌ Error clearing history. Please try again.");
    }
  });

  /**
   * /stats command handler - Get thread history stats from checkpointer
   */
  bot.command("stats", async (ctx) => {
    const threadId = ctx.chat.id.toString();
    logger.info(`/stats command from user ${ctx.from.id} (thread: ${threadId})`);

    try {
      // Get checkpoint history for this thread
      const checkpoints = [];

      if ("list" in checkpointer && typeof checkpointer.list === "function") {
        for await (const checkpoint of (checkpointer as any).list(
          { configurable: { thread_id: threadId } },
          { limit: 1000 }
        )) {
          checkpoints.push(checkpoint);
        }

        // Count messages from the most recent checkpoint
        let messageCount = 0;
        if (checkpoints.length > 0) {
          const latestCheckpoint = checkpoints[0];
          const channelValues = latestCheckpoint.checkpoint?.channel_values as any;
          messageCount = channelValues?.messages?.length || 0;
        }

        await ctx.reply(
          `📊 **Your Conversation Statistics:**

Thread ID: ${threadId}
Total checkpoints: ${checkpoints.length}
Messages in history: ${messageCount}
Last update: ${checkpoints.length > 0 ? new Date((checkpoints[0].metadata as any)?.ts || Date.now()).toLocaleString() : "N/A"}

A checkpoint is saved after each message exchange.
Use /reset to clear all conversation history.

💾 Note: History is persisted in PostgreSQL and survives bot restarts.`
        );
      } else {
        await ctx.reply("⚠️ Statistics feature not available.");
      }
    } catch (error: any) {
      logger.error("Error in /stats command:", error);
      await ctx.reply("❌ Error fetching statistics. Please try again.");
    }
  });

  /**
   * Text message handler - Uses thread_id for conversation memory
   */
  bot.on(message("text"), async (ctx) => {
    const userMessage = ctx.message.text;
    const threadId = ctx.chat.id.toString();

    logger.info(
      `Message from user ${ctx.from.id} (thread: ${threadId}): ${userMessage.substring(0, 50)}...`
    );

    // Ignore if message is a command (already handled)
    if (userMessage.startsWith("/")) {
      return;
    }

    try {
      // Show typing indicator
      await ctx.sendChatAction("typing");

      // Invoke workflow with thread_id
      // Checkpointer automatically:
      // 1. Loads previous state for this thread_id
      // 2. Appends new message to messages history
      // 3. Executes the graph
      // 4. Saves updated state back to DB
      logger.debug(`Invoking workflow with thread_id: ${threadId}`);

      const result = await workflow.invoke(
        {
          messages: [new HumanMessage(userMessage)],
        },
        {
          configurable: {
            thread_id: threadId, // KEY: Checkpointer uses this for state persistence
          },
        }
      );

      // Send response (split if too long for Telegram's 4096 char limit)
      if (result.answer.length > 4000) {
        const chunks = result.answer.match(/.{1,4000}/gs) || [];
        for (const chunk of chunks) {
          await ctx.reply(chunk, { parse_mode: "Markdown" });
        }
      } else {
        await ctx.reply(result.answer, { parse_mode: "Markdown" });
      }

      logger.info(`✓ Response sent to user ${ctx.from.id}`);
    } catch (error: any) {
      logger.error("Error processing message:", error);
      await ctx.reply(
        "❌ Sorry, I encountered an error processing your request. Please try again.\n\nIf the problem persists, try /reset to start fresh."
      );
    }
  });

  /**
   * Error handling
   */
  bot.catch((err: any, ctx: any) => {
    logger.error(`Telegram bot error for ${ctx.updateType}:`, err);
    ctx.reply("❌ An unexpected error occurred. Please try again.");
  });

  /**
   * Start the bot
   */
  logger.info("🤖 Starting Telegram bot with LangGraph checkpointer...");
  bot.launch();

  logger.info("✅ Bot started successfully!");

  /**
   * Graceful shutdown
   */
  process.once("SIGINT", async () => {
    logger.info("SIGINT received, shutting down gracefully...");
    bot.stop("SIGINT");
    process.exit(0);
  });

  process.once("SIGTERM", async () => {
    logger.info("SIGTERM received, shutting down gracefully...");
    bot.stop("SIGTERM");
    process.exit(0);
  });
}

// Initialize and start the bot
initializeBot().catch((error) => {
  logger.error("Failed to initialize bot:", error);
  process.exit(1);
});
