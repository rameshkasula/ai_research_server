export interface LlmCallRecord {
  timestamp: string;
  model: string;
  operation: string;
  promptVersion: string;
  promptTokens: number;
  responseTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  durationMs: number;
  success: boolean;
  userId?: string;
  workspaceId?: string;
}

export interface GroundednessEvaluation {
  isGrounded: boolean;
  citationCount: number;
  retrievalAvgScore: number;
  confidenceScore: number;
  warnings: string[];
}

// Estimated pricing per 1M tokens (USD) for cost tracking
const MODEL_PRICING_PER_1M: Record<string, { input: number; output: number }> = {
  'gemini-2.5-flash': { input: 0.15, output: 0.60 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
  'gemini-1.5-pro': { input: 1.25, output: 5.00 },
  'text-embedding-004': { input: 0.02, output: 0.0 },
};

export const PROMPT_VERSIONS = {
  RAG_QA: 'rag-qa-v2.1',
  CHAT_CONVERSATION: 'chat-multi-turn-v2.0',
  WEB_SUMMARY: 'web-summary-v1.2',
  RESEARCH_AGENT_PLANNER: 'agent-planner-v1.4',
  RESEARCH_AGENT_SYNTHESIS: 'agent-synthesis-v1.4',
  REPORT_GENERATOR: 'report-generator-v1.3',
} as const;

const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /disregard\s+(all\s+)?(previous|prior|system)\s+instructions/i,
  /reveal\s+(your\s+)?(system\s+prompt|secret\s+key|api\s+key)/i,
  /you\s+are\s+now\s+in\s+developer\s+mode/i,
];

export class AiTelemetryService {
  private readonly records: LlmCallRecord[] = [];
  private readonly maxRecords = 2000;

  estimateCostUsd(model: string, promptTokens: number, responseTokens: number): number {
    const pricing = MODEL_PRICING_PER_1M[model] ?? { input: 0.15, output: 0.60 };
    const cost =
      (promptTokens / 1_000_000) * pricing.input +
      (responseTokens / 1_000_000) * pricing.output;
    return Number(cost.toFixed(8));
  }

  recordCall(entry: Omit<LlmCallRecord, 'timestamp' | 'estimatedCostUsd'>): LlmCallRecord {
    const estimatedCostUsd = this.estimateCostUsd(
      entry.model,
      entry.promptTokens,
      entry.responseTokens,
    );

    const record: LlmCallRecord = {
      ...entry,
      estimatedCostUsd,
      timestamp: new Date().toISOString(),
    };

    if (this.records.length >= this.maxRecords) {
      this.records.shift();
    }
    this.records.push(record);
    return record;
  }

  getUsageSummary(userId?: string): {
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    totalPromptTokens: number;
    totalResponseTokens: number;
    totalTokens: number;
    totalEstimatedCostUsd: number;
    averageLatencyMs: number;
    promptVersions: typeof PROMPT_VERSIONS;
    recentCalls: LlmCallRecord[];
  } {
    const filtered = userId
      ? this.records.filter((r) => !r.userId || r.userId === userId)
      : this.records;

    let totalPromptTokens = 0;
    let totalResponseTokens = 0;
    let totalTokens = 0;
    let totalCost = 0;
    let totalDuration = 0;
    let successfulCalls = 0;

    for (const r of filtered) {
      totalPromptTokens += r.promptTokens;
      totalResponseTokens += r.responseTokens;
      totalTokens += r.totalTokens;
      totalCost += r.estimatedCostUsd;
      totalDuration += r.durationMs;
      if (r.success) successfulCalls++;
    }

    return {
      totalCalls: filtered.length,
      successfulCalls,
      failedCalls: filtered.length - successfulCalls,
      totalPromptTokens,
      totalResponseTokens,
      totalTokens,
      totalEstimatedCostUsd: Number(totalCost.toFixed(6)),
      averageLatencyMs:
        filtered.length > 0 ? Math.round(totalDuration / filtered.length) : 0,
      promptVersions: PROMPT_VERSIONS,
      recentCalls: filtered.slice(-20).reverse(),
    };
  }

  /**
   * Detects and neutralizes direct prompt injection attempts in user inputs or external text.
   */
  sanitizePromptInput(text: string): {
    sanitizedText: string;
    injectionDetected: boolean;
  } {
    let injectionDetected = false;
    let sanitizedText = text;

    for (const pattern of PROMPT_INJECTION_PATTERNS) {
      if (pattern.test(sanitizedText)) {
        injectionDetected = true;
        sanitizedText = sanitizedText.replace(pattern, '[REDACTED_INJECTION_ATTEMPT]');
      }
    }

    return { sanitizedText, injectionDetected };
  }

  /**
   * Evaluates RAG answer groundedness, citation presence, and retrieval confidence.
   */
  evaluateGroundedness(params: {
    answer: string;
    retrievalScores: number[];
    sourceCount: number;
  }): GroundednessEvaluation {
    const warnings: string[] = [];
    const citationMatches = params.answer.match(/\[Source:[^\]]+\]/gi) ?? [];
    const citationCount = citationMatches.length;

    const avgScore =
      params.retrievalScores.length > 0
        ? params.retrievalScores.reduce((a, b) => a + b, 0) /
          params.retrievalScores.length
        : 0;

    const isInsufficientResponse =
      /do not contain enough information/i.test(params.answer);

    if (params.sourceCount > 0 && citationCount === 0 && !isInsufficientResponse) {
      warnings.push('Answer generated without explicit inline [Source: ...] citations');
    }

    if (avgScore > 0 && avgScore < 0.6) {
      warnings.push('Low average retrieval similarity score (< 0.60)');
    }

    const confidenceScore = isInsufficientResponse
      ? 1.0
      : Number(
          Math.min(
            1,
            avgScore * 0.7 + (citationCount > 0 ? 0.3 : 0.1),
          ).toFixed(2),
        );

    return {
      isGrounded: params.sourceCount > 0 && (citationCount > 0 || isInsufficientResponse),
      citationCount,
      retrievalAvgScore: Number(avgScore.toFixed(4)),
      confidenceScore,
      warnings,
    };
  }
}

export const aiTelemetryService = new AiTelemetryService();

