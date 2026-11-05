import { searchService, SearchResultPassage } from '../search/search.service';
import { geminiLlmService } from '../../common/services/geminiLlm.service';
import { env } from '../../config/env';
import { logger } from '../../common/utils/logger';
import {
  buildRagPrompt,
  RAG_SYSTEM_INSTRUCTION,
} from './rag.prompt';
import { RagAskQuestionInput } from './rag.schema';

export interface RagSourceCitation {
  id: string;
  documentId: string;
  workspaceId: string;
  originalName: string;
  chunkIndex: number;
  score: number;
  textSnippet: string;
}

export interface RagAnswerResponse {
  question: string;
  answer: string;
  isGrounded: boolean;
  sources: RagSourceCitation[];
  metadata: {
    model: string;
    engineUsed: string;
    chunksRetrieved: number;
    chunksUsed: number;
    thresholdApplied: number;
    usage?: {
      promptTokens?: number;
      responseTokens?: number;
      totalTokens?: number;
    };
  };
}

export class RagService {
  private formatCitations(passages: SearchResultPassage[]): RagSourceCitation[] {
    return passages.map((p) => ({
      id: p.id,
      documentId: p.documentId,
      workspaceId: p.workspaceId,
      originalName: p.metadata.originalName,
      chunkIndex: p.chunkIndex,
      score: p.score,
      textSnippet: p.text.length > 200 ? `${p.text.slice(0, 200)}...` : p.text,
    }));
  }

  /**
   * Core RAG pipeline:
   * Retrieves relevant chunks -> checks grounding -> builds safe prompt -> invokes Gemini LLM -> formats citations.
   */
  private async executeRagPipeline(params: {
    question: string;
    passages: SearchResultPassage[];
    engineUsed: string;
    thresholdApplied: number;
    temperature?: number;
  }): Promise<RagAnswerResponse> {
    const { question, passages, engineUsed, thresholdApplied, temperature } = params;
    const model = env.GEMINI_CHAT_MODEL || 'gemini-2.5-flash';

    // 1. Empty Retrieval Guard: If no chunks met the threshold, refuse hallucination immediately
    if (passages.length === 0) {
      logger.info(
        `Empty retrieval for question: "${question}". No passages passed threshold (${thresholdApplied}).`,
      );
      return {
        question,
        answer: 'The provided documents do not contain enough information to answer this question.',
        isGrounded: false,
        sources: [],
        metadata: {
          model,
          engineUsed,
          chunksRetrieved: 0,
          chunksUsed: 0,
          thresholdApplied,
        },
      };
    }

    // 2. Build structured prompt and manage context budget
    const { userPrompt, contextResult } = buildRagPrompt(question, passages);

    logger.info(
      `Invoking Gemini LLM (${model}) with ${contextResult.includedPassages.length} grounded context chunks`,
    );

    // 3. Generate answer using Gemini LLM
    const llmResult = await geminiLlmService.generateText(userPrompt, {
      systemInstruction: RAG_SYSTEM_INSTRUCTION,
      temperature: temperature ?? 0.2,
    });

    const sources = this.formatCitations(contextResult.includedPassages);

    return {
      question,
      answer: llmResult.text,
      isGrounded: true,
      sources,
      metadata: {
        model,
        engineUsed,
        chunksRetrieved: passages.length,
        chunksUsed: contextResult.includedPassages.length,
        thresholdApplied,
        usage: llmResult.usage,
      },
    };
  }

  /**
   * Ask questions across all documents in a workspace (with optional documentId filters).
   */
  async askWorkspaceQuestion(
    userId: string,
    workspaceId: string,
    input: RagAskQuestionInput,
  ): Promise<RagAnswerResponse> {
    const topK = input.topK ?? env.RAG_MAX_CONTEXT_CHUNKS;
    const minScore = input.minScore ?? env.RAG_MIN_SIMILARITY_SCORE;

    // Vector retrieval
    const searchResponse = await searchService.searchWorkspace(userId, workspaceId, {
      query: input.question,
      topK,
      minScore,
      documentIds: input.documentIds,
    });

    return this.executeRagPipeline({
      question: input.question,
      passages: searchResponse.results,
      engineUsed: searchResponse.engineUsed,
      thresholdApplied: minScore,
      temperature: input.temperature,
    });
  }

  /**
   * Ask questions strictly scoped to a single document.
   */
  async askDocumentQuestion(
    userId: string,
    documentId: string,
    input: RagAskQuestionInput,
  ): Promise<RagAnswerResponse> {
    const topK = input.topK ?? env.RAG_MAX_CONTEXT_CHUNKS;
    const minScore = input.minScore ?? env.RAG_MIN_SIMILARITY_SCORE;

    // Vector retrieval for single document
    const searchResponse = await searchService.searchDocument(
      userId,
      documentId,
      input.question,
      topK,
      minScore,
    );

    return this.executeRagPipeline({
      question: input.question,
      passages: searchResponse.results,
      engineUsed: searchResponse.engineUsed,
      thresholdApplied: minScore,
      temperature: input.temperature,
    });
  }

  /**
   * Ask questions globally across all accessible documents.
   */
  async askGlobalQuestion(
    userId: string,
    input: RagAskQuestionInput,
  ): Promise<RagAnswerResponse> {
    const topK = input.topK ?? env.RAG_MAX_CONTEXT_CHUNKS;
    const minScore = input.minScore ?? env.RAG_MIN_SIMILARITY_SCORE;

    const searchResponse = await searchService.searchAll(userId, {
      query: input.question,
      topK,
      minScore,
      workspaceId: input.workspaceId,
      documentIds: input.documentIds,
    });

    return this.executeRagPipeline({
      question: input.question,
      passages: searchResponse.results,
      engineUsed: searchResponse.engineUsed,
      thresholdApplied: minScore,
      temperature: input.temperature,
    });
  }
}

export const ragService = new RagService();

