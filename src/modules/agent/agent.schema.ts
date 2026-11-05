import { z } from 'zod';
import { AGENT_TOOLS } from './agentRun.model';

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

export const agentRunIdParamsSchema = z.object({
  id: z.string().regex(objectIdRegex, 'Invalid agent run ID format'),
});

export const workspaceAgentParamsSchema = z.object({
  workspaceId: z.string().regex(objectIdRegex, 'Invalid workspace ID format'),
});

export const createAgentRunBodySchema = z.object({
  workspaceId: z
    .string()
    .regex(objectIdRegex, 'Invalid workspace ID format')
    .optional(),
  objective: z
    .string()
    .trim()
    .min(5, 'Research objective must be at least 5 characters')
    .max(3000, 'Research objective cannot exceed 3000 characters'),
  maxSteps: z.coerce.number().int().min(2).max(15).optional().default(6),
  requireApproval: z.boolean().optional().default(false),
  includeWeb: z.boolean().optional().default(true),
  includeDocuments: z.boolean().optional().default(true),
});

export const agentPlanResponseSchema = z.object({
  plan: z
    .array(
      z.object({
        stepNumber: z.number().int().positive(),
        tool: z.enum(AGENT_TOOLS),
        description: z.string(),
        queryOrInput: z.string(),
      }),
    )
    .min(1)
    .max(12),
});

export const agentGapCheckSchema = z.object({
  missingInformation: z.array(z.string()).default([]),
  followUpQueries: z
    .array(
      z.object({
        tool: z.enum(['search_web', 'retrieve_documents']),
        query: z.string(),
      }),
    )
    .max(2)
    .default([]),
});

export type CreateAgentRunInput = z.infer<typeof createAgentRunBodySchema>;

