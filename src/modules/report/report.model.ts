import mongoose, { Document, Schema } from 'mongoose';

export const REPORT_SECTION_KEYS = [
  'executiveSummary',
  'researchObjective',
  'methodology',
  'keyFindings',
  'marketAnalysis',
  'competitorComparison',
  'opportunities',
  'risks',
  'recommendations',
  'conclusion',
  'references',
] as const;

export type ReportSectionKey = (typeof REPORT_SECTION_KEYS)[number];

export interface IReportSections {
  executiveSummary: string;
  researchObjective: string;
  methodology: string;
  keyFindings: string;
  marketAnalysis: string;
  competitorComparison: string;
  opportunities: string;
  risks: string;
  recommendations: string;
  conclusion: string;
  references: string;
}

export interface IReportSource {
  sourceType: 'document' | 'web';
  title: string;
  reference: string;
  snippet: string;
}

export interface IReportShareSettings {
  isPublic: boolean;
  shareToken: string | null;
  expiresAt: Date | null;
  allowDownload: boolean;
}

export interface IReport extends Document {
  _id: mongoose.Types.ObjectId;
  workspaceId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  conversationId?: mongoose.Types.ObjectId | null;
  agentRunId?: mongoose.Types.ObjectId | null;
  title: string;
  objective: string;
  status: 'generating' | 'ready' | 'failed';
  sections: IReportSections;
  sources: IReportSource[];
  shareSettings: IReportShareSettings;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const reportSectionsSchema = new Schema<IReportSections>(
  {
    executiveSummary: { type: String, default: '' },
    researchObjective: { type: String, default: '' },
    methodology: { type: String, default: '' },
    keyFindings: { type: String, default: '' },
    marketAnalysis: { type: String, default: '' },
    competitorComparison: { type: String, default: '' },
    opportunities: { type: String, default: '' },
    risks: { type: String, default: '' },
    recommendations: { type: String, default: '' },
    conclusion: { type: String, default: '' },
    references: { type: String, default: '' },
  },
  { _id: false },
);

const reportSourceSchema = new Schema<IReportSource>(
  {
    sourceType: { type: String, enum: ['document', 'web'], required: true },
    title: { type: String, required: true },
    reference: { type: String, required: true },
    snippet: { type: String, default: '' },
  },
  { _id: false },
);

const reportShareSettingsSchema = new Schema<IReportShareSettings>(
  {
    isPublic: { type: Boolean, default: false },
    shareToken: { type: String, default: null, index: true },
    expiresAt: { type: Date, default: null },
    allowDownload: { type: Boolean, default: true },
  },
  { _id: false },
);

const reportSchema = new Schema<IReport>(
  {
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      default: null,
    },
    agentRunId: {
      type: Schema.Types.ObjectId,
      ref: 'AgentRun',
      default: null,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 250,
    },
    objective: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ['generating', 'ready', 'failed'],
      default: 'ready',
    },
    sections: {
      type: reportSectionsSchema,
      required: true,
    },
    sources: {
      type: [reportSourceSchema],
      default: [],
    },
    shareSettings: {
      type: reportShareSettingsSchema,
      default: () => ({
        isPublic: false,
        shareToken: null,
        expiresAt: null,
        allowDownload: true,
      }),
    },
    version: {
      type: Number,
      default: 1,
    },
  },
  {
    collection: 'reports',
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = String(ret._id);
        ret.workspaceId = String(ret.workspaceId);
        ret.userId = String(ret.userId);
        if (ret.conversationId) ret.conversationId = String(ret.conversationId);
        if (ret.agentRunId) ret.agentRunId = String(ret.agentRunId);
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);

reportSchema.index({ workspaceId: 1, createdAt: -1 });
reportSchema.index({ userId: 1, createdAt: -1 });

export const ReportModel = mongoose.model<IReport>('Report', reportSchema);

