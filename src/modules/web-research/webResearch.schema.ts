import { z } from 'zod';

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

export const workspaceWebParamsSchema = z.object({
  workspaceId: z.string().regex(objectIdRegex, 'Invalid workspace ID format'),
});

export const webSourceIdParamsSchema = z.object({
  id: z.string().regex(objectIdRegex, 'Invalid web source ID format'),
});

export const webSearchBodySchema = z.object({
  workspaceId: z
    .string()
    .regex(objectIdRegex, 'Invalid workspace ID format')
    .optional(),
  query: z
    .string()
    .trim()
    .min(2, 'Search query must be at least 2 characters')
    .max(500, 'Search query cannot exceed 500 characters'),
  maxResults: z.coerce.number().int().min(1).max(10).optional().default(5),
  summarize: z.boolean().optional().default(true),
  storeSources: z.boolean().optional().default(true),
});

export const fetchUrlsBodySchema = z.object({
  workspaceId: z
    .string()
    .regex(objectIdRegex, 'Invalid workspace ID format')
    .optional(),
  urls: z.array(z.string().url('Invalid URL')).min(1).max(10),
  summarize: z.boolean().optional().default(true),
});

export const hybridResearchBodySchema = z.object({
  workspaceId: z
    .string()
    .regex(objectIdRegex, 'Invalid workspace ID format')
    .optional(),
  question: z
    .string()
    .trim()
    .min(2, 'Question must be at least 2 characters')
    .max(2000, 'Question cannot exceed 2000 characters'),
  includeDocuments: z.boolean().optional().default(true),
  includeWeb: z.boolean().optional().default(true),
  maxWebResults: z.coerce.number().int().min(1).max(10).optional().default(4),
  topKDocuments: z.coerce.number().int().min(1).max(15).optional().default(5),
});

export type WebSearchBodyInput = z.infer<typeof webSearchBodySchema>;
export type FetchUrlsBodyInput = z.infer<typeof fetchUrlsBodySchema>;
export type HybridResearchBodyInput = z.infer<typeof hybridResearchBodySchema>;

