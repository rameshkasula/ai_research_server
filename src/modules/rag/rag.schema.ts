import { z } from 'zod';

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

export const ragAskQuestionSchema = z.object({
  question: z
    .string()
    .trim()
    .min(1, 'Question cannot be empty')
    .max(2000, 'Question cannot exceed 2000 characters'),
  workspaceId: z
    .string()
    .regex(objectIdRegex, 'Invalid workspace ID format')
    .optional(),
  documentIds: z
    .array(z.string().regex(objectIdRegex, 'Invalid document ID format'))
    .optional(),
  topK: z.coerce.number().int().min(1).max(15).optional().default(5),
  minScore: z.coerce.number().min(0).max(1).optional().default(0.55),
  temperature: z.coerce.number().min(0).max(1).optional().default(0.2),
});

export const workspaceRagParamsSchema = z.object({
  workspaceId: z.string().regex(objectIdRegex, 'Invalid workspace ID format'),
});

export const documentRagParamsSchema = z.object({
  id: z.string().regex(objectIdRegex, 'Invalid document ID format'),
});

export type RagAskQuestionInput = z.infer<typeof ragAskQuestionSchema>;
export type WorkspaceRagParams = z.infer<typeof workspaceRagParamsSchema>;
export type DocumentRagParams = z.infer<typeof documentRagParamsSchema>;

