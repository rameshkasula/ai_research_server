import { Router } from 'express';
import { authenticate } from '../../common/middlewares/auth.middleware';
import { parseMultipartUpload } from '../../common/middlewares/multipartUpload';
import { validateRequest } from '../../common/middlewares/validateRequest';
import { documentController } from './document.controller';
import {
  documentIdParamsSchema,
  downloadUrlQuerySchema,
  listDocumentsQuerySchema,
  localPresignedDownloadQuerySchema,
  localPresignedUploadQuerySchema,
  presignUploadBodySchema,
  updateDocumentStatusBodySchema,
  workspaceAndDocumentParamsSchema,
  workspaceDocumentParamsSchema,
} from './document.schema';

/**
 * Standalone `/api/documents` router
 */
const documentRouter = Router();

// HMAC-signed local presigned upload/download endpoints (authorized by cryptographic signature)
documentRouter.put(
  '/:id/presigned-upload',
  validateRequest({
    params: documentIdParamsSchema,
    query: localPresignedUploadQuerySchema,
  }),
  documentController.handleLocalPresignedPut,
);

documentRouter.get(
  '/:id/presigned-download',
  validateRequest({
    params: documentIdParamsSchema,
    query: localPresignedDownloadQuerySchema,
  }),
  documentController.handleLocalPresignedDownload,
);

// Authenticated `/api/documents` endpoints
documentRouter.use(authenticate);

documentRouter.post(
  '/upload',
  parseMultipartUpload(),
  documentController.upload,
);

documentRouter.post(
  '/presign',
  validateRequest({ body: presignUploadBodySchema }),
  documentController.presignUpload,
);

documentRouter.get(
  '/',
  validateRequest({ query: listDocumentsQuerySchema }),
  documentController.list,
);

documentRouter.get(
  '/:id',
  validateRequest({ params: documentIdParamsSchema }),
  documentController.getById,
);

documentRouter.get(
  '/:id/status',
  validateRequest({ params: documentIdParamsSchema }),
  documentController.getStatus,
);

documentRouter.patch(
  '/:id/status',
  validateRequest({
    params: documentIdParamsSchema,
    body: updateDocumentStatusBodySchema,
  }),
  documentController.updateStatus,
);

documentRouter.post(
  '/:id/confirm-upload',
  validateRequest({ params: documentIdParamsSchema }),
  documentController.confirmUpload,
);

documentRouter.get(
  '/:id/download-url',
  validateRequest({
    params: documentIdParamsSchema,
    query: downloadUrlQuerySchema,
  }),
  documentController.getDownloadUrl,
);

documentRouter.delete(
  '/:id',
  validateRequest({ params: documentIdParamsSchema }),
  documentController.remove,
);

/**
 * Workspace-scoped `/api/workspaces/:workspaceId/documents` router
 */
const workspaceDocumentRouter = Router({ mergeParams: true });

workspaceDocumentRouter.use(authenticate);

workspaceDocumentRouter.post(
  '/',
  validateRequest({ params: workspaceDocumentParamsSchema }),
  parseMultipartUpload(),
  documentController.upload,
);

workspaceDocumentRouter.post(
  '/upload',
  validateRequest({ params: workspaceDocumentParamsSchema }),
  parseMultipartUpload(),
  documentController.upload,
);

workspaceDocumentRouter.post(
  '/presign',
  validateRequest({
    params: workspaceDocumentParamsSchema,
    body: presignUploadBodySchema,
  }),
  documentController.presignUpload,
);

workspaceDocumentRouter.get(
  '/',
  validateRequest({
    params: workspaceDocumentParamsSchema,
    query: listDocumentsQuerySchema,
  }),
  documentController.list,
);

workspaceDocumentRouter.get(
  '/:id',
  validateRequest({ params: workspaceAndDocumentParamsSchema }),
  documentController.getById,
);

workspaceDocumentRouter.get(
  '/:id/status',
  validateRequest({ params: workspaceAndDocumentParamsSchema }),
  documentController.getStatus,
);

workspaceDocumentRouter.patch(
  '/:id/status',
  validateRequest({
    params: workspaceAndDocumentParamsSchema,
    body: updateDocumentStatusBodySchema,
  }),
  documentController.updateStatus,
);

workspaceDocumentRouter.post(
  '/:id/confirm-upload',
  validateRequest({ params: workspaceAndDocumentParamsSchema }),
  documentController.confirmUpload,
);

workspaceDocumentRouter.get(
  '/:id/download-url',
  validateRequest({
    params: workspaceAndDocumentParamsSchema,
    query: downloadUrlQuerySchema,
  }),
  documentController.getDownloadUrl,
);

workspaceDocumentRouter.delete(
  '/:id',
  validateRequest({ params: workspaceAndDocumentParamsSchema }),
  documentController.remove,
);

export const documentRoutes = documentRouter;
export const workspaceDocumentRoutes = workspaceDocumentRouter;

