import mongoose, { Document, Schema } from 'mongoose';

export const WORKSPACE_STATUSES = ['active', 'archived'] as const;
export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];

export interface IWorkspace extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  name: string;
  description: string;
  status: WorkspaceStatus;
  createdAt: Date;
  updatedAt: Date;
}

const workspaceSchema = new Schema<IWorkspace>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Workspace name is required'],
      trim: true,
      minlength: [1, 'Workspace name cannot be empty'],
      maxlength: [120, 'Workspace name cannot exceed 120 characters'],
    },
    description: {
      type: String,
      trim: true,
      default: '',
      maxlength: [1000, 'Workspace description cannot exceed 1000 characters'],
    },
    status: {
      type: String,
      enum: WORKSPACE_STATUSES,
      default: 'active',
      index: true,
    },
  },
  {
    collection: 'workspaces',
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = String(ret._id);
        ret.userId = String(ret.userId);
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);

// Compound index for fast per-user listing, filtering, and search
workspaceSchema.index({ userId: 1, status: 1, updatedAt: -1 });
workspaceSchema.index({ name: 'text', description: 'text' });

export const WorkspaceModel = mongoose.model<IWorkspace>('Workspace', workspaceSchema);

