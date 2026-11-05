import mongoose, { Document, Schema } from 'mongoose';

export interface IConversation extends Document {
  _id: mongoose.Types.ObjectId;
  workspaceId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

const conversationSchema = new Schema<IConversation>(
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
    title: {
      type: String,
      required: [true, 'Conversation title is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
      default: 'New Research Chat',
    },
  },
  {
    collection: 'conversations',
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

conversationSchema.index({ workspaceId: 1, updatedAt: -1 });
conversationSchema.index({ userId: 1, updatedAt: -1 });

export const ConversationModel = mongoose.model<IConversation>(
  'Conversation',
  conversationSchema,
);

