import mongoose from 'mongoose';
import { AppError } from '../../common/errors/AppError';
import { UploadedFile } from '../../common/middlewares/multipartUpload';
import {
  PresignedUrlResult,
  storageService,
} from '../../common/storage/storage.service';
import {
  computeSha256,
  validateFileMagicBytes,
  validateFileMetadata,
  validateFileSize,
} from '../../common/utils/fileValidator';
import { WorkspaceModel } from '../workspace/workspace.model';
import { DocumentModel, IDocument } from './document.model';
import { chunkService } from '../chunk/chunk.service';
import {
  ListDocumentsQuery,
  PresignFileItemInput,
  UpdateDocumentStatusInput,
} from './document.schema';

export interface DuplicateDocumentSkip {
  originalName: string;
  existingDocumentId: string;
  reason: string;
}

export interface MultiUploadResult {
  uploaded: IDocument[];
  duplicatesSkipped: DuplicateDocumentSkip[];
}

export interface PresignedUploadTicket {
  document: IDocument;
  upload: PresignedUrlResult;
}

export interface PaginatedDocuments {
  documents: IDocument[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class DocumentService {
  /**
   * Verifies that the workspace exists and belongs to the requesting user.
   */
  private async verifyWorkspaceOwnership(
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    const workspace = await WorkspaceModel.findById(workspaceId);
    if (!workspace) {
      throw AppError.notFound('Workspace not found');
    }

    if (String(workspace.userId) !== userId) {
      throw AppError.forbidden(
        'You do not have permission to access this workspace',
      );
    }
  }

  /**
   * Fetches a document by ID and enforces strict user ownership isolation.
   */
  private async getOwnedDocumentOrThrow(
    userId: string,
    documentId: string,
    workspaceId?: string,
  ): Promise<IDocument> {
    const doc = await DocumentModel.findById(documentId);
    if (!doc) {
      throw AppError.notFound('Document not found');
    }

    if (String(doc.userId) !== userId) {
      throw AppError.forbidden(
        'You do not have permission to access this document',
      );
    }

    if (workspaceId && String(doc.workspaceId) !== workspaceId) {
      throw AppError.notFound('Document not found in the specified workspace');
    }

    return doc;
  }

  /**
   * Checks whether an identical file already exists in the same workspace.
   */
  private async findDuplicateInWorkspace(params: {
    workspaceId: string;
    contentHash?: string | null;
    originalName: string;
    fileSize: number;
  }): Promise<IDocument | null> {
    const wsId = new mongoose.Types.ObjectId(params.workspaceId);

    if (params.contentHash) {
      const byHash = await DocumentModel.findOne({
        workspaceId: wsId,
        contentHash: params.contentHash,
        status: { $ne: 'failed' },
      });
      if (byHash) return byHash;
    }

    return DocumentModel.findOne({
      workspaceId: wsId,
      originalName: params.originalName,
      fileSize: params.fileSize,
      status: { $ne: 'failed' },
    });
  }

  /**
   * Handles single or multiple multipart file uploads:
   * - Validates workspace ownership
   * - Detects duplicate uploads within the workspace
   * - Uploads bytes to Object Storage (outside MongoDB)
   * - Persists metadata in the `documents` collection
   */
  async uploadMultipartFiles(params: {
    userId: string;
    workspaceId: string;
    files: UploadedFile[];
    allowDuplicate?: boolean;
  }): Promise<MultiUploadResult> {
    await this.verifyWorkspaceOwnership(params.userId, params.workspaceId);

    const uploaded: IDocument[] = [];
    const duplicatesSkipped: DuplicateDocumentSkip[] = [];

    for (const file of params.files) {
      if (!params.allowDuplicate) {
        const duplicate = await this.findDuplicateInWorkspace({
          workspaceId: params.workspaceId,
          contentHash: file.contentHash,
          originalName: file.originalName,
          fileSize: file.size,
        });

        if (duplicate) {
          if (params.files.length === 1) {
            throw AppError.conflict(
              `Duplicate document "${file.originalName}" already exists in this workspace`,
              { existingDocumentId: String(duplicate._id) },
            );
          }

          duplicatesSkipped.push({
            originalName: file.originalName,
            existingDocumentId: String(duplicate._id),
            reason: 'Identical file already exists in workspace',
          });
          continue;
        }
      }

      const storageKey = storageService.generateStorageKey(
        params.workspaceId,
        file.originalName,
      );

      await storageService.putObject(storageKey, file.buffer, file.mimeType);

      const doc = await DocumentModel.create({
        workspaceId: new mongoose.Types.ObjectId(params.workspaceId),
        userId: new mongoose.Types.ObjectId(params.userId),
        originalName: file.originalName,
        storageKey,
        mimeType: file.mimeType,
        fileSize: file.size,
        contentHash: file.contentHash,
        status: 'uploaded',
        uploadProgress: 100,
        processingError: null,
      });

      uploaded.push(doc);
    }

    if (uploaded.length > 0) {
      await WorkspaceModel.findByIdAndUpdate(params.workspaceId, {
        $set: { updatedAt: new Date() },
      });
    }

    return { uploaded, duplicatesSkipped };
  }

  /**
   * Initiates presigned URL upload(s) for single or multiple files.
   * Creates document record(s) in `pending_upload` state and returns presigned PUT URLs.
   */
  async createPresignedUploads(params: {
    userId: string;
    workspaceId: string;
    files: PresignFileItemInput[];
    allowDuplicate?: boolean;
    baseUrl: string;
  }): Promise<{
    tickets: PresignedUploadTicket[];
    duplicatesSkipped: DuplicateDocumentSkip[];
  }> {
    await this.verifyWorkspaceOwnership(params.userId, params.workspaceId);

    const tickets: PresignedUploadTicket[] = [];
    const duplicatesSkipped: DuplicateDocumentSkip[] = [];

    for (const item of params.files) {
      const { mimeType } = validateFileMetadata({
        originalName: item.originalName,
        mimeType: item.mimeType,
        fileSize: item.fileSize,
      });

      if (!params.allowDuplicate) {
        const duplicate = await this.findDuplicateInWorkspace({
          workspaceId: params.workspaceId,
          contentHash: item.contentHash,
          originalName: item.originalName,
          fileSize: item.fileSize,
        });

        if (duplicate) {
          if (params.files.length === 1) {
            throw AppError.conflict(
              `Duplicate document "${item.originalName}" already exists in this workspace`,
              { existingDocumentId: String(duplicate._id) },
            );
          }

          duplicatesSkipped.push({
            originalName: item.originalName,
            existingDocumentId: String(duplicate._id),
            reason: 'Identical file already exists in workspace',
          });
          continue;
        }
      }

      const storageKey = storageService.generateStorageKey(
        params.workspaceId,
        item.originalName,
      );

      const doc = await DocumentModel.create({
        workspaceId: new mongoose.Types.ObjectId(params.workspaceId),
        userId: new mongoose.Types.ObjectId(params.userId),
        originalName: item.originalName,
        storageKey,
        mimeType,
        fileSize: item.fileSize,
        contentHash: item.contentHash ?? null,
        status: 'pending_upload',
        uploadProgress: 0,
        processingError: null,
      });

      const upload = storageService.getPresignedUploadUrl({
        baseUrl: params.baseUrl,
        documentId: String(doc._id),
        storageKey,
        mimeType,
        fileSize: item.fileSize,
      });

      tickets.push({ document: doc, upload });
    }

    return { tickets, duplicatesSkipped };
  }

  /**
   * Handles a direct binary PUT upload to a local presigned URL (`STORAGE_PROVIDER=local`).
   */
  async handleLocalPresignedPut(params: {
    documentId: string;
    expiresAtMs: number;
    mimeType: string;
    maxFileSize: number;
    signature: string;
    buffer: Buffer;
  }): Promise<IDocument> {
    const doc = await DocumentModel.findById(params.documentId);
    if (!doc) {
      throw AppError.notFound('Document not found');
    }

    const isValidSig = storageService.verifyLocalPresignedToken({
      action: 'upload',
      documentId: params.documentId,
      storageKey: doc.storageKey,
      expiresAtMs: params.expiresAtMs,
      mimeType: params.mimeType,
      maxFileSize: params.maxFileSize,
      signature: params.signature,
    });

    if (!isValidSig) {
      throw AppError.forbidden('Invalid or expired presigned upload URL');
    }

    validateFileSize(params.buffer.length, params.maxFileSize);
    validateFileMagicBytes(params.buffer, doc.mimeType);

    await storageService.putObject(doc.storageKey, params.buffer, doc.mimeType);

    doc.fileSize = params.buffer.length;
    doc.contentHash = computeSha256(params.buffer);
    doc.status = 'uploaded';
    doc.uploadProgress = 100;
    doc.processingError = null;
    await doc.save();

    await WorkspaceModel.findByIdAndUpdate(doc.workspaceId, {
      $set: { updatedAt: new Date() },
    });

    return doc;
  }

  /**
   * Confirms that a presigned upload has completed in Object Storage and advances
   * the document lifecycle from `pending_upload` -> `uploaded`.
   */
  async confirmUpload(
    userId: string,
    documentId: string,
    workspaceId?: string,
  ): Promise<IDocument> {
    const doc = await this.getOwnedDocumentOrThrow(userId, documentId, workspaceId);

    const stat = await storageService.statObject(doc.storageKey);
    if (!stat.exists) {
      doc.status = 'failed';
      doc.processingError = 'File object was not found in object storage';
      await doc.save();
      throw AppError.badRequest(
        'Upload confirmation failed: file not found in object storage',
      );
    }

    if (stat.size > 0) {
      doc.fileSize = stat.size;
    }
    if (doc.status === 'pending_upload') {
      doc.status = 'uploaded';
    }
    doc.uploadProgress = 100;
    doc.processingError = null;
    await doc.save();

    return doc;
  }

  /**
   * Lists documents belonging to the user (optionally scoped to a workspace).
   */
  async listDocuments(
    userId: string,
    query: ListDocumentsQuery,
  ): Promise<PaginatedDocuments> {
    const {
      workspaceId,
      status,
      mimeType,
      search,
      q,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    if (workspaceId) {
      await this.verifyWorkspaceOwnership(userId, workspaceId);
    }

    const filter: Record<string, unknown> = {
      userId: new mongoose.Types.ObjectId(userId),
    };

    if (workspaceId) {
      filter.workspaceId = new mongoose.Types.ObjectId(workspaceId);
    }
    if (status) {
      filter.status = status;
    }
    if (mimeType) {
      filter.mimeType = mimeType;
    }

    const searchTerm = (search ?? q)?.trim();
    if (searchTerm) {
      filter.originalName = new RegExp(escapeRegex(searchTerm), 'i');
    }

    const skip = (page - 1) * limit;
    const sortDirection = sortOrder === 'asc' ? 1 : -1;

    const [documents, total] = await Promise.all([
      DocumentModel.find(filter)
        .sort({ [sortBy]: sortDirection })
        .skip(skip)
        .limit(limit),
      DocumentModel.countDocuments(filter),
    ]);

    return {
      documents,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Retrieves a single document's details.
   */
  async getDocumentById(
    userId: string,
    documentId: string,
    workspaceId?: string,
  ): Promise<IDocument> {
    return this.getOwnedDocumentOrThrow(userId, documentId, workspaceId);
  }

  /**
   * Retrieves upload & processing status for a document.
   */
  async getDocumentStatus(
    userId: string,
    documentId: string,
    workspaceId?: string,
  ): Promise<{
    id: string;
    workspaceId: string;
    originalName: string;
    status: string;
    uploadProgress: number;
    processingError: string | null;
    updatedAt: Date;
  }> {
    const doc = await this.getOwnedDocumentOrThrow(userId, documentId, workspaceId);
    return {
      id: String(doc._id),
      workspaceId: String(doc.workspaceId),
      originalName: doc.originalName,
      status: doc.status,
      uploadProgress: doc.uploadProgress,
      processingError: doc.processingError,
      updatedAt: doc.updatedAt,
    };
  }

  /**
   * Updates document upload progress or lifecycle status (`pending_upload` -> `uploaded` -> `processing` -> `ready` | `failed`).
   */
  async updateDocumentStatus(
    userId: string,
    documentId: string,
    input: UpdateDocumentStatusInput,
    workspaceId?: string,
  ): Promise<IDocument> {
    const doc = await this.getOwnedDocumentOrThrow(userId, documentId, workspaceId);

    if (input.status !== undefined) {
      doc.status = input.status;
      if (input.status === 'uploaded' || input.status === 'ready') {
        doc.uploadProgress = 100;
      }
    }

    if (input.uploadProgress !== undefined) {
      doc.uploadProgress = input.uploadProgress;
    }

    if (input.processingError !== undefined) {
      doc.processingError = input.processingError;
    }

    await doc.save();
    return doc;
  }

  /**
   * Generates a time-limited presigned download URL for secure file access.
   */
  async getPresignedDownloadUrl(params: {
    userId: string;
    documentId: string;
    workspaceId?: string;
    baseUrl: string;
    inline?: boolean;
    expiresInSeconds?: number;
  }): Promise<PresignedUrlResult & { documentId: string; originalName: string }> {
    const doc = await this.getOwnedDocumentOrThrow(
      params.userId,
      params.documentId,
      params.workspaceId,
    );

    if (doc.status === 'pending_upload') {
      throw AppError.badRequest('Document upload has not completed yet');
    }

    const presigned = storageService.getPresignedDownloadUrl({
      baseUrl: params.baseUrl,
      documentId: String(doc._id),
      storageKey: doc.storageKey,
      originalName: doc.originalName,
      mimeType: doc.mimeType,
      expiresInSeconds: params.expiresInSeconds,
      inline: params.inline,
    });

    return {
      ...presigned,
      documentId: String(doc._id),
      originalName: doc.originalName,
    };
  }

  /**
   * Verifies a local presigned download token and returns the document metadata.
   */
  async verifyLocalPresignedDownload(params: {
    documentId: string;
    expiresAtMs: number;
    signature: string;
  }): Promise<IDocument> {
    const doc = await DocumentModel.findById(params.documentId);
    if (!doc) {
      throw AppError.notFound('Document not found');
    }

    const isValidSig = storageService.verifyLocalPresignedToken({
      action: 'download',
      documentId: params.documentId,
      storageKey: doc.storageKey,
      expiresAtMs: params.expiresAtMs,
      mimeType: doc.mimeType,
      signature: params.signature,
    });

    if (!isValidSig) {
      throw AppError.forbidden('Invalid or expired presigned download URL');
    }

    return doc;
  }

  /**
   * Deletes a document from both Object Storage and MongoDB.
   */
  async deleteDocument(
    userId: string,
    documentId: string,
    workspaceId?: string,
  ): Promise<void> {
    const doc = await this.getOwnedDocumentOrThrow(userId, documentId, workspaceId);

    await storageService.deleteObject(doc.storageKey);
    await chunkService.deleteChunksByDocument(String(doc._id));
    await doc.deleteOne();
  }

  /**
   * Deletes all documents and stored objects belonging to a workspace (used during workspace deletion).
   */
  async deleteAllWorkspaceDocuments(workspaceId: string): Promise<number> {
    const wsObjectId = new mongoose.Types.ObjectId(workspaceId);
    const docs = await DocumentModel.find({ workspaceId: wsObjectId });

    await Promise.all(
      docs.map((doc) => storageService.deleteObject(doc.storageKey)),
    );

    await chunkService.deleteChunksByWorkspace(workspaceId);

    const result = await DocumentModel.deleteMany({ workspaceId: wsObjectId });
    return result.deletedCount ?? 0;
  }
}

export const documentService = new DocumentService();

