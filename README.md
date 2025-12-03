# Botpress FAQ Bot with LangGraph

A streamlined RAG (Retrieval-Augmented Generation) based FAQ bot built with LangGraph that answers questions about Botpress documentation. Features stateful conversations, PostgreSQL vector storage, and Telegram integration.

## Features

- **Simple RAG Pipeline**: Clean linear workflow: Retrieve → Generate
- **Stateful Conversations**: Maintains context across multiple messages
- **Production-Ready**:
  - Rate limiting for scraping and embeddings
  - Retry logic with exponential backoff
  - Enhanced metadata (section titles, page sections)
  - Structured logging with Winston
  - Token-based message truncation
- **Vector Storage**: PostgreSQL with pgvector for similarity search
- **Telegram Bot**: Interactive FAQ bot with commands

## Architecture

### LangGraph Workflow

```
START → [Retriever] → [Generator] → END
```

- **Retriever Node**: Performs similarity search against vector database for every query
- **Generator Node**: GPT-4o generates responses with retrieved context and conversation history
  - Handles all query types (questions, greetings, off-topic) intelligently in one unified prompt

### Tech Stack

- **LangChain/LangGraph**: Workflow orchestration
- **OpenAI**: GPT-4o for generation, text-embedding-3-small for embeddings
- **PostgreSQL + pgvector**: Vector database for semantic search
- **Telegraf**: Telegram bot framework
- **TypeScript**: Type-safe implementation
- **Winston**: Structured logging

## Prerequisites

### 1. Node.js
```bash
node --version  # Should be v18 or higher
```

### 2. PostgreSQL with pgvector

#### macOS (Homebrew)
```bash
brew install postgresql@15 pgvector
brew services start postgresql@15
createdb botpress_faq
```

#### Linux (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo apt install git build-essential postgresql-server-dev-15

# Install pgvector
cd /tmp
git clone https://github.com/pgvector/pgvector.git
cd pgvector
make
sudo make install

# Start PostgreSQL
sudo systemctl start postgresql

# Create database
sudo -u postgres createdb botpress_faq
```

#### Enable Extensions
```bash
psql botpress_faq -c "CREATE EXTENSION vector;"
psql botpress_faq -c "CREATE EXTENSION \"uuid-ossp\";"
```

### 3. API Keys

- **OpenAI API Key**: Get from https://platform.openai.com/api-keys
- **Telegram Bot Token**: Get from @BotFather on Telegram

## Installation

### 1. Install Dependencies
```bash
npm install --legacy-peer-deps
```

### 2. Configure Environment Variables
```bash
cp .env.example .env
```

Edit `.env` with just **3 required variables**:
```bash
# Get from: https://platform.openai.com/api-keys
OPENAI_API_KEY=sk-your-key-here

# PostgreSQL connection (adjust password/database name as needed)
DATABASE_URL=postgresql://postgres:password@localhost:5432/botpress_faq

# Get from: @BotFather on Telegram
TELEGRAM_BOT_TOKEN=your-bot-token-here
```

**That's it!** All other settings (chunk size, embeddings model, etc.) use sensible defaults. Override only if needed.

### 3. Initialize Database
```bash
npm run setup-db
```

This creates:
- `documents` table with content hash for deduplication
- `document_chunks` table with vector embeddings
- `conversations` table for Telegram chats
- `messages` table for conversation history

## Usage

### Step 1: Index Botpress Documentation

```bash
npm run index
```

This will:
1. Discover URLs from https://botpress.com/docs
2. Scrape pages (with rate limiting and deduplication)
3. Split content into 1000-character chunks
4. Generate OpenAI embeddings
5. Store in PostgreSQL vector database

**Expected duration**: 30-60 minutes for ~100-500 pages

**Watch for**:
- "Rate limited, waiting 60s..." - Normal, retry logic working
- "Duplicate content skipped" - Deduplication working
- "Processed X/Y embeddings" - Progress tracking

### Step 2: Test the Workflow

```bash
npm run test:workflow
```

Tests the LangGraph workflow with sample questions:
- "How do I create a chatbot in Botpress?"
- "What integrations does Botpress support?"
- "Hello!"
- "Thanks for your help"
- "What's the weather like?"

Verify that:
- Questions retrieve relevant context
- Greetings skip retrieval
- Off-topic queries are handled politely

### Step 3: Start the Telegram Bot

```bash
npm run telegram
```

The bot will start and log:
```
✅ Bot started successfully!
Bot username: @your_bot_name
```

### Step 4: Interact via Telegram

Open Telegram and search for your bot. Available commands:

- `/start` - Initialize conversation
- `/help` - Show usage instructions
- `/stats` - View conversation statistics
- `/reset` - Clear conversation history

Ask questions like:
- "How do I create a bot?"
- "What integrations are available?"
- "How do I deploy to production?"

## Project Structure

```
langgraphDemo-v2/
├── src/
│   ├── bot/
│   │   ├── telegram.ts          # Telegram bot main
│   │   └── session-manager.ts   # Conversation persistence
│   ├── config/
│   │   └── env.ts               # Environment validation
│   ├── database/
│   │   ├── client.ts            # PostgreSQL connection pool
│   │   └── vector-store.ts      # PGVectorStore wrapper
│   ├── graph/
│   │   ├── state.ts             # LangGraph state definition
│   │   ├── workflow.ts          # Workflow orchestration
│   │   └── nodes/
│   │       ├── router.ts        # Query classification
│   │       ├── retriever.ts     # Similarity search
│   │       └── generator.ts     # Response generation
│   ├── services/
│   │   ├── scraper.ts           # Web scraping with rate limiting
│   │   ├── chunker.ts           # Text splitting with metadata
│   │   └── embeddings.ts        # Embedding generation with retry
│   ├── utils/
│   │   ├── logger.ts            # Winston structured logging
│   │   └── message-truncator.ts # Token management
│   └── types/
│       └── index.ts             # TypeScript type definitions
├── scripts/
│   ├── setup-db.ts              # Database initialization
│   ├── index-botpress.ts        # Scraping and indexing pipeline
│   ├── reindex-botpress.ts      # Clean re-indexing
│   └── test-workflow.ts         # Workflow testing
└── logs/                        # Application logs
```

## NPM Scripts

- `npm run build` - Compile TypeScript
- `npm run setup-db` - Initialize database schema
- `npm run index` - Index Botpress documentation
- `npm run test:workflow` - Test LangGraph workflow
- `npm run telegram` - Start Telegram bot

**To re-index**: Just run `npm run index` again - it updates existing URLs automatically.

## Troubleshooting

### Database Connection Errors

**Error**: `connection refused`
```bash
# Check if PostgreSQL is running
brew services list  # macOS
sudo systemctl status postgresql  # Linux

# Verify connection
psql -U postgres -d botpress_faq
```

### pgvector Extension Not Found

**Error**: `extension "vector" is not available`
```bash
# Reinstall pgvector
brew reinstall pgvector  # macOS

# Or on Linux:
cd /tmp/pgvector
sudo make install
```

### Rate Limiting During Indexing

**Symptom**: Many "Rate limited, waiting 60s..." messages

**Solution**: This is normal. The system will automatically retry. If persistent:
1. Reduce `CONCURRENT_SCRAPE_REQUESTS` in `.env`
2. Increase `SCRAPE_DELAY_MS`

### Embedding Generation Fails

**Error**: 429 errors from OpenAI

**Solution**:
1. Check your OpenAI account has sufficient credits
2. The system automatically retries with exponential backoff
3. If persistent, increase delays in `src/services/embeddings.ts`

### Telegram Bot Not Responding

1. Verify bot token: `echo $TELEGRAM_BOT_TOKEN`
2. Check bot is running: Look for "Bot started successfully" in logs
3. Ensure database is accessible
4. Check logs: `tail -f logs/combined.log`

## Advanced Configuration (Optional)

All settings have sensible defaults. Override in `.env` only if needed:

### RAG Parameters
```bash
CHUNK_SIZE=1000          # Default: 1000 (characters per chunk)
CHUNK_OVERLAP=200        # Default: 200 (overlap between chunks)
TOP_K_RESULTS=5          # Default: 5 (documents to retrieve)
LLM_MODEL=gpt-4o         # Default: gpt-4o (or use gpt-3.5-turbo)
EMBEDDING_MODEL=text-embedding-3-small  # Default
```

### Scraping Parameters
```bash
MAX_SCRAPE_DEPTH=3              # Default: 3 (URL discovery depth)
MAX_PAGES=500                   # Default: 500 (max pages to index)
SCRAPE_DELAY_MS=1000            # Default: 1000 (ms between requests)
CONCURRENT_SCRAPE_REQUESTS=3    # Default: 3 (parallel requests)
MAX_RETRIES=3                   # Default: 3 (retry attempts)
```

### Logging
```bash
LOG_LEVEL=info           # Default: info (error, warn, info, debug)
NODE_ENV=development     # Default: development
```

## Production Deployment

### Environment Variables

Set these in your production environment:
- `NODE_ENV=production`
- `LOG_LEVEL=warn` (reduce log verbosity)
- All API keys and database credentials

### Database

- Enable connection pooling
- Set up read replicas for high load
- Regular backups of PostgreSQL

### Monitoring

Logs are written to:
- `logs/error.log` - Errors only
- `logs/combined.log` - All logs

Monitor for:
- Rate limit warnings
- Embedding generation failures
- Database connection issues
- Telegram API errors

### Scaling Considerations

- Use Redis for conversation cache (replace in-memory Map)
- Implement request queuing for high load
- Consider read replicas for database
- Cache frequent queries/embeddings

## Development

### Adding New Document Sources

Edit `scripts/index-botpress.ts`:
```typescript
const SEED_URLS = [
  "https://botpress.com/docs",
  "https://your-new-source.com/docs",  // Add here
];
```

### Customizing the System Prompt

Edit the unified system prompt in `src/graph/nodes/generator.ts` to change how the bot responds to all query types.

### Adding New Telegram Commands

Edit `src/bot/telegram.ts` and add:
```typescript
bot.command("yourcommand", async (ctx) => {
  // Your logic here
});
```

## Simplified Design Decisions

This implementation prioritizes **simplicity and clarity** over complex optimizations:

1. **No Query Router**: Every query goes through retrieval, even greetings. The generator handles all cases intelligently.
   - **Pro**: Simpler workflow, one less LLM call, faster responses
   - **Con**: Slightly higher embedding costs (~$0.0001/query)

2. **No Content Hash**: URL uniqueness prevents duplicates. Same content at different URLs will be indexed separately.
   - **Pro**: Simpler database schema, less code
   - **Con**: Potential duplicate content if same docs appear at multiple URLs

3. **Direct Logger Usage**: No helper functions, just call `logger.info()` directly
   - **Pro**: Less abstraction, easier to understand
   - **Con**: Slightly more verbose logging calls

**When to add complexity back**:
- If processing 10K+ messages/day, add query routing to save on embeddings
- If indexing 1000+ pages with lots of duplicates, add content hashing
- If logs become messy, add structured logging helpers

## License

ISC

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## Support

For issues and questions:
- Check logs in `logs/` directory
- Review this README's Troubleshooting section
- Open an issue on GitHub

## Credits

Built with:
- [LangChain](https://langchain.com/)
- [LangGraph](https://github.com/langchain-ai/langgraph)
- [OpenAI](https://openai.com/)
- [PostgreSQL](https://www.postgresql.org/)
- [pgvector](https://github.com/pgvector/pgvector)
- [Telegraf](https://telegraf.js.org/)

---

**Happy Bot Building!** 🤖
