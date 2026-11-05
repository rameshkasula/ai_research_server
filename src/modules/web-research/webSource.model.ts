import mongoose, { Document, Schema } from 'mongoose';

export interface IWebSource extends Document {
  _id: mongoose.Types.ObjectId;
  workspaceId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  query: string;
  url: string;
  domain: string;
  title: string;
  snippet: string;
  extractedText: string;
  summary: string;
  credibilityScore: number;
  relevanceScore: number;
  contentHash: string;
  fetchedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const webSourceSchema = new Schema<IWebSource>(
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
    query: {
      type: String,
      trim: true,
      default: '',
    },
    url: {
      type: String,
      required: [true, 'URL is required'],
      trim: true,
    },
    domain: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    snippet: {
      type: String,
      default: '',
    },
    extractedText: {
      type: String,
      default: '',
    },
    summary: {
      type: String,
      default: '',
    },
    credibilityScore: {
      type: Number,
      min: 0,
      max: 1,
      default: 0.7,
    },
    relevanceScore: {
      type: Number,
      min: 0,
      max: 1,
      default: 0.75,
    },
    contentHash: {
      type: String,
      required: true,
      index: true,
    },
    fetchedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    collection: 'web_sources',
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

webSourceSchema.index({ workspaceId: 1, url: 1 });
webSourceSchema.index({ workspaceId: 1, contentHash: 1 });
webSourceSchema.index({ workspaceId: 1, createdAt: -1 });

export const WebSourceModel = mongoose.model<IWebSource>(
  'WebSource',
  webSourceSchema,
);

