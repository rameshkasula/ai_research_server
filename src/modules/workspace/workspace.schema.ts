import { z } from 'zod';
import { WORKSPACE_STATUSES } from './workspace.model';

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

export const workspaceIdParamsSchema = z.object({
  id: z.string().regex(objectIdRegex, 'Invalid workspace ID format'),
});

export const createWorkspaceBodySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Workspace name is required')
    .max(120, 'Workspace name cannot exceed 120 characters'),
  description: z
    .string()
    .trim()
    .max(1000, 'Workspace description cannot exceed 1000 characters')
    .optional()
    .default(''),
  status: z.enum(WORKSPACE_STATUSES).optional().default('active'),
});

export const updateWorkspaceBodySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Workspace name cannot be empty')
      .max(120, 'Workspace name cannot exceed 120 characters')
      .optional(),
    description: z
      .string()
      .trim()
      .max(1000, 'Workspace description cannot exceed 1000 characters')
      .optional(),
    status: z.enum(WORKSPACE_STATUSES).optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.description !== undefined ||
      data.status !== undefined,
    {
      message: 'At least one field (name, description, or status) must be provided',
    },
  );

export const listWorkspacesQuerySchema = z.object({
  search: z.string().trim().optional(),
  q: z.string().trim().optional(),
  status: z.enum(WORKSPACE_STATUSES).optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  sortBy: z
    .enum(['createdAt', 'updatedAt', 'name'])
    .optional()
    .default('updatedAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

export type WorkspaceIdParams = z.infer<typeof workspaceIdParamsSchema>;
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceBodySchema>;
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceBodySchema>;
export type ListWorkspacesQuery = z.infer<typeof listWorkspacesQuerySchema>;

