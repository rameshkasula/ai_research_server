import { z } from 'zod';

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

export const conversationIdParamsSchema = z.object({
  id: z.string().regex(objectIdRegex, 'Invalid conversation ID format'),
});

export const workspaceConversationParamsSchema = z.object({
  workspaceId: z.string().regex(objectIdRegex, 'Invalid workspace ID format'),
});

export const createConversationSchema = z.object({
  workspaceId: z
    .string()
    .regex(objectIdRegex, 'Invalid workspace ID format')
    .optional(),
  title: z
    .string()
    .trim()
    .min(1, 'Title cannot be empty')
    .max(200, 'Title cannot exceed 200 characters')
    .optional(),
});

export const updateConversationSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Title cannot be empty')
    .max(200, 'Title cannot exceed 200 characters'),
});

export const sendMessageSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, 'Message content cannot be empty')
    .max(4000, 'Message cannot exceed 4000 characters'),
  stream: z.boolean().optional().default(true),
  documentIds: z
    .array(z.string().regex(objectIdRegex, 'Invalid document ID format'))
    .optional(),
  topK: z.coerce.number().int().min(1).max(15).optional(),
  minScore: z.coerce.number().min(0).max(1).optional(),
});

export const listMessagesQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(50),
});

export type ConversationIdParams = z.infer<typeof conversationIdParamsSchema>;
export type WorkspaceConversationParams = z.infer<typeof workspaceConversationParamsSchema>;
export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export type UpdateConversationInput = z.infer<typeof updateConversationSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;

