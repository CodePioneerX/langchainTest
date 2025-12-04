/**
 * Telegram Custom Routes for LangGraph Platform
 *
 * These routes are deployed WITHIN your LangGraph deployment
 * using the custom routes feature (langgraph.json → http.app)
 *
 * No separate server needed - everything is in the LangGraph ecosystem!
 */

import { Hono } from "hono";
import { Client } from "@langchain/langgraph-sdk";

const app = new Hono();

// In-memory user→thread mapping (use environment storage or Redis in production)
const userThreads = new Map<number, string>();

/**
 * Health check endpoint
 */
app.get("/health", (c) => {
  return c.json({ status: "ok", service: "telegram-integration" });
});

/**
 * Telegram webhook endpoint
 * This is where Telegram sends updates
 */
app.post("/telegram/webhook", async (c) => {
  try {
    const update = await c.req.json();

    // Extract message from Telegram update
    const message = update.message;
    if (!message?.text) {
      return c.json({ ok: true });
    }

    const userId = message.from.id;
    const chatId = message.chat.id;
    const messageText = message.text;

    console.log(`[Telegram User ${userId}] ${messageText}`);

    // Get or create thread for this user
    let threadId = userThreads.get(userId);
    if (!threadId) {
      const client = new Client();
      const thread = await client.threads.create();
      threadId = thread.thread_id;
      userThreads.set(userId, threadId);
      console.log(`Created thread ${threadId} for user ${userId}`);
    }

    // Trigger LangGraph agent run (fire-and-forget)
    const client = new Client();

    // Start async processing
    (async () => {
      try {
        const stream = client.runs.stream(
          threadId,
          "bot_workflow",
          {
            input: {
              messages: [{ role: "user", content: messageText }],
            },
            streamMode: "values",
          }
        );

        // Process streaming response
        let aiResponse = "";
        for await (const chunk of stream) {
          const data = chunk.data as any;
          if (data?.messages && Array.isArray(data.messages)) {
            const lastMsg = data.messages[data.messages.length - 1];
            if (lastMsg?.type === "ai" || lastMsg?.role === "assistant") {
              aiResponse = lastMsg.content || "";
            }
          }
        }

        // Send response back to Telegram
        if (aiResponse) {
          await sendTelegramMessage(chatId, aiResponse);
        }
      } catch (error: any) {
        console.error("Error invoking agent:", error);
        await sendTelegramMessage(chatId, "Sorry, I encountered an error processing your request.");
      }
    })();

    // Respond immediately to Telegram (required within 60 seconds)
    return c.json({ ok: true });

  } catch (error: any) {
    console.error("Webhook error:", error);
    return c.json({ ok: false, error: error.message }, 500);
  }
});

/**
 * Send message to Telegram user via Bot API
 */
async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error("TELEGRAM_BOT_TOKEN not configured");
    return;
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  console.log(`Sending message to chat ${chatId}`);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: "Markdown",
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("Telegram API error:", error);
    } else {
      console.log("Message sent successfully");
    }
  } catch (error) {
    console.error("Failed to send Telegram message:", error);
  }
}

// Export the app for LangGraph Platform
export { app };
