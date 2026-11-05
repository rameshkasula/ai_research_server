import crypto from 'crypto';
import mongoose from 'mongoose';
import { AppError } from '../../common/errors/AppError';
import { geminiLlmService } from '../../common/services/geminiLlm.service';
import { PROMPT_VERSIONS } from '../../common/observability/aiTelemetry.service';
import { WorkspaceModel } from '../workspace/workspace.model';
import { ConversationModel } from '../conversation/conversation.model';
import { MessageModel } from '../conversation/message.model';
import { AgentRunModel } from '../agent/agentRun.model';
import { searchService } from '../search/search.service';
import { WebSourceModel } from '../web-research/webSource.model';
import {
  IReport,
  IReportSections,
  IReportSource,
  ReportModel,
  ReportSectionKey,
} from './report.model';
import {
  CreateReportInput,
  llmReportSectionsOutputSchema,
  RegenerateSectionInput,
  ShareReportInput,
  UpdateReportInput,
} from './report.schema';

export class ReportService {
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

  async getOwnedReportOrThrow(userId: string, reportId: string): Promise<IReport> {
    const report = await ReportModel.findById(reportId);
    if (!report) {
      throw AppError.notFound('Report not found');
    }
    if (String(report.userId) !== userId) {
      throw AppError.forbidden('You do not have permission to access this report');
    }
    return report;
  }

  /**
   * Generates a complete structured research report from a conversation, agent run,
   * or workspace knowledge base, preserving all source citations.
   */
  async generateReport(
    userId: string,
    workspaceId: string,
    input: CreateReportInput,
  ): Promise<IReport> {
    await this.verifyWorkspaceOwnership(userId, workspaceId);

    const evidenceParts: string[] = [];
    const collectedSources: IReportSource[] = [];
    let derivedObjective = input.objective?.trim() || '';
    let derivedTitle = input.title?.trim() || '';

    // 1. Gather evidence from Conversation if conversationId provided
    if (input.conversationId) {
      const conv = await ConversationModel.findById(input.conversationId);
      if (conv && String(conv.userId) === userId) {
        if (!derivedTitle) derivedTitle = `Research Report: ${conv.title}`;
        const messages = await MessageModel.find({
          conversationId: conv._id,
        }).sort({ createdAt: 1 });

        for (const msg of messages) {
          evidenceParts.push(`[${msg.role.toUpperCase()}]: ${msg.content}`);
          for (const s of msg.sources) {
            if (!collectedSources.some((cs) => cs.reference === s.originalName)) {
              collectedSources.push({
                sourceType: 'document',
                title: s.originalName,
                reference: `${s.originalName} (Chunk #${s.chunkIndex})`,
                snippet: s.textSnippet,
              });
            }
          }
        }
        if (!derivedObjective && messages.length > 0) {
          derivedObjective = messages[0].content.slice(0, 300);
        }
      }
    }

    // 2. Gather evidence from Agent Run if agentRunId provided
    if (input.agentRunId) {
      const run = await AgentRunModel.findById(input.agentRunId);
      if (run && String(run.userId) === userId) {
        if (!derivedObjective) derivedObjective = run.objective;
        if (!derivedTitle) {
          derivedTitle = `Research Report: ${run.objective.slice(0, 80)}`;
        }
        if (run.compiledFindings) {
          evidenceParts.push(`[Agent Compiled Findings]:\n${run.compiledFindings}`);
        }
        if (run.comparisonMatrix) {
          evidenceParts.push(`[Agent Comparison Matrix]:\n${run.comparisonMatrix}`);
        }
        for (const s of run.sources) {
          if (!collectedSources.some((cs) => cs.reference === s.urlOrFile)) {
            collectedSources.push({
              sourceType: s.sourceType,
              title: s.title,
              reference: s.urlOrFile,
              snippet: s.snippet,
            });
          }
        }
      }
    }

    if (!derivedObjective) {
      derivedObjective = 'Comprehensive synthesis of workspace research materials';
    }
    if (!derivedTitle) {
      derivedTitle = `Research Report — ${derivedObjective.slice(0, 70)}`;
    }

    // 3. Supplement with workspace documents & stored web sources
    const docSearch = await searchService
      .searchWorkspace(userId, workspaceId, {
        query: derivedObjective,
        topK: 6,
        minScore: 0.4,
      })
      .catch(() => ({ results: [] }));

    for (const r of docSearch.results) {
      evidenceParts.push(
        `[Document: ${r.metadata.originalName}, Chunk #${r.chunkIndex}]: ${r.text}`,
      );
      const ref = `${r.metadata.originalName} (Chunk #${r.chunkIndex})`;
      if (!collectedSources.some((cs) => cs.reference === ref)) {
        collectedSources.push({
          sourceType: 'document',
          title: r.metadata.originalName,
          reference: ref,
          snippet: r.text.slice(0, 250),
        });
      }
    }

    const webSources = await WebSourceModel.find({
      workspaceId: new mongoose.Types.ObjectId(workspaceId),
    })
      .sort({ createdAt: -1 })
      .limit(5);

    for (const w of webSources) {
      evidenceParts.push(
        `[Web Source: ${w.title} (${w.url})]: ${w.summary || w.snippet}`,
      );
      if (!collectedSources.some((cs) => cs.reference === w.url)) {
        collectedSources.push({
          sourceType: 'web',
          title: w.title,
          reference: w.url,
          snippet: (w.summary || w.snippet).slice(0, 250),
        });
      }
    }

    const formattedRefs =
      collectedSources.length > 0
        ? collectedSources
            .map(
              (s, i) =>
                `[${i + 1}] (${s.sourceType.toUpperCase()}) **${s.title}** — ${s.reference}`,
            )
            .join('\n')
        : 'No external references recorded.';

    const prompt = `Generate a comprehensive, professional Research Report in structured JSON format for the following objective:
Objective: "${derivedObjective}"

Collected Research Evidence:
${evidenceParts.join('\n\n').slice(0, 16000) || 'Synthesize based on the stated objective.'}

Preserved Citations / References:
${formattedRefs}

Return valid JSON with these exact keys (each value must be rich, well-formatted Markdown text; include Markdown tables in competitorComparison):
{
  "title": "Professional report title",
  "executiveSummary": "...",
  "researchObjective": "...",
  "methodology": "...",
  "keyFindings": "...",
  "marketAnalysis": "...",
  "competitorComparison": "... (include Markdown comparison table) ...",
  "opportunities": "...",
  "risks": "...",
  "recommendations": "...",
  "conclusion": "...",
  "references": "..."
}`;

    const { data: generated } = await geminiLlmService.generateStructuredJson(
      prompt,
      llmReportSectionsOutputSchema,
      {
        temperature: 0.2,
        operation: 'generateResearchReport',
        promptVersion: PROMPT_VERSIONS.REPORT_GENERATOR,
        userId,
        workspaceId,
      },
    );

    const sections: IReportSections = {
      executiveSummary: generated.executiveSummary,
      researchObjective: generated.researchObjective,
      methodology: generated.methodology,
      keyFindings: generated.keyFindings,
      marketAnalysis: generated.marketAnalysis,
      competitorComparison: generated.competitorComparison,
      opportunities: generated.opportunities,
      risks: generated.risks,
      recommendations: generated.recommendations,
      conclusion: generated.conclusion,
      references: generated.references || formattedRefs,
    };

    const report = await ReportModel.create({
      workspaceId: new mongoose.Types.ObjectId(workspaceId),
      userId: new mongoose.Types.ObjectId(userId),
      conversationId: input.conversationId
        ? new mongoose.Types.ObjectId(input.conversationId)
        : null,
      agentRunId: input.agentRunId
        ? new mongoose.Types.ObjectId(input.agentRunId)
        : null,
      title: input.title?.trim() || generated.title || derivedTitle,
      objective: derivedObjective,
      status: 'ready',
      sections,
      sources: collectedSources,
      version: 1,
    });

    return report;
  }

  /**
   * Regenerates an individual section of a report while preserving overall coherence and citations.
   */
  async regenerateSection(
    userId: string,
    reportId: string,
    sectionKey: ReportSectionKey,
    input: RegenerateSectionInput,
  ): Promise<IReport> {
    const report = await this.getOwnedReportOrThrow(userId, reportId);

    const prompt = `You are regenerating the "${sectionKey}" section of the research report titled "${report.title}".
Research Objective: "${report.objective}"
Current Section Content:
${report.sections[sectionKey] || '(empty)'}

Executive Summary for context:
${report.sections.executiveSummary}

Available References:
${report.sections.references}

${
  input.instructions
    ? `Additional User Instructions: ${input.instructions}`
    : 'Improve depth, clarity, factual precision, and citation usage.'
}

Return ONLY the updated Markdown content for the "${sectionKey}" section.`;

    const res = await geminiLlmService.generateText(prompt, {
      temperature: 0.25,
      operation: `regenerateReportSection:${sectionKey}`,
      promptVersion: PROMPT_VERSIONS.REPORT_GENERATOR,
      userId,
      workspaceId: String(report.workspaceId),
    });

    report.sections[sectionKey] = res.text;
    report.version += 1;
    report.markModified('sections');
    await report.save();

    return report;
  }

  /**
   * Manually edits report title, objective, or individual sections.
   */
  async updateReportManually(
    userId: string,
    reportId: string,
    input: UpdateReportInput,
  ): Promise<IReport> {
    const report = await this.getOwnedReportOrThrow(userId, reportId);

    if (input.title !== undefined) {
      report.title = input.title;
    }
    if (input.objective !== undefined) {
      report.objective = input.objective;
    }
    if (input.sections) {
      for (const [key, value] of Object.entries(input.sections)) {
        if (value !== undefined) {
          report.sections[key as ReportSectionKey] = value;
        }
      }
      report.markModified('sections');
    }

    report.version += 1;
    await report.save();
    return report;
  }

  /**
   * Configures public/private shareable link settings with expiration.
   */
  async configureSharing(
    userId: string,
    reportId: string,
    input: ShareReportInput,
    baseUrl: string,
  ): Promise<{
    shareUrl: string | null;
    shareSettings: IReport['shareSettings'];
  }> {
    const report = await this.getOwnedReportOrThrow(userId, reportId);

    if (!input.isPublic) {
      report.shareSettings = {
        isPublic: false,
        shareToken: null,
        expiresAt: null,
        allowDownload: false,
      };
      report.markModified('shareSettings');
      await report.save();

      return {
        shareUrl: null,
        shareSettings: report.shareSettings,
      };
    }

    const shareToken =
      report.shareSettings.shareToken || crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(
      Date.now() + (input.expiresInHours ?? 168) * 3600 * 1000,
    );

    report.shareSettings = {
      isPublic: true,
      shareToken,
      expiresAt,
      allowDownload: input.allowDownload ?? true,
    };
    report.markModified('shareSettings');
    await report.save();

    return {
      shareUrl: `${baseUrl}/api/shared/reports/${shareToken}`,
      shareSettings: report.shareSettings,
    };
  }

  async revokeSharing(userId: string, reportId: string): Promise<void> {
    const report = await this.getOwnedReportOrThrow(userId, reportId);
    report.shareSettings = {
      isPublic: false,
      shareToken: null,
      expiresAt: null,
      allowDownload: false,
    };
    report.markModified('shareSettings');
    await report.save();
  }

  /**
   * Retrieves a shared report by token in read-only mode, stripping private workspace/user IDs.
   */
  async getSharedReportByToken(shareToken: string): Promise<IReport> {
    const report = await ReportModel.findOne({
      'shareSettings.shareToken': shareToken,
      'shareSettings.isPublic': true,
    });

    if (!report) {
      throw AppError.notFound('Shared report not found or sharing has been disabled');
    }

    if (
      report.shareSettings.expiresAt &&
      Date.now() > report.shareSettings.expiresAt.getTime()
    ) {
      throw AppError.forbidden('This shared report link has expired');
    }

    return report;
  }

  async listReports(userId: string, workspaceId?: string): Promise<IReport[]> {
    const filter: Record<string, unknown> = {
      userId: new mongoose.Types.ObjectId(userId),
    };
    if (workspaceId) {
      await this.verifyWorkspaceOwnership(userId, workspaceId);
      filter.workspaceId = new mongoose.Types.ObjectId(workspaceId);
    }

    return ReportModel.find(filter).sort({ updatedAt: -1 });
  }

  async deleteReport(userId: string, reportId: string): Promise<void> {
    const report = await this.getOwnedReportOrThrow(userId, reportId);
    await report.deleteOne();
  }
}

export const reportService = new ReportService();

