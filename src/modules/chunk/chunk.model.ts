import mongoose, { Document, Schema } from 'mongoose';

export interface IChunkMetadata {
  originalName: string;
  mimeType: string;
  pageNumber?: number;
  startChar: number;
  endChar: number;
}

export interface IChunk extends Document {
  _id: mongoose.Types.ObjectId;
  documentId: mongoose.Types.ObjectId;
  workspaceId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  chunkIndex: number;
  text: string;
  embedding: number[];
  tokenCount: number;
  metadata: IChunkMetadata;
  createdAt: Date;
  updatedAt: Date;
}

const chunkMetadataSchema = new Schema<IChunkMetadata>(
  {
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    pageNumber: { type: Number },
    startChar: { type: Number, required: true },
    endChar: { type: Number, required: true },
  },
  { _id: false },
);

const chunkSchema = new Schema<IChunk>(
  {
    documentId: {
      type: Schema.Types.ObjectId,
      ref: 'Document',
      required: [true, 'Document ID is required'],
      index: true,
    },
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
    chunkIndex: {
      type: Number,
      required: [true, 'Chunk index is required'],
      min: 0,
    },
    text: {
      type: String,
      required: [true, 'Chunk text is required'],
      trim: true,
    },
    embedding: {
      type: [Number],
      required: [true, 'Chunk embedding is required'],
      validate: {
        validator: (v: number[]) => Array.isArray(v) && v.length > 0,
        message: 'Embedding must be a non-empty array of numbers',
      },
    },
    tokenCount: {
      type: Number,
      required: true,
      min: 0,
    },
    metadata: {
      type: chunkMetadataSchema,
      required: true,
    },
  },
  {
    collection: 'chunks',
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = String(ret._id);
        ret.documentId = String(ret.documentId);
        ret.workspaceId = String(ret.workspaceId);
        ret.userId = String(ret.userId);
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);

// Compound indexes
chunkSchema.index({ documentId: 1, chunkIndex: 1 }, { unique: true });
chunkSchema.index({ workspaceId: 1, createdAt: -1 });
chunkSchema.index({ userId: 1, workspaceId: 1 });

export const ChunkModel = mongoose.model<IChunk>('Chunk', chunkSchema);

