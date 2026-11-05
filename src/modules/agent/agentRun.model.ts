import mongoose, { Document, Schema } from 'mongoose';

export const AGENT_TOOLS = [
  'search_web',
  'retrieve_documents',
  'read_source',
  'summarize',
  'compare',
  'generate_report',
] as const;

export type AgentToolName = (typeof AGENT_TOOLS)[number];

export const AGENT_RUN_STATUSES = [
  'planning',
  'awaiting_approval',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;

export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export interface IAgentPlanStep {
  stepNumber: number;
  tool: AgentToolName;
  description: string;
  queryOrInput: string;
}

export interface IAgentExecutionStep {
  stepNumber: number;
  tool: AgentToolName;
  input: string;
  outputSummary: string;
  status: 'completed' | 'failed' | 'skipped';
  durationMs: number;
  timestamp: Date;
}

export interface IAgentCitation {
  sourceType: 'document' | 'web';
  id: string;
  title: string;
  urlOrFile: string;
  snippet: string;
  score: number;
}

export interface IAgentRun extends Document {
  _id: mongoose.Types.ObjectId;
  workspaceId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  objective: string;
  status: AgentRunStatus;
  requireApproval: boolean;
  maxSteps: number;
  plan: IAgentPlanStep[];
  steps: IAgentExecutionStep[];
  missingInformation: string[];
  compiledFindings: string;
  comparisonMatrix?: string;
  sources: IAgentCitation[];
  tokenUsage: {
    promptTokens: number;
    responseTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const planStepSchema = new Schema<IAgentPlanStep>(
  {
    stepNumber: { type: Number, required: true },
    tool: { type: String, enum: AGENT_TOOLS, required: true },
    description: { type: String, required: true },
    queryOrInput: { type: String, required: true },
  },
  { _id: false },
);

const executionStepSchema = new Schema<IAgentExecutionStep>(
  {
    stepNumber: { type: Number, required: true },
    tool: { type: String, enum: AGENT_TOOLS, required: true },
    input: { type: String, required: true },
    outputSummary: { type: String, required: true },
    status: {
      type: String,
      enum: ['completed', 'failed', 'skipped'],
      required: true,
    },
    durationMs: { type: Number, required: true },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false },
);

const agentCitationSchema = new Schema<IAgentCitation>(
  {
    sourceType: { type: String, enum: ['document', 'web'], required: true },
    id: { type: String, required: true },
    title: { type: String, required: true },
    urlOrFile: { type: String, required: true },
    snippet: { type: String, required: true },
    score: { type: Number, default: 0.8 },
  },
  { _id: false },
);

const agentRunSchema = new Schema<IAgentRun>(
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
    objective: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: AGENT_RUN_STATUSES,
      default: 'planning',
      index: true,
    },
    requireApproval: {
      type: Boolean,
      default: false,
    },
    maxSteps: {
      type: Number,
      default: 8,
      min: 1,
      max: 20,
    },
    plan: {
      type: [planStepSchema],
      default: [],
    },
    steps: {
      type: [executionStepSchema],
      default: [],
    },
    missingInformation: {
      type: [String],
      default: [],
    },
    compiledFindings: {
      type: String,
      default: '',
    },
    comparisonMatrix: {
      type: String,
      default: '',
    },
    sources: {
      type: [agentCitationSchema],
      default: [],
    },
    tokenUsage: {
      promptTokens: { type: Number, default: 0 },
      responseTokens: { type: Number, default: 0 },
      totalTokens: { type: Number, default: 0 },
      estimatedCostUsd: { type: Number, default: 0 },
    },
    errorMessage: {
      type: String,
      default: null,
    },
  },
  {
    collection: 'agent_runs',
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

agentRunSchema.index({ workspaceId: 1, createdAt: -1 });
agentRunSchema.index({ userId: 1, createdAt: -1 });

export const AgentRunModel = mongoose.model<IAgentRun>(
  'AgentRun',
  agentRunSchema,
);

