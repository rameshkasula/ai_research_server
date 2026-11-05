import { z } from 'zod';

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

export const semanticSearchQuerySchema = z.object({
  query: z
    .string()
    .trim()
    .min(1, 'Search query cannot be empty')
    .max(2000, 'Search query cannot exceed 2000 characters'),
  topK: z.coerce.number().int().positive().max(50).optional().default(5),
  minScore: z.coerce.number().min(0).max(1).optional().default(0.5),
  documentIds: z
    .array(z.string().regex(objectIdRegex, 'Invalid document ID format'))
    .optional(),
  workspaceId: z
    .string()
    .regex(objectIdRegex, 'Invalid workspace ID format')
    .optional(),
});

export const documentSearchQuerySchema = z.object({
  query: z
    .string()
    .trim()
    .min(1, 'Search query cannot be empty')
    .max(2000, 'Search query cannot exceed 2000 characters'),
  topK: z.coerce.number().int().positive().max(50).optional().default(5),
  minScore: z.coerce.number().min(0).max(1).optional().default(0.5),
});

export type SemanticSearchInput = z.infer<typeof semanticSearchQuerySchema>;
export type DocumentSearchInput = z.infer<typeof documentSearchQuerySchema>;

