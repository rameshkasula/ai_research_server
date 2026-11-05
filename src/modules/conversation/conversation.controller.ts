import { Request, Response } from 'express';
import { AppError } from '../../common/errors/AppError';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { sendSuccess } from '../../common/utils/apiResponse';
import { conversationService } from './conversation.service';
import {
  ConversationIdParams,
  CreateConversationInput,
  SendMessageInput,
  UpdateConversationInput,
  WorkspaceConversationParams,
} from './conversation.schema';

function requireUserId(req: Request): string {
  if (!req.user?.id) {
    throw AppError.unauthorized('Authentication required');
  }
  return req.user.id;
}

export class ConversationController {
  /**
   * Creates a new conversation in a workspace.
   */
  create = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const workspaceId =
      (req.params as unknown as WorkspaceConversationParams).workspaceId ||
      (req.body as CreateConversationInput).workspaceId;

    if (!workspaceId) {
      throw AppError.badRequest('workspaceId is required to create a conversation');
    }

    const { title } = req.body as CreateConversationInput;
    const conversation = await conversationService.createConversation(
      userId,
      workspaceId,
      title,
    );

    sendSuccess(res, { conversation }, 201, 'Conversation created successfully');
  });

  /**
   * Lists conversations for a workspace or across all user's workspaces.
   */
  list = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const workspaceId =
      (req.params as unknown as WorkspaceConversationParams).workspaceId ||
      (req.query.workspaceId as string | undefined);

    const conversations = await conversationService.listConversations(
      userId,
      workspaceId,
    );

    sendSuccess(res, { conversations }, 200, 'Conversations retrieved successfully');
  });

  /**
   * Retrieves conversation metadata.
   */
  getById = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const { id } = req.params as unknown as ConversationIdParams;

    const conversation = await conversationService.getConversationById(userId, id);
    sendSuccess(res, { conversation }, 200, 'Conversation retrieved successfully');
  });

  /**
   * Renames a conversation title.
   */
  update = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const { id } = req.params as unknown as ConversationIdParams;
    const { title } = req.body as UpdateConversationInput;

    const conversation = await conversationService.updateConversationTitle(
      userId,
      id,
      title,
    );

    sendSuccess(res, { conversation }, 200, 'Conversation renamed successfully');
  });

  /**
   * Deletes a conversation and its message history.
   */
  remove = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const { id } = req.params as unknown as ConversationIdParams;

    await conversationService.deleteConversation(userId, id);
    sendSuccess(res, null, 200, 'Conversation deleted successfully');
  });

  /**
   * Retrieves message history for a conversation.
   */
  getMessages = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const { id } = req.params as unknown as ConversationIdParams;

    const messages = await conversationService.getConversationMessages(userId, id);
    sendSuccess(res, { messages }, 200, 'Messages retrieved successfully');
  });

  /**
   * Sends a message to the conversation.
   * Supports both real-time Server-Sent Events (SSE) streaming and standard JSON.
   */
  sendMessage = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const { id } = req.params as unknown as ConversationIdParams;
    const body = req.body as SendMessageInput;

    const isStreamingRequested =
      body.stream !== false &&
      (req.headers.accept?.includes('text/event-stream') ||
        req.query.stream === 'true' ||
        body.stream === true);

    // 1. Server-Sent Events (SSE) streaming response
    if (isStreamingRequested) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
      }

      const abortController = new AbortController();
      req.on('close', () => {
        abortController.abort();
      });

      await conversationService.streamMessage(
        userId,
        id,
        body,
        {
          onSources: (sources) => {
            res.write(`event: sources\ndata: ${JSON.stringify({ sources })}\n\n`);
          },
          onDelta: (delta) => {
            res.write(`event: delta\ndata: ${JSON.stringify({ delta })}\n\n`);
          },
          onDone: (message) => {
            res.write(`event: done\ndata: ${JSON.stringify({ message })}\n\n`);
            res.end();
          },
          onError: (err) => {
            res.write(
              `event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`,
            );
            res.end();
          },
        },
        abortController.signal,
      );
      return;
    }

    // 2. Non-streaming JSON response
    const result = await conversationService.sendMessage(userId, id, body);
    sendSuccess(res, result, 200, 'Message sent successfully');
  });
}

export const conversationController = new ConversationController();

