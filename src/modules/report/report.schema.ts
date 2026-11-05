import { z } from 'zod';
import { REPORT_SECTION_KEYS } from './report.model';

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

export const reportIdParamsSchema = z.object({
  id: z.string().regex(objectIdRegex, 'Invalid report ID format'),
});

export const workspaceReportParamsSchema = z.object({
  workspaceId: z.string().regex(objectIdRegex, 'Invalid workspace ID format'),
});

export const regenerateSectionParamsSchema = z.object({
  id: z.string().regex(objectIdRegex, 'Invalid report ID format'),
  sectionKey: z.enum(REPORT_SECTION_KEYS),
});

export const shareTokenParamsSchema = z.object({
  shareToken: z.string().min(16, 'Invalid share token'),
});

export const sharedExportParamsSchema = z.object({
  shareToken: z.string().min(16, 'Invalid share token'),
  format: z.enum(['pdf', 'markdown', 'md']),
});

export const createReportBodySchema = z.object({
  workspaceId: z
    .string()
    .regex(objectIdRegex, 'Invalid workspace ID format')
    .optional(),
  conversationId: z
    .string()
    .regex(objectIdRegex, 'Invalid conversation ID format')
    .optional(),
  agentRunId: z
    .string()
    .regex(objectIdRegex, 'Invalid agent run ID format')
    .optional(),
  title: z.string().trim().min(3).max(250).optional(),
  objective: z
    .string()
    .trim()
    .min(3, 'Research objective is required')
    .max(3000)
    .optional(),
});

export const updateReportBodySchema = z
  .object({
    title: z.string().trim().min(3).max(250).optional(),
    objective: z.string().trim().min(3).max(3000).optional(),
    sections: z
      .object({
        executiveSummary: z.string().optional(),
        researchObjective: z.string().optional(),
        methodology: z.string().optional(),
        keyFindings: z.string().optional(),
        marketAnalysis: z.string().optional(),
        competitorComparison: z.string().optional(),
        opportunities: z.string().optional(),
        risks: z.string().optional(),
        recommendations: z.string().optional(),
        conclusion: z.string().optional(),
        references: z.string().optional(),
      })
      .optional(),
  })
  .refine(
    (d) =>
      d.title !== undefined ||
      d.objective !== undefined ||
      d.sections !== undefined,
    { message: 'Provide at least one field (title, objective, or sections) to update' },
  );

export const regenerateSectionBodySchema = z.object({
  instructions: z.string().trim().max(1000).optional(),
});

export const shareReportBodySchema = z.object({
  isPublic: z.boolean().default(true),
  expiresInHours: z.coerce.number().int().min(1).max(8760).optional().default(168), // default 7 days
  allowDownload: z.boolean().optional().default(true),
});

export const llmReportSectionsOutputSchema = z.object({
  title: z.string().optional(),
  executiveSummary: z.string(),
  researchObjective: z.string(),
  methodology: z.string(),
  keyFindings: z.string(),
  marketAnalysis: z.string(),
  competitorComparison: z.string(),
  opportunities: z.string(),
  risks: z.string(),
  recommendations: z.string(),
  conclusion: z.string(),
  references: z.string(),
});

export type CreateReportInput = z.infer<typeof createReportBodySchema>;
export type UpdateReportInput = z.infer<typeof updateReportBodySchema>;
export type RegenerateSectionInput = z.infer<typeof regenerateSectionBodySchema>;
export type ShareReportInput = z.infer<typeof shareReportBodySchema>;

