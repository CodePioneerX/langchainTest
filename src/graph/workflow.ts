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

  // Interest Evaluator node - analyzes conversation to score lead quality
  const interestEvaluatorNode = async (state: GraphStateType): Promise<Partial<GraphStateType>> => {
    logger.debug("Interest Evaluator node: Analyzing lead interest");

    try {
      // Skip evaluation if we're currently collecting contact info
      if (state.collectingContact) {
        logger.debug("Skipping evaluation - currently collecting contact");
        return {};
      }

      // Need at least 2 messages (1 user, 1 AI) to evaluate
      if (state.messages.length < 3) {
        logger.debug(`Not enough messages to evaluate (${state.messages.length})`);
        return { interestScore: 0 };
      }

      // Use LLM to analyze conversation and score interest
      const conversationText = state.messages
        .slice(-6) // Last 6 messages (3 exchanges)
        .map((msg) => `${msg._getType()}: ${msg.content}`)
        .join("\n");

      logger.debug(`Evaluating conversation:\n${conversationText}`);

      const evaluationPrompt = `You are a lead qualification expert for Botpress, a chatbot platform.

Analyze this conversation and score the user's interest level from 0-10:

Conversation:
${conversationText}

Scoring criteria:
- 0-3: Just browsing, casual questions, no clear use case
- 4-6: Showing some interest, asking specific questions, has a potential use case
- 7-8: Strong interest, asking detailed implementation questions, discussing business needs
- 9-10: Very high interest, saying they want to sign up, asking about pricing/enterprise features, ready to buy

Key signals for high scores (9-10):
- User says "I want to sign up" or "definitely like to sign up"
- User asks "What would the pricing be?" or "How much does it cost?"
- User discusses their business needs and company scale
- User asks about implementation timelines

Respond with ONLY a JSON object in this exact format:
{"score": <number 0-10>, "reason": "<brief explanation>"}`;

      const evaluation = await llm.invoke(evaluationPrompt);
      const content = evaluation.content.toString();

      logger.debug(`LLM evaluation response: ${content}`);

      // Extract JSON from response (more robust pattern)
      const jsonMatch = content.match(/\{[\s\S]*?"score"[\s\S]*?\}/);
      if (!jsonMatch) {
        logger.error(`Failed to parse JSON from LLM response: ${content}`);
        return { interestScore: 0 };
      }

      const result = JSON.parse(jsonMatch[0]);
      const score = Math.max(0, Math.min(10, result.score)); // Clamp to 0-10

      logger.info(`✓ Interest score: ${score}/10 - ${result.reason}`);

      return { interestScore: score };
    } catch (error: any) {
      logger.error("Error in interest evaluator node:", error);
      logger.error("Stack trace:", error.stack);
      return { interestScore: 0 };
    }
  };

  // Contact Collector node - asks for contact info from high-interest leads
  const contactCollectorNode = async (state: GraphStateType): Promise<Partial<GraphStateType>> => {
    logger.debug("Contact Collector node: Collecting lead information");

    try {
      // Find the last user message (not AI message)
      const lastUserMessage = state.messages
        .slice()
        .reverse()
        .find(msg => msg._getType() === "human")
        ?.content.toString() || "";

      logger.debug(`Checking message for contact info: ${lastUserMessage.substring(0, 100)}`);

      // Parse contact info from user's message
      const emailRegex = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/i;
      const emailMatch = lastUserMessage.match(emailRegex);

      if (emailMatch) {
        // Extract name and company if available
        const nameMatch = lastUserMessage.match(/(?:my name is|i'm|i am|name[:\s]+)([a-z\s]+)/i);
        const companyMatch = lastUserMessage.match(/(?:from|at|work at|company|for)[:\s]+([a-z0-9\s&.,'-]+?)(?:\s+and|\s+my|\s*$)/i);

        const contactInfo = {
          email: emailMatch[0],
          name: nameMatch ? nameMatch[1].trim() : undefined,
          company: companyMatch ? companyMatch[1].trim() : undefined,
          collected: true,
        };

        logger.info(`✅ Collected contact info: ${JSON.stringify(contactInfo)}`);

        const thankYouMessage = `\n\n---\n\nThank you${contactInfo.name ? ` ${contactInfo.name}` : ''}! I've noted your contact information. Our team will reach out to you shortly to discuss how Botpress can help with your chatbot needs.`;

        return {
          contactInfo,
          collectingContact: false,
          appendMessage: thankYouMessage,
        };
      }

      // If no email found, ask for contact info
      if (!state.collectingContact) {
        const requestMessage = `\n\n---\n\nI can see you're interested in Botpress! I'd love to connect you with our team to discuss your specific needs. Could you share your email address${state.messages.some(m => m.content.toString().includes('company') || m.content.toString().includes('business')) ? ' and company name' : ''}?`;

        return {
          collectingContact: true,
          appendMessage: requestMessage,
        };
      }

      return {};
    } catch (error: any) {
      logger.error("Error in contact collector node:", error);
      return { collectingContact: false };
    }
  };

  // Slack Notifier node - sends lead info to Slack channel
  const slackNotifierNode = async (state: GraphStateType): Promise<Partial<GraphStateType>> => {
    logger.debug("Slack Notifier node: Sending lead notification");

    try {
      if (!state.contactInfo.collected) {
        return {};
      }

      const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
      if (!slackWebhookUrl) {
        logger.error("SLACK_WEBHOOK_URL not configured");
        return {};
      }

      const { name, email, company } = state.contactInfo;

      const slackMessage = {
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: "🎯 New Qualified Lead from Botpress Bot",
              emoji: true,
            },
          },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Name:*\n${name || 'Not provided'}` },
              { type: "mrkdwn", text: `*Email:*\n${email}` },
              { type: "mrkdwn", text: `*Company:*\n${company || 'Not provided'}` },
              { type: "mrkdwn", text: `*Interest Score:*\n${state.interestScore}/10` },
            ],
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `Captured at: ${new Date().toLocaleString()}`,
              },
            ],
          },
        ],
      };

      const response = await fetch(slackWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(slackMessage),
      });

      if (!response.ok) {
        logger.error(`Slack notification failed: ${response.statusText}`);
      } else {
        logger.info("Lead notification sent to Slack successfully");
      }

      return {};
    } catch (error: any) {
      logger.error("Error in Slack notifier node:", error);
      return {};
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

      // Check if we need to append a message (e.g., contact request)
      let finalAnswer = answer;
      if (state.appendMessage) {
        finalAnswer = `${answer}\n\n${state.appendMessage}`;
        logger.debug(`Appended message to response`);
      }

      // Only add AI response message (user message already in state.messages)
      return {
        answer: finalAnswer,
        messages: [new AIMessage(finalAnswer)],
        appendMessage: "", // Clear append message after using it
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

  // Conditional routing function - decides if we should collect contact info
  const shouldCollectContact = (state: GraphStateType): string => {
    // If already collecting or collected, route to contact collector
    if (state.collectingContact || state.contactInfo.collected) {
      return "contact_collector";
    }

    // If interest score is high enough (7+), initiate contact collection
    if (state.interestScore >= 7) {
      return "contact_collector";
    }

    // Otherwise, go straight to generator (normal flow)
    return "generator";
  };

  // Conditional routing after contact collection
  const afterContactCollection = (state: GraphStateType): string => {
    // If contact info was collected, send to Slack
    if (state.contactInfo.collected) {
      return "slack_notifier";
    }

    // If still collecting, end here (will continue on next message)
    return "__end__";
  };

  // Build and return graph (NOT compiled - caller compiles with checkpointer)
  const workflow = new StateGraph(GraphState)
    .addNode("retriever", retrieverNode)
    .addNode("generator", generatorNode)
    .addNode("interest_evaluator", interestEvaluatorNode)
    .addNode("contact_collector", contactCollectorNode)
    .addNode("slack_notifier", slackNotifierNode)
    .addEdge("__start__", "retriever")
    .addEdge("retriever", "interest_evaluator")
    .addConditionalEdges("interest_evaluator", shouldCollectContact, {
      contact_collector: "contact_collector",
      generator: "generator",
    })
    .addEdge("contact_collector", "generator")
    .addConditionalEdges("generator", afterContactCollection, {
      slack_notifier: "slack_notifier",
      __end__: "__end__",
    })
    .addEdge("slack_notifier", "__end__");

  logger.info("✓ Workflow created with lead qualification (ready for compilation with checkpointer)");

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
