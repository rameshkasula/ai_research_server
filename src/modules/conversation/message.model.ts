import mongoose, { Document, Schema } from 'mongoose';

export const MESSAGE_ROLES = ['user', 'assistant', 'system'] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

export const MESSAGE_STATUSES = [
  'pending',
  'streaming',
  'completed',
  'failed',
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export interface IMessageSource {
  documentId: string;
  workspaceId: string;
  originalName: string;
  pageNumber?: number | null;
  chunkIndex: number;
  similarityScore: number;
  relevanceScore: number;
  textSnippet: string;
  startChar?: number;
  endChar?: number;
}

export interface IMessage extends Document {
  _id: mongoose.Types.ObjectId;
  conversationId: mongoose.Types.ObjectId;
  workspaceId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  role: MessageRole;
  content: string;
  sources: IMessageSource[];
  status: MessageStatus;
  errorMessage?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const messageSourceSchema = new Schema<IMessageSource>(
  {
    documentId: { type: String, required: true },
    workspaceId: { type: String, required: true },
    originalName: { type: String, required: true },
    pageNumber: { type: Number, default: null },
    chunkIndex: { type: Number, required: true },
    similarityScore: { type: Number, required: true },
    relevanceScore: { type: Number, required: true },
    textSnippet: { type: String, required: true },
    startChar: { type: Number, default: 0 },
    endChar: { type: Number, default: 0 },
  },
  { _id: false },
);

const messageSchema = new Schema<IMessage>(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      required: [true, 'Conversation ID is required'],
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
    role: {
      type: String,
      enum: MESSAGE_ROLES,
      required: [true, 'Message role is required'],
    },
    content: {
      type: String,
      required: true,
      default: '',
    },
    sources: {
      type: [messageSourceSchema],
      default: [],
    },
    status: {
      type: String,
      enum: MESSAGE_STATUSES,
      default: 'completed',
      index: true,
    },
    errorMessage: {
      type: String,
      default: null,
    },
  },
  {
    collection: 'messages',
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = String(ret._id);
        ret.conversationId = String(ret.conversationId);
        ret.workspaceId = String(ret.workspaceId);
        ret.userId = String(ret.userId);
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);

messageSchema.index({ conversationId: 1, createdAt: 1 });
messageSchema.index({ workspaceId: 1, createdAt: -1 });

export const MessageModel = mongoose.model<IMessage>('Message', messageSchema);

