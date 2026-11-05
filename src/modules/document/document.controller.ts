import { Request, Response } from 'express';
import { env } from '../../config/env';
import { AppError } from '../../common/errors/AppError';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { sendSuccess } from '../../common/utils/apiResponse';
import { sanitizeFileName } from '../../common/utils/fileValidator';
import { storageService } from '../../common/storage/storage.service';
import { documentService } from './document.service';
import {
  DownloadUrlQuery,
  ListDocumentsQuery,
  LocalPresignedDownloadQuery,
  LocalPresignedUploadQuery,
  PresignFileItemInput,
  PresignUploadBodyInput,
  UpdateDocumentStatusInput,
} from './document.schema';

function requireUserId(req: Request): string {
  if (!req.user?.id) {
    throw AppError.unauthorized('Authentication required');
  }
  return req.user.id;
}

function getBaseUrl(req: Request): string {
  return `${req.protocol}://${req.get('host')}`;
}

function resolveWorkspaceId(req: Request): string {
  const fromParams = (req.params as { workspaceId?: string }).workspaceId;
  const fromBody = (req.body as { workspaceId?: string } | undefined)?.workspaceId;
  const fromQuery = (req.query as { workspaceId?: string } | undefined)?.workspaceId;
  const workspaceId = fromParams || fromBody || fromQuery;

  if (!workspaceId || !/^[0-9a-fA-F]{24}$/.test(workspaceId)) {
    throw AppError.badRequest('A valid workspaceId is required');
  }

  return workspaceId;
}

export class DocumentController {
  /**
   * Multipart drag-and-drop upload (supports single or multiple files).
   */
  upload = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const workspaceId = resolveWorkspaceId(req);
    const files = req.uploadedFiles ?? [];

    const allowDuplicate =
      req.body?.allowDuplicate === 'true' ||
      req.body?.allowDuplicate === true ||
      req.query?.allowDuplicate === 'true';

    const result = await documentService.uploadMultipartFiles({
      userId,
      workspaceId,
      files,
      allowDuplicate,
    });

    sendSuccess(
      res,
      {
        documents: result.uploaded,
        document: result.uploaded[0] ?? null,
        duplicatesSkipped: result.duplicatesSkipped,
      },
      201,
      `${result.uploaded.length} document(s) uploaded successfully`,
    );
  });

  /**
   * Generates presigned PUT URL(s) for direct client-to-object-storage upload.
   */
  presignUpload = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const workspaceId = resolveWorkspaceId(req);
    const body = req.body as PresignUploadBodyInput;

    const files: PresignFileItemInput[] =
      body.files && body.files.length > 0
        ? body.files
        : [
            {
              originalName: body.originalName!,
              mimeType: body.mimeType,
              fileSize: body.fileSize!,
              contentHash: body.contentHash,
            },
          ];

    const result = await documentService.createPresignedUploads({
      userId,
      workspaceId,
      files,
      allowDuplicate: body.allowDuplicate,
      baseUrl: getBaseUrl(req),
    });

    sendSuccess(
      res,
      result,
      201,
      'Presigned upload URL(s) generated successfully',
    );
  });

  /**
   * Handles direct binary PUT upload for local presigned URLs (`STORAGE_PROVIDER=local`).
   */
  handleLocalPresignedPut = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const query = req.query as unknown as LocalPresignedUploadQuery;

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    const maxAllowed = Math.min(query.maxSize, env.MAX_FILE_SIZE_BYTES);

    await new Promise<void>((resolve, reject) => {
      req.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > maxAllowed) {
          reject(
            AppError.badRequest(
              `Uploaded body exceeds presigned size limit (${maxAllowed} bytes)`,
            ),
          );
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve());
      req.on('error', (err) => reject(err));
    });

    const buffer = Buffer.concat(chunks);
    const doc = await documentService.handleLocalPresignedPut({
      documentId: id,
      expiresAtMs: query.expires,
      mimeType: query.mimeType,
      maxFileSize: query.maxSize,
      signature: query.sig,
      buffer,
    });

    sendSuccess(res, { document: doc }, 200, 'File uploaded to object storage');
  });

  /**
   * Confirms completion of a presigned upload.
   */
  confirmUpload = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const { id, workspaceId } = req.params as { id: string; workspaceId?: string };

    const document = await documentService.confirmUpload(userId, id, workspaceId);
    sendSuccess(res, { document }, 200, 'Document upload confirmed');
  });

  /**
   * Lists documents in a workspace (or across user's workspaces).
   */
  list = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const query = req.query as unknown as ListDocumentsQuery;
    const workspaceIdFromParams = (req.params as { workspaceId?: string })
      .workspaceId;

    const result = await documentService.listDocuments(userId, {
      ...query,
      workspaceId: workspaceIdFromParams ?? query.workspaceId,
    });

    sendSuccess(res, result, 200, 'Documents retrieved successfully');
  });

  /**
   * Retrieves a single document's metadata.
   */
  getById = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const { id, workspaceId } = req.params as { id: string; workspaceId?: string };

    const document = await documentService.getDocumentById(userId, id, workspaceId);
    sendSuccess(res, { document }, 200, 'Document retrieved successfully');
  });

  /**
   * Retrieves upload & processing status for a document.
   */
  getStatus = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const { id, workspaceId } = req.params as { id: string; workspaceId?: string };

    const status = await documentService.getDocumentStatus(userId, id, workspaceId);
    sendSuccess(res, { status }, 200, 'Document status retrieved successfully');
  });

  /**
   * Updates upload progress or processing lifecycle state.
   */
  updateStatus = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const { id, workspaceId } = req.params as { id: string; workspaceId?: string };
    const body = req.body as UpdateDocumentStatusInput;

    const document = await documentService.updateDocumentStatus(
      userId,
      id,
      body,
      workspaceId,
    );
    sendSuccess(res, { document }, 200, 'Document status updated successfully');
  });

  /**
   * Returns a presigned download URL for secure file access.
   */
  getDownloadUrl = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const { id, workspaceId } = req.params as { id: string; workspaceId?: string };
    const query = req.query as unknown as DownloadUrlQuery;

    const result = await documentService.getPresignedDownloadUrl({
      userId,
      documentId: id,
      workspaceId,
      baseUrl: getBaseUrl(req),
      inline: query.inline === 'true',
      expiresInSeconds: query.expiresInSeconds,
    });

    sendSuccess(res, result, 200, 'Presigned download URL generated');
  });

  /**
   * Streams the file using a verified local presigned download token.
   */
  handleLocalPresignedDownload = asyncHandler(
    async (req: Request, res: Response) => {
      const { id } = req.params as { id: string };
      const query = req.query as unknown as LocalPresignedDownloadQuery;

      const doc = await documentService.verifyLocalPresignedDownload({
        documentId: id,
        expiresAtMs: query.expires,
        signature: query.sig,
      });

      const safeName = sanitizeFileName(doc.originalName);
      res.setHeader('Content-Type', doc.mimeType);
      res.setHeader(
        'Content-Disposition',
        `${query.disposition ?? 'attachment'}; filename="${safeName}"`,
      );

      const stream = storageService.createLocalReadStream(doc.storageKey);
      stream.pipe(res);
    },
  );

  /**
   * Deletes a document from both Object Storage and MongoDB.
   */
  remove = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const { id, workspaceId } = req.params as { id: string; workspaceId?: string };

    await documentService.deleteDocument(userId, id, workspaceId);
    sendSuccess(res, null, 200, 'Document deleted successfully');
  });
}

export const documentController = new DocumentController();

