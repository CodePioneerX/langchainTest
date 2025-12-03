# Deploying to LangGraph Platform

This guide shows you how to deploy your Telegram bot to LangGraph Platform (LangSmith).

## Architecture

```
Telegram User → Telegram Bot API → Your Webhook Server → LangGraph Platform API
                                                              ↓
                                                         PostgreSQL (Checkpointer)
                                                              ↓
                                                         Chroma (Vector Store)
```

## Prerequisites

1. **LangSmith Account**: Sign up at https://smith.langchain.com
2. **PostgreSQL Database**: For conversation memory (checkpointer)
3. **Chroma Server**: For vector storage (can be local or Chroma Cloud)
4. **Telegram Bot Token**: From @BotFather

## Step 1: Install LangGraph CLI

```bash
npm install -g @langchain/langgraph-cli
```

## Step 2: Test Locally

Test your graph deployment locally before deploying to the platform:

```bash
# Start local LangGraph server
langgraph dev

# Your graph will be available at:
# http://localhost:8123
```

Test the API:

```bash
curl -X POST http://localhost:8123/bot_workflow/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "messages": [{"role": "user", "content": "What is Botpress?"}]
    },
    "config": {
      "configurable": {
        "thread_id": "test_123"
      }
    }
  }'
```

## Step 3: Deploy to LangGraph Platform

### Login to LangSmith

```bash
langgraph auth login
```

### Deploy your graph

```bash
langgraph deploy --name telegram-bot-prod
```

This will:
- Build your graph
- Deploy to LangGraph Platform
- Return a deployment URL like: `https://your-deployment.langsmith.com`

### Set Environment Variables

In the LangSmith dashboard, set these environment variables for your deployment:

```env
OPENAI_API_KEY=your_openai_key
DATABASE_URL=postgresql://user:pass@host:5432/db
CHROMA_URL=http://your-chroma-server:8000
TOP_K_RESULTS=5
LLM_MODEL=gpt-4o
LLM_TEMPERATURE=0.7
EMBEDDING_MODEL=text-embedding-3-small
```

## Step 4: Create Webhook Server

Your Telegram bot needs a webhook server to connect to LangGraph Platform.

Create `webhook-server.ts`:

```typescript
import express from 'express';
import { Telegraf } from 'telegraf';
import { RemoteGraph } from "@langchain/langgraph/remote";

const app = express();
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

// Connect to deployed LangGraph
const remoteGraph = new RemoteGraph({
  graphId: "bot_workflow",
  url: process.env.LANGGRAPH_API_URL!, // From LangSmith dashboard
  apiKey: process.env.LANGSMITH_API_KEY!,
});

// Handle text messages
bot.on('text', async (ctx) => {
  const userId = ctx.from.id.toString();

  try {
    // Invoke the deployed graph
    const result = await remoteGraph.invoke(
      {
        messages: [{ role: "user", content: ctx.message.text }]
      },
      {
        configurable: { thread_id: userId }
      }
    );

    await ctx.reply(result.answer);
  } catch (error) {
    console.error("Error:", error);
    await ctx.reply("Sorry, I encountered an error. Please try again.");
  }
});

// Webhook endpoint
app.use(bot.webhookCallback('/webhook'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Webhook server running on port ${PORT}`);

  // Set Telegram webhook
  bot.telegram.setWebhook(`${process.env.WEBHOOK_URL}/webhook`);
});
```

Install dependencies:

```bash
npm install @langchain/langgraph
```

Create `.env` for webhook server:

```env
TELEGRAM_BOT_TOKEN=your_bot_token
LANGGRAPH_API_URL=https://your-deployment.langsmith.com
LANGSMITH_API_KEY=your_langsmith_api_key
WEBHOOK_URL=https://your-webhook-server.com
```

## Step 5: Deploy Webhook Server

Deploy your webhook server to any hosting platform:

### Option A: Railway

```bash
# Install Railway CLI
npm install -g railway

# Login
railway login

# Create project
railway init

# Deploy
railway up
```

### Option B: Render

1. Create a new Web Service on Render
2. Connect your GitHub repo
3. Build Command: `npm install`
4. Start Command: `node dist/webhook-server.js`
5. Add environment variables in Render dashboard

### Option C: Fly.io

```bash
# Install flyctl
brew install flyctl

# Login
fly auth login

# Launch app
fly launch

# Deploy
fly deploy
```

## Step 6: Set Telegram Webhook

Once your webhook server is deployed:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-webhook-server.com/webhook"}'
```

Verify webhook:

```bash
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo"
```

## Testing

1. Open Telegram and message your bot
2. Check LangSmith dashboard for traces and logs
3. Check webhook server logs for any errors

## Monitoring

View traces and debugging info in LangSmith dashboard:
- https://smith.langchain.com

Each conversation will have:
- Full message history
- Retrieval results
- LLM responses
- Execution time
- Errors (if any)

## Troubleshooting

### Webhook not receiving messages

```bash
# Check webhook status
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo"

# Delete webhook and set again
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/deleteWebhook"
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -d "url=https://your-webhook-server.com/webhook"
```

### Graph not found

Verify your deployment:

```bash
langgraph list
```

### Database connection errors

Check your DATABASE_URL in LangSmith dashboard environment variables.

## Cost Considerations

- **LangGraph Platform**: Charged per request
- **PostgreSQL**: Database hosting costs
- **Chroma**: Local (free) or Cloud (paid)
- **OpenAI API**: Charged per token
- **Webhook Server**: Hosting costs (Railway/Render free tiers available)

## Alternative: Run Locally (No Platform)

If you prefer not to use LangGraph Platform, just run the bot directly:

```bash
npm run bot
```

This uses your local setup:
- Direct Telegram polling (no webhooks)
- PostgreSQL for checkpointing
- Chroma for vectors
- All processing happens locally

## Summary

**With LangGraph Platform:**
- ✅ Scalable and managed
- ✅ Built-in monitoring via LangSmith
- ✅ Automatic retries and error handling
- ❌ Requires webhook server
- ❌ Additional costs

**Without LangGraph Platform (Local):**
- ✅ Simpler setup
- ✅ Lower costs
- ✅ Direct Telegram polling
- ❌ No built-in monitoring
- ❌ Need to manage scaling yourself

Choose based on your needs!
