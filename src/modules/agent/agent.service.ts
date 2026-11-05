import mongoose from 'mongoose';
import { env } from '../../config/env';
import { AppError } from '../../common/errors/AppError';
import { geminiLlmService } from '../../common/services/geminiLlm.service';
import { PROMPT_VERSIONS } from '../../common/observability/aiTelemetry.service';
import { logger } from '../../common/utils/logger';
import { WorkspaceModel } from '../workspace/workspace.model';
import { searchService } from '../search/search.service';
import { webResearchService } from '../web-research/webResearch.service';
import { ChunkModel } from '../chunk/chunk.model';
import { WebSourceModel } from '../web-research/webSource.model';
import {
  AgentRunModel,
  AgentToolName,
  IAgentCitation,
  IAgentExecutionStep,
  IAgentPlanStep,
  IAgentRun,
} from './agentRun.model';
import {
  agentGapCheckSchema,
  agentPlanResponseSchema,
  CreateAgentRunInput,
} from './agent.schema';

export class AgentService {
  private async verifyWorkspaceOwnership(
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    const workspace = await WorkspaceModel.findById(workspaceId);
    if (!workspace) {
      throw AppError.notFound('Workspace not found');
    }
    if (String(workspace.userId) !== userId) {
      throw AppError.forbidden('You do not have permission to access this workspace');
    }
  }

  private async getOwnedAgentRunOrThrow(
    userId: string,
    runId: string,
  ): Promise<IAgentRun> {
    const run = await AgentRunModel.findById(runId);
    if (!run) {
      throw AppError.notFound('Agent run not found');
    }
    if (String(run.userId) !== userId) {
      throw AppError.forbidden('You do not have permission to access this agent run');
    }
    return run;
  }

  /**
   * Step 1: Understand the research objective and generate a controlled multi-step plan.
   */
  private async createResearchPlan(params: {
    userId: string;
    workspaceId: string;
    objective: string;
    maxSteps: number;
    includeWeb: boolean;
    includeDocuments: boolean;
  }): Promise<{
    plan: IAgentPlanStep[];
    usage: {
      promptTokens: number;
      responseTokens: number;
      totalTokens: number;
      estimatedCostUsd: number;
    };
  }> {
    const allowedTools: AgentToolName[] = [];
    if (params.includeDocuments) allowedTools.push('retrieve_documents');
    if (params.includeWeb) allowedTools.push('search_web');
    allowedTools.push('read_source', 'summarize', 'compare', 'generate_report');

    const plannerPrompt = `You are a controlled AI Research Planner.
Break down the following research objective into a logical sequence of at most ${params.maxSteps} tool steps.

Research Objective: "${params.objective}"
Allowed Tools: ${allowedTools.join(', ')}

Tool Responsibilities:
- retrieve_documents: Semantic search across uploaded workspace documents
- search_web: Search external websites for market/company/recent data
- read_source: Retrieve full text of top discovered source
- summarize: Summarize collected evidence
- compare: Build structured comparison across entities/metrics
- generate_report: Final synthesis step compiling all findings with citations

Return valid JSON matching:
{
  "plan": [
    {
      "stepNumber": 1,
      "tool": "retrieve_documents" | "search_web" | "read_source" | "summarize" | "compare" | "generate_report",
      "description": "What this step accomplishes",
      "queryOrInput": "Specific search query or instruction for the tool"
    }
  ]
}`;

    try {
      const { data, usage } = await geminiLlmService.generateStructuredJson(
        plannerPrompt,
        agentPlanResponseSchema,
        {
          temperature: 0.1,
          operation: 'agentCreatePlan',
          promptVersion: PROMPT_VERSIONS.RESEARCH_AGENT_PLANNER,
          userId: params.userId,
          workspaceId: params.workspaceId,
        },
      );

      const boundedPlan = data.plan.slice(0, params.maxSteps).map((step, i) => ({
        ...step,
        stepNumber: i + 1,
      }));

      return { plan: boundedPlan, usage };
    } catch {
      // Deterministic fallback plan if structured JSON call fails
      const fallbackPlan: IAgentPlanStep[] = [];
      let stepNum = 1;
      if (params.includeDocuments) {
        fallbackPlan.push({
          stepNumber: stepNum++,
          tool: 'retrieve_documents',
          description: 'Search uploaded workspace documents for relevant evidence',
          queryOrInput: params.objective,
        });
      }
      if (params.includeWeb) {
        fallbackPlan.push({
          stepNumber: stepNum++,
          tool: 'search_web',
          description: 'Search external web sources for up-to-date market and domain facts',
          queryOrInput: params.objective,
        });
      }
      fallbackPlan.push({
        stepNumber: stepNum++,
        tool: 'compare',
        description: 'Compare key entities, metrics, and perspectives',
        queryOrInput: params.objective,
      });
      fallbackPlan.push({
        stepNumber: stepNum++,
        tool: 'generate_report',
        description: 'Compile comprehensive findings with source citations',
        queryOrInput: params.objective,
      });

      return {
        plan: fallbackPlan.slice(0, params.maxSteps),
        usage: {
          promptTokens: 0,
          responseTokens: 0,
          totalTokens: 0,
          estimatedCostUsd: 0,
        },
      };
    }
  }

  /**
   * Executes a single registered tool with retry strategy and returns its output summary.
   */
  private async executeRegisteredTool(params: {
    userId: string;
    workspaceId: string;
    tool: AgentToolName;
    input: string;
    objective: string;
    collectedNotes: string[];
    citations: IAgentCitation[];
  }): Promise<{
    outputSummary: string;
    comparisonMatrix?: string;
    compiledFindings?: string;
    usage?: {
      promptTokens: number;
      responseTokens: number;
      totalTokens: number;
      estimatedCostUsd: number;
    };
  }> {
    const { userId, workspaceId, tool, input, objective, collectedNotes, citations } =
      params;

    switch (tool) {
      case 'retrieve_documents': {
        const searchRes = await searchService.searchWorkspace(userId, workspaceId, {
          query: input || objective,
          topK: 5,
          minScore: 0.45,
        });

        for (const r of searchRes.results) {
          if (!citations.some((c) => c.id === r.id)) {
            citations.push({
              sourceType: 'document',
              id: r.id,
              title: r.metadata.originalName,
              urlOrFile: `${r.metadata.originalName} (Chunk #${r.chunkIndex})`,
              snippet: r.text.slice(0, 280),
              score: r.score,
            });
          }
          collectedNotes.push(
            `[Doc: ${r.metadata.originalName}, Chunk #${r.chunkIndex}]: ${r.text}`,
          );
        }

        return {
          outputSummary: `Retrieved ${searchRes.results.length} relevant passages from workspace documents for "${input}".`,
        };
      }

      case 'search_web': {
        const webRes = await webResearchService.searchAndExtractWeb(
          userId,
          workspaceId,
          {
            query: input || objective,
            maxResults: 4,
            summarize: true,
            storeSources: true,
          },
        );

        for (const s of webRes.sources) {
          const sid = String(s._id);
          if (!citations.some((c) => c.id === sid)) {
            citations.push({
              sourceType: 'web',
              id: sid,
              title: s.title,
              urlOrFile: s.url,
              snippet: (s.summary || s.snippet).slice(0, 280),
              score: s.credibilityScore,
            });
          }
          collectedNotes.push(
            `[Web: ${s.title} (${s.url})]: ${s.summary || s.extractedText.slice(0, 1500)}`,
          );
        }

        return {
          outputSummary: `Searched web for "${input}" and extracted ${webRes.sources.length} verified sources.`,
        };
      }

      case 'read_source': {
        const latestChunk = await ChunkModel.findOne({
          workspaceId: new mongoose.Types.ObjectId(workspaceId),
        }).sort({ createdAt: -1 });

        const latestWeb = await WebSourceModel.findOne({
          workspaceId: new mongoose.Types.ObjectId(workspaceId),
        }).sort({ createdAt: -1 });

        if (latestChunk) {
          collectedNotes.push(
            `[Full Chunk Read - ${latestChunk.metadata.originalName}]: ${latestChunk.text}`,
          );
          return {
            outputSummary: `Read full passage from document "${latestChunk.metadata.originalName}".`,
          };
        }

        if (latestWeb) {
          collectedNotes.push(
            `[Full Web Read - ${latestWeb.title} (${latestWeb.url})]: ${latestWeb.extractedText.slice(0, 2500)}`,
          );
          return {
            outputSummary: `Read full extracted text from web source "${latestWeb.title}".`,
          };
        }

        return {
          outputSummary: 'No additional full source content needed.',
        };
      }

      case 'summarize': {
        const contextText = collectedNotes.slice(-10).join('\n\n').slice(0, 12000);
        if (!contextText) {
          return { outputSummary: 'No evidence collected yet to summarize.' };
        }

        const res = await geminiLlmService.generateText(
          `Summarize the key evidence gathered so far for the research objective "${objective}" (focus: ${input}). Cite sources inline:\n\n${contextText}`,
          {
            temperature: 0.2,
            operation: 'agentSummarizeTool',
            promptVersion: PROMPT_VERSIONS.RESEARCH_AGENT_SYNTHESIS,
            userId,
            workspaceId,
          },
        );

        collectedNotes.push(`[Intermediate Summary]: ${res.text}`);
        return {
          outputSummary: res.text,
          usage: res.usage,
        };
      }

      case 'compare': {
        const contextText = collectedNotes.join('\n\n').slice(0, 14000);
        const res = await geminiLlmService.generateText(
          `Create a structured markdown comparison (including a Markdown table of key metrics/features where applicable) for "${objective}" (${input}) based on this collected evidence:\n\n${
            contextText || 'Use available context.'
          }`,
          {
            temperature: 0.2,
            operation: 'agentCompareTool',
            promptVersion: PROMPT_VERSIONS.RESEARCH_AGENT_SYNTHESIS,
            userId,
            workspaceId,
          },
        );

        collectedNotes.push(`[Comparison Analysis]:\n${res.text}`);
        return {
          outputSummary: 'Generated structured comparison table and analysis.',
          comparisonMatrix: res.text,
          usage: res.usage,
        };
      }

      case 'generate_report': {
        const contextText = collectedNotes.join('\n\n').slice(0, 16000);
        const citationList = citations
          .map(
            (c, i) =>
              `[${i + 1}] (${c.sourceType.toUpperCase()}) ${c.title} — ${c.urlOrFile}`,
          )
          .join('\n');

        const res = await geminiLlmService.generateText(
          `Compile a comprehensive, evidence-backed research result for the objective:
"${objective}"

Collected Evidence:
${contextText || 'No external or document evidence was found.'}

Available Citations:
${citationList || 'None'}

Format the output in clear Markdown with:
1. Executive Overview
2. Key Research Findings (with inline citations [1], [2], etc.)
3. Comparative Analysis / Metrics
4. Knowledge Gaps & Limitations
5. References`,
          {
            temperature: 0.2,
            operation: 'agentGenerateReportTool',
            promptVersion: PROMPT_VERSIONS.RESEARCH_AGENT_SYNTHESIS,
            userId,
            workspaceId,
          },
        );

        return {
          outputSummary: 'Compiled final structured research findings with citations.',
          compiledFindings: res.text,
          usage: res.usage,
        };
      }
    }
  }

  /**
   * Starts a new AI research agent task.
   * If `requireApproval: true`, pauses in `awaiting_approval` after generating the plan.
   * Otherwise executes the full controlled workflow immediately.
   */
  async startAgentRun(
    userId: string,
    workspaceId: string,
    input: CreateAgentRunInput,
  ): Promise<IAgentRun> {
    await this.verifyWorkspaceOwnership(userId, workspaceId);

    const maxSteps = Math.min(
      input.maxSteps ?? env.AGENT_MAX_STEPS,
      env.AGENT_MAX_STEPS,
    );

    const { plan, usage: planUsage } = await this.createResearchPlan({
      userId,
      workspaceId,
      objective: input.objective,
      maxSteps,
      includeWeb: input.includeWeb ?? true,
      includeDocuments: input.includeDocuments ?? true,
    });

    const agentRun = await AgentRunModel.create({
      workspaceId: new mongoose.Types.ObjectId(workspaceId),
      userId: new mongoose.Types.ObjectId(userId),
      objective: input.objective,
      status: input.requireApproval ? 'awaiting_approval' : 'running',
      requireApproval: Boolean(input.requireApproval),
      maxSteps,
      plan,
      steps: [],
      tokenUsage: planUsage,
    });

    if (input.requireApproval) {
      return agentRun;
    }

    return this.executeAgentPlan(userId, String(agentRun._id));
  }

  /**
   * Approves and executes a planned agent run that was waiting for human approval.
   */
  async approveAndExecuteAgentRun(
    userId: string,
    runId: string,
  ): Promise<IAgentRun> {
    const run = await this.getOwnedAgentRunOrThrow(userId, runId);
    if (run.status !== 'awaiting_approval') {
      throw AppError.badRequest(
        `Agent run is in "${run.status}" state and cannot be approved`,
      );
    }

    run.status = 'running';
    await run.save();

    return this.executeAgentPlan(userId, runId);
  }

  /**
   * Executes the planned steps, evaluates missing information, runs follow-up searches
   * within `maxSteps`, and compiles final findings.
   */
  async executeAgentPlan(userId: string, runId: string): Promise<IAgentRun> {
    const run = await this.getOwnedAgentRunOrThrow(userId, runId);
    const workspaceId = String(run.workspaceId);

    const collectedNotes: string[] = [];
    const citations: IAgentCitation[] = [...run.sources];
    const stepsLog: IAgentExecutionStep[] = [...run.steps];

    const addUsage = (u?: {
      promptTokens: number;
      responseTokens: number;
      totalTokens: number;
      estimatedCostUsd: number;
    }) => {
      if (!u) return;
      run.tokenUsage.promptTokens += u.promptTokens;
      run.tokenUsage.responseTokens += u.responseTokens;
      run.tokenUsage.totalTokens += u.totalTokens;
      run.tokenUsage.estimatedCostUsd = Number(
        (run.tokenUsage.estimatedCostUsd + u.estimatedCostUsd).toFixed(8),
      );
    };

    try {
      const nonReportSteps = run.plan.filter((s) => s.tool !== 'generate_report');

      for (const plannedStep of nonReportSteps) {
        if (stepsLog.length >= run.maxSteps - 1) break;

        const currentCheck = await AgentRunModel.findById(run._id).select('status');
        if (currentCheck?.status === 'cancelled') {
          run.status = 'cancelled';
          return run;
        }

        const stepStart = Date.now();
        try {
          const res = await this.executeRegisteredTool({
            userId,
            workspaceId,
            tool: plannedStep.tool,
            input: plannedStep.queryOrInput,
            objective: run.objective,
            collectedNotes,
            citations,
          });

          addUsage(res.usage);
          if (res.comparisonMatrix) {
            run.comparisonMatrix = res.comparisonMatrix;
          }

          stepsLog.push({
            stepNumber: stepsLog.length + 1,
            tool: plannedStep.tool,
            input: plannedStep.queryOrInput,
            outputSummary: res.outputSummary,
            status: 'completed',
            durationMs: Date.now() - stepStart,
            timestamp: new Date(),
          });
        } catch (stepErr) {
          logger.warn(`Agent step ${plannedStep.stepNumber} (${plannedStep.tool}) failed`, {
            error: stepErr instanceof Error ? stepErr.message : String(stepErr),
          });
          stepsLog.push({
            stepNumber: stepsLog.length + 1,
            tool: plannedStep.tool,
            input: plannedStep.queryOrInput,
            outputSummary: `Step failed: ${
              stepErr instanceof Error ? stepErr.message : String(stepErr)
            }`,
            status: 'failed',
            durationMs: Date.now() - stepStart,
            timestamp: new Date(),
          });
        }
      }

      // Gap Identification: check if critical information is missing and budget allows follow-up search
      if (stepsLog.length < run.maxSteps - 1 && env.GEMINI_API_KEY?.trim()) {
        try {
          const gapPrompt = `Objective: "${run.objective}"
Collected Evidence Summary:
${collectedNotes.join('\n').slice(0, 6000)}

Identify any missing information required to fulfill the objective, and optionally propose 1 follow-up search if needed.
Return JSON:
{
  "missingInformation": ["string"],
  "followUpQueries": [{ "tool": "search_web" | "retrieve_documents", "query": "string" }]
}`;
          const { data: gapData, usage: gapUsage } =
            await geminiLlmService.generateStructuredJson(
              gapPrompt,
              agentGapCheckSchema,
              {
                temperature: 0.1,
                operation: 'agentGapIdentification',
                userId,
                workspaceId,
              },
            );
          addUsage(gapUsage);
          run.missingInformation = gapData.missingInformation;

          for (const followUp of gapData.followUpQueries) {
            if (stepsLog.length >= run.maxSteps - 1) break;
            const fStart = Date.now();
            const fRes = await this.executeRegisteredTool({
              userId,
              workspaceId,
              tool: followUp.tool,
              input: followUp.query,
              objective: run.objective,
              collectedNotes,
              citations,
            });
            addUsage(fRes.usage);
            stepsLog.push({
              stepNumber: stepsLog.length + 1,
              tool: followUp.tool,
              input: followUp.query,
              outputSummary: `[Follow-up search] ${fRes.outputSummary}`,
              status: 'completed',
              durationMs: Date.now() - fStart,
              timestamp: new Date(),
            });
          }
        } catch {
          // Ignore optional gap check failure
        }
      }

      // Final Step: Compile report findings
      const finalStart = Date.now();
      const finalRes = await this.executeRegisteredTool({
        userId,
        workspaceId,
        tool: 'generate_report',
        input: run.objective,
        objective: run.objective,
        collectedNotes,
        citations,
      });
      addUsage(finalRes.usage);

      stepsLog.push({
        stepNumber: stepsLog.length + 1,
        tool: 'generate_report',
        input: run.objective,
        outputSummary: finalRes.outputSummary,
        status: 'completed',
        durationMs: Date.now() - finalStart,
        timestamp: new Date(),
      });

      run.steps = stepsLog;
      run.sources = citations;
      run.compiledFindings = finalRes.compiledFindings ?? '';
      run.status = 'completed';
      run.errorMessage = null;
      await run.save();

      return run;
    } catch (error) {
      run.steps = stepsLog;
      run.sources = citations;
      run.status = 'failed';
      run.errorMessage =
        error instanceof Error ? error.message : 'Agent execution failed';
      await run.save();
      throw error;
    }
  }

  async cancelAgentRun(userId: string, runId: string): Promise<IAgentRun> {
    const run = await this.getOwnedAgentRunOrThrow(userId, runId);
    run.status = 'cancelled';
    await run.save();
    return run;
  }

  async getAgentRun(userId: string, runId: string): Promise<IAgentRun> {
    return this.getOwnedAgentRunOrThrow(userId, runId);
  }

  async listWorkspaceAgentRuns(
    userId: string,
    workspaceId: string,
  ): Promise<IAgentRun[]> {
    await this.verifyWorkspaceOwnership(userId, workspaceId);
    return AgentRunModel.find({
      workspaceId: new mongoose.Types.ObjectId(workspaceId),
    }).sort({ createdAt: -1 });
  }
}

export const agentService = new AgentService();

