import mongoose from 'mongoose';
import { env } from '../../config/env';
import { AppError } from '../../common/errors/AppError';
import { searchService } from '../search/search.service';
import { geminiLlmService } from '../../common/services/geminiLlm.service';
import { logger } from '../../common/utils/logger';
import { WorkspaceModel } from '../workspace/workspace.model';
import { ConversationModel, IConversation } from './conversation.model';
import { IMessage, IMessageSource, MessageModel } from './message.model';
import {
  buildChatPrompt,
  CHAT_SYSTEM_INSTRUCTION,
  mapPassagesToMessageSources,
} from './conversation.prompt';
import { SendMessageInput } from './conversation.schema';

export interface StreamCallbacks {
  onSources?: (sources: IMessageSource[]) => void;
  onDelta: (delta: string) => void;
  onDone: (message: IMessage) => void;
  onError: (error: Error) => void;
}

export class ConversationService {
  /**
   * Verifies that the conversation exists and belongs to the user.
   */
  async getOwnedConversationOrThrow(
    userId: string,
    conversationId: string,
  ): Promise<IConversation> {
    const conversation = await ConversationModel.findById(conversationId);
    if (!conversation) {
      throw AppError.notFound('Conversation not found');
    }

    if (String(conversation.userId) !== userId) {
      throw AppError.forbidden('You do not have permission to access this conversation');
    }

    return conversation;
  }

  /**
   * Verifies workspace ownership.
   */
  private async verifyWorkspaceOwnership(
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    const workspace = await WorkspaceModel.findById(workspaceId);
    if (!workspace) {
      throw AppError.notFound('Workspace not found');
    }

    if (String(workspace.userId) !== userId) {
      throw AppError.forbidden('You do not have permission to access this workspace');
    }
  }

  /**
   * Creates a new conversation.
   */
  async createConversation(
    userId: string,
    workspaceId: string,
    title?: string,
  ): Promise<IConversation> {
    await this.verifyWorkspaceOwnership(userId, workspaceId);

    const conversation = await ConversationModel.create({
      workspaceId: new mongoose.Types.ObjectId(workspaceId),
      userId: new mongoose.Types.ObjectId(userId),
      title: title?.trim() || 'New Research Chat',
    });

    return conversation;
  }

  /**
   * Lists conversations for a user, optionally filtered by workspace.
   */
  async listConversations(
    userId: string,
    workspaceId?: string,
  ): Promise<IConversation[]> {
    const filter: Record<string, unknown> = {
      userId: new mongoose.Types.ObjectId(userId),
    };

    if (workspaceId) {
      filter.workspaceId = new mongoose.Types.ObjectId(workspaceId);
    }

    return ConversationModel.find(filter).sort({ updatedAt: -1 });
  }

  /**
   * Retrieves conversation by ID.
   */
  async getConversationById(
    userId: string,
    conversationId: string,
  ): Promise<IConversation> {
    return this.getOwnedConversationOrThrow(userId, conversationId);
  }

  /**
   * Renames a conversation.
   */
  async updateConversationTitle(
    userId: string,
    conversationId: string,
    title: string,
  ): Promise<IConversation> {
    const conversation = await this.getOwnedConversationOrThrow(
      userId,
      conversationId,
    );

    conversation.title = title.trim();
    await conversation.save();
    return conversation;
  }

  /**
   * Deletes a conversation and all its messages.
   */
  async deleteConversation(
    userId: string,
    conversationId: string,
  ): Promise<void> {
    const conversation = await this.getOwnedConversationOrThrow(
      userId,
      conversationId,
    );

    await MessageModel.deleteMany({ conversationId: conversation._id });
    await conversation.deleteOne();
  }

  /**
   * Retrieves all messages in a conversation sorted chronologically.
   */
  async getConversationMessages(
    userId: string,
    conversationId: string,
  ): Promise<IMessage[]> {
    await this.getOwnedConversationOrThrow(userId, conversationId);

    return MessageModel.find({
      conversationId: new mongoose.Types.ObjectId(conversationId),
    }).sort({ createdAt: 1 });
  }

  /**
   * Automatically generates a conversation title from the first question if currently default.
   */
  private async autoTitleConversationIfNew(
    conversation: IConversation,
    firstQuestion: string,
  ): Promise<void> {
    if (conversation.title === 'New Research Chat') {
      const cleanTitle =
        firstQuestion.replace(/\n/g, ' ').trim().slice(0, 60) +
        (firstQuestion.length > 60 ? '...' : '');
      conversation.title = cleanTitle;
      await conversation.save().catch(() => undefined);
    }
  }

  /**
   * Handles non-streaming message generation with persistence.
   */
  async sendMessage(
    userId: string,
    conversationId: string,
    input: SendMessageInput,
  ): Promise<{
    userMessage: IMessage;
    assistantMessage: IMessage;
  }> {
    const conversation = await this.getOwnedConversationOrThrow(
      userId,
      conversationId,
    );

    const topK = input.topK ?? env.RAG_MAX_CONTEXT_CHUNKS;
    const minScore = input.minScore ?? env.RAG_MIN_SIMILARITY_SCORE;

    // 1. Save user message to database
    const userMessage = await MessageModel.create({
      conversationId: conversation._id,
      workspaceId: conversation.workspaceId,
      userId: new mongoose.Types.ObjectId(userId),
      role: 'user',
      content: input.content,
      sources: [],
      status: 'completed',
    });

    // 2. Retrieve semantic document chunks from the workspace
    const searchResult = await searchService.searchWorkspace(
      userId,
      String(conversation.workspaceId),
      {
        query: input.content,
        topK,
        minScore,
        documentIds: input.documentIds,
      },
    );

    // 3. Fetch recent conversation history
    const previousMessages = await MessageModel.find({
      conversationId: conversation._id,
      _id: { $ne: userMessage._id },
    })
      .sort({ createdAt: 1 })
      .limit(8)
      .lean();

    const history = previousMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // 4. Construct grounded chat prompt
    const { prompt, sources } = buildChatPrompt({
      question: input.content,
      history,
      passages: searchResult.results,
    });

    // 5. Generate answer using Gemini
    let answerText = '';
    let status: 'completed' | 'failed' = 'completed';
    let errorMessage: string | null = null;

    try {
      if (searchResult.results.length === 0) {
        answerText =
          'The provided documents do not contain enough information to answer this question.';
      } else {
        const llmResult = await geminiLlmService.generateText(prompt, {
          systemInstruction: CHAT_SYSTEM_INSTRUCTION,
          temperature: 0.2,
        });
        answerText = llmResult.text;
      }
    } catch (err) {
      status = 'failed';
      errorMessage = err instanceof Error ? err.message : String(err);
      answerText =
        'Sorry, an error occurred while generating the research answer. Please try again.';
    }

    // 6. Save assistant message with citations
    const assistantMessage = await MessageModel.create({
      conversationId: conversation._id,
      workspaceId: conversation.workspaceId,
      userId: new mongoose.Types.ObjectId(userId),
      role: 'assistant',
      content: answerText,
      sources,
      status,
      errorMessage,
    });

    // Update conversation timestamp & auto-title
    conversation.updatedAt = new Date();
    await conversation.save();
    await this.autoTitleConversationIfNew(conversation, input.content);

    return { userMessage, assistantMessage };
  }

  /**
   * Handles real-time Server-Sent Events (SSE) streaming with persistence and cancellation.
   */
  async streamMessage(
    userId: string,
    conversationId: string,
    input: SendMessageInput,
    callbacks: StreamCallbacks,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    const conversation = await this.getOwnedConversationOrThrow(
      userId,
      conversationId,
    );

    const topK = input.topK ?? env.RAG_MAX_CONTEXT_CHUNKS;
    const minScore = input.minScore ?? env.RAG_MIN_SIMILARITY_SCORE;

    // 1. Save user message
    await MessageModel.create({
      conversationId: conversation._id,
      workspaceId: conversation.workspaceId,
      userId: new mongoose.Types.ObjectId(userId),
      role: 'user',
      content: input.content,
      sources: [],
      status: 'completed',
    });

    // 2. Perform vector search
    const searchResult = await searchService.searchWorkspace(
      userId,
      String(conversation.workspaceId),
      {
        query: input.content,
        topK,
        minScore,
        documentIds: input.documentIds,
      },
    );

    const sources = mapPassagesToMessageSources(searchResult.results);

    // 3. Emit sources to client immediately so references appear right away
    if (callbacks.onSources) {
      callbacks.onSources(sources);
    }

    // 4. Create pending assistant message record
    const assistantMessage = await MessageModel.create({
      conversationId: conversation._id,
      workspaceId: conversation.workspaceId,
      userId: new mongoose.Types.ObjectId(userId),
      role: 'assistant',
      content: '',
      sources,
      status: 'streaming',
    });

    // 5. Short-circuit if no relevant context
    if (searchResult.results.length === 0) {
      const fallbackText =
        'The provided documents do not contain enough information to answer this question.';
      callbacks.onDelta(fallbackText);

      assistantMessage.content = fallbackText;
      assistantMessage.status = 'completed';
      await assistantMessage.save();

      callbacks.onDone(assistantMessage);
      return;
    }

    // 6. Fetch previous history
    const previousMessages = await MessageModel.find({
      conversationId: conversation._id,
      _id: { $ne: assistantMessage._id },
    })
      .sort({ createdAt: 1 })
      .limit(8)
      .lean();

    const history = previousMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const { prompt } = buildChatPrompt({
      question: input.content,
      history,
      passages: searchResult.results,
    });

    // 7. Stream tokens from Gemini LLM
    let fullText = '';

    try {
      const tokenStream = geminiLlmService.generateTextStream(prompt, {
        systemInstruction: CHAT_SYSTEM_INSTRUCTION,
        temperature: 0.2,
      });

      for await (const chunkText of tokenStream) {
        if (abortSignal?.aborted) {
          logger.info(`Stream aborted by client for conversation ${conversationId}`);
          break;
        }

        fullText += chunkText;
        callbacks.onDelta(chunkText);
      }

      assistantMessage.content = fullText.trim();
      assistantMessage.status = 'completed';
      await assistantMessage.save();

      conversation.updatedAt = new Date();
      await conversation.save();
      await this.autoTitleConversationIfNew(conversation, input.content);

      callbacks.onDone(assistantMessage);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Error during LLM streaming', { error: err.message });

      assistantMessage.content = fullText.trim() || 'Generation was interrupted.';
      assistantMessage.status = 'failed';
      assistantMessage.errorMessage = err.message;
      await assistantMessage.save().catch(() => undefined);

      callbacks.onError(err);
    }
  }

  /**
   * Deletes all conversations and messages belonging to a workspace.
   */
  async deleteConversationsByWorkspace(workspaceId: string): Promise<number> {
    const wsId = new mongoose.Types.ObjectId(workspaceId);
    await MessageModel.deleteMany({ workspaceId: wsId });
    const result = await ConversationModel.deleteMany({ workspaceId: wsId });
    return result.deletedCount ?? 0;
  }
}

export const conversationService = new ConversationService();

