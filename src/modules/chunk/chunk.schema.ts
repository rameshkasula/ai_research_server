import { z } from 'zod';

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

export const documentChunkParamsSchema = z.object({
  id: z.string().regex(objectIdRegex, 'Invalid document ID format'),
});

export const chunkIdParamsSchema = z.object({
  id: z.string().regex(objectIdRegex, 'Invalid chunk ID format'),
});

export const processDocumentBodySchema = z.object({
  chunkSize: z.coerce.number().int().min(100).max(5000).optional(),
  chunkOverlap: z.coerce.number().int().min(0).max(1000).optional(),
});

export const listChunksQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  includeEmbedding: z.enum(['true', 'false']).optional().default('false'),
});

export const searchChunksBodySchema = z.object({
  query: z.string().trim().min(1, 'Search query cannot be empty'),
  topK: z.coerce.number().int().positive().max(20).optional().default(5),
});

export type DocumentChunkParams = z.infer<typeof documentChunkParamsSchema>;
export type ChunkIdParams = z.infer<typeof chunkIdParamsSchema>;
export type ProcessDocumentBody = z.infer<typeof processDocumentBodySchema>;
export type ListChunksQuery = z.infer<typeof listChunksQuerySchema>;
export type SearchChunksBody = z.infer<typeof searchChunksBodySchema>;

