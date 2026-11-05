import { z } from 'zod';
import { ALLOWED_MIME_TYPES } from '../../common/utils/fileValidator';
import { DOCUMENT_STATUSES } from './document.model';

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

export const documentIdParamsSchema = z.object({
  id: z.string().regex(objectIdRegex, 'Invalid document ID format'),
});

export const workspaceDocumentParamsSchema = z.object({
  workspaceId: z.string().regex(objectIdRegex, 'Invalid workspace ID format'),
});

export const workspaceAndDocumentParamsSchema = z.object({
  workspaceId: z.string().regex(objectIdRegex, 'Invalid workspace ID format'),
  id: z.string().regex(objectIdRegex, 'Invalid document ID format'),
});

export const listDocumentsQuerySchema = z.object({
  workspaceId: z
    .string()
    .regex(objectIdRegex, 'Invalid workspace ID format')
    .optional(),
  status: z.enum(DOCUMENT_STATUSES).optional(),
  mimeType: z.enum(ALLOWED_MIME_TYPES).optional(),
  search: z.string().trim().optional(),
  q: z.string().trim().optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  sortBy: z
    .enum(['createdAt', 'updatedAt', 'originalName', 'fileSize'])
    .optional()
    .default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

export const presignFileItemSchema = z.object({
  originalName: z
    .string()
    .trim()
    .min(1, 'originalName is required')
    .max(255, 'originalName cannot exceed 255 characters'),
  mimeType: z.string().trim().optional(),
  fileSize: z.coerce.number().int().positive('fileSize must be a positive integer'),
  contentHash: z.string().trim().min(16).max(128).optional(),
});

export const presignUploadBodySchema = z
  .object({
    workspaceId: z
      .string()
      .regex(objectIdRegex, 'Invalid workspace ID format')
      .optional(),
    allowDuplicate: z.boolean().optional().default(false),
    originalName: z.string().trim().min(1).max(255).optional(),
    mimeType: z.string().trim().optional(),
    fileSize: z.coerce.number().int().positive().optional(),
    contentHash: z.string().trim().min(16).max(128).optional(),
    files: z.array(presignFileItemSchema).min(1).max(10).optional(),
  })
  .refine(
    (data) =>
      (Array.isArray(data.files) && data.files.length > 0) ||
      (Boolean(data.originalName) && typeof data.fileSize === 'number'),
    {
      message:
        'Provide either a single file (originalName + fileSize) or a non-empty files[] array',
    },
  );

export const updateDocumentStatusBodySchema = z
  .object({
    status: z.enum(DOCUMENT_STATUSES).optional(),
    uploadProgress: z.coerce.number().min(0).max(100).optional(),
    processingError: z.string().trim().max(2000).nullable().optional(),
  })
  .refine(
    (data) =>
      data.status !== undefined ||
      data.uploadProgress !== undefined ||
      data.processingError !== undefined,
    {
      message:
        'At least one of status, uploadProgress, or processingError must be provided',
    },
  );

export const downloadUrlQuerySchema = z.object({
  inline: z.enum(['true', 'false']).optional().default('false'),
  expiresInSeconds: z.coerce
    .number()
    .int()
    .min(60)
    .max(86400)
    .optional(),
});

export const localPresignedUploadQuerySchema = z.object({
  expires: z.coerce.number().int().positive(),
  mimeType: z.string().min(1),
  maxSize: z.coerce.number().int().positive(),
  sig: z.string().min(32),
});

export const localPresignedDownloadQuerySchema = z.object({
  expires: z.coerce.number().int().positive(),
  disposition: z.enum(['inline', 'attachment']).optional().default('attachment'),
  sig: z.string().min(32),
});

export type DocumentIdParams = z.infer<typeof documentIdParamsSchema>;
export type WorkspaceDocumentParams = z.infer<typeof workspaceDocumentParamsSchema>;
export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>;
export type PresignFileItemInput = z.infer<typeof presignFileItemSchema>;
export type PresignUploadBodyInput = z.infer<typeof presignUploadBodySchema>;
export type UpdateDocumentStatusInput = z.infer<typeof updateDocumentStatusBodySchema>;
export type DownloadUrlQuery = z.infer<typeof downloadUrlQuerySchema>;
export type LocalPresignedUploadQuery = z.infer<typeof localPresignedUploadQuerySchema>;
export type LocalPresignedDownloadQuery = z.infer<typeof localPresignedDownloadQuerySchema>;

