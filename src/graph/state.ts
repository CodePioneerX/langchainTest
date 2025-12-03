import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
import { Document } from "@langchain/core/documents";

/**
 * Define the state for the LangGraph workflow
 * Following official LangGraph patterns: store raw data, format in nodes
 */
export const GraphState = Annotation.Root({
  // Conversation messages (accumulated)
  messages: Annotation<BaseMessage[]>({
    reducer: (current, update) => current.concat(update),
    default: () => [],
  }),

  // Raw retrieved documents (NOT formatted context)
  // Format these into context strings inside the generator node
  retrievedDocs: Annotation<Document[]>({
    reducer: (_, update) => update,
    default: () => [],
  }),

  // Final generated answer
  answer: Annotation<string>({
    reducer: (_, update) => update,
    default: () => "",
  }),

  // Error tracking for debugging and potential retry logic
  errors: Annotation<string[]>({
    reducer: (current, update) => current.concat(update),
    default: () => [],
  }),
});

export type GraphStateType = typeof GraphState.State;
