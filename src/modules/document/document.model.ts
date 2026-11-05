import mongoose, { Document, Schema } from 'mongoose';
import { ALLOWED_MIME_TYPES, AllowedMimeType } from '../../common/utils/fileValidator';

export const DOCUMENT_STATUSES = [
  'pending_upload',
  'uploaded',
  'processing',
  'ready',
  'failed',
] as const;

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export interface IDocument extends Document {
  _id: mongoose.Types.ObjectId;
  workspaceId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  originalName: string;
  storageKey: string;
  mimeType: AllowedMimeType;
  fileSize: number;
  contentHash?: string | null;
  status: DocumentStatus;
  uploadProgress: number;
  chunkCount: number;
  processingError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const documentSchema = new Schema<IDocument>(
  {
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: 'Workspace',
      required: [true, 'Workspace ID is required'],
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    originalName: {
      type: String,
      required: [true, 'Original file name is required'],
      trim: true,
      maxlength: [255, 'Original file name cannot exceed 255 characters'],
    },
    storageKey: {
      type: String,
      required: [true, 'Storage key is required'],
      unique: true,
      trim: true,
    },
    mimeType: {
      type: String,
      enum: ALLOWED_MIME_TYPES,
      required: [true, 'MIME type is required'],
    },
    fileSize: {
      type: Number,
      required: [true, 'File size is required'],
      min: [1, 'File size must be at least 1 byte'],
    },
    contentHash: {
      type: String,
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: DOCUMENT_STATUSES,
      default: 'uploaded',
      index: true,
    },
    uploadProgress: {
      type: Number,
      min: 0,
      max: 100,
      default: 100,
    },
    chunkCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    processingError: {
      type: String,
      default: null,
    },
  },
  {
    collection: 'documents',
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = String(ret._id);
        ret.workspaceId = String(ret.workspaceId);
        ret.userId = String(ret.userId);
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);

// Compound indexes for workspace listing, duplicate detection, and filtering
documentSchema.index({ workspaceId: 1, status: 1, createdAt: -1 });
documentSchema.index({ workspaceId: 1, contentHash: 1 });
documentSchema.index({ workspaceId: 1, originalName: 1, fileSize: 1 });

export const DocumentModel = mongoose.model<IDocument>('Document', documentSchema);

