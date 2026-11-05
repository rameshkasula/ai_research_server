import mongoose from 'mongoose';
import { AppError } from '../../common/errors/AppError';
import { geminiEmbeddingService } from '../../common/services/geminiEmbedding.service';
import { cosineSimilarity } from '../../common/utils/vectorMath';
import { logger } from '../../common/utils/logger';
import { WorkspaceModel } from '../workspace/workspace.model';
import { DocumentModel } from '../document/document.model';
import { ChunkModel } from '../chunk/chunk.model';
import { SemanticSearchInput } from './search.schema';

export interface SearchResultPassage {
  id: string;
  documentId: string;
  workspaceId: string;
  chunkIndex: number;
  text: string;
  tokenCount: number;
  score: number;
  metadata: {
    originalName: string;
    mimeType: string;
    pageNumber?: number;
    startChar: number;
    endChar: number;
  };
}

export interface SemanticSearchResponse {
  query: string;
  count: number;
  thresholdApplied: number;
  engineUsed: 'atlas_vector_search' | 'exact_cosine_similarity';
  results: SearchResultPassage[];
}

export class SearchService {
  /**
   * Generates the official Atlas Vector Search index definition.
   */
  getAtlasIndexDefinition(): Record<string, unknown> {
    return {
      name: 'vector_index',
      type: 'vectorSearch',
      definition: {
        fields: [
          {
            type: 'vector',
            path: 'embedding',
            numDimensions: 768,
            similarity: 'cosine',
          },
          {
            type: 'filter',
            path: 'workspaceId',
          },
          {
            type: 'filter',
            path: 'documentId',
          },
          {
            type: 'filter',
            path: 'userId',
          },
        ],
      },
    };
  }

  /**
   * Internal search orchestrator:
   * 1. Attempts MongoDB Atlas `$vectorSearch` pipeline.
   * 2. Automatically falls back to exact in-memory cosine ranking if not running on an Atlas cluster.
   */
  private async executeVectorSearch(params: {
    queryVector: number[];
    filter: Record<string, unknown>;
    topK: number;
    minScore: number;
  }): Promise<{
    passages: SearchResultPassage[];
    engine: 'atlas_vector_search' | 'exact_cosine_similarity';
  }> {
    const { queryVector, filter, topK, minScore } = params;

    // 1. Try native Atlas Vector Search
    try {
      const atlasPipeline: Record<string, unknown>[] = [
        {
          $vectorSearch: {
            index: 'vector_index',
            path: 'embedding',
            queryVector,
            numCandidates: Math.max(topK * 10, 100),
            limit: topK * 2,
            filter,
          },
        },
        {
          $project: {
            _id: 1,
            documentId: 1,
            workspaceId: 1,
            chunkIndex: 1,
            text: 1,
            tokenCount: 1,
            metadata: 1,
            score: { $meta: 'vectorSearchScore' },
          },
        },
      ];

      const rawResults = await ChunkModel.aggregate(atlasPipeline as any);

      if (rawResults && Array.isArray(rawResults)) {
        const passages: SearchResultPassage[] = rawResults
          .map((r: any) => ({
            id: String(r._id),
            documentId: String(r.documentId),
            workspaceId: String(r.workspaceId),
            chunkIndex: r.chunkIndex,
            text: r.text,
            tokenCount: r.tokenCount,
            score: Number((r.score ?? 0).toFixed(4)),
            metadata: r.metadata,
          }))
          .filter((p) => p.score >= minScore)
          .slice(0, topK);

        return {
          passages,
          engine: 'atlas_vector_search',
        };
      }
    } catch (atlasErr) {
      logger.debug(
        'Atlas Vector Search stage skipped/unavailable, using exact cosine similarity fallback',
        {
          reason: atlasErr instanceof Error ? atlasErr.message : String(atlasErr),
        },
      );
    }

    // 2. High-performance fallback: exact pre-filtered cosine similarity
    const candidateChunks = await ChunkModel.find(filter).lean();

    const scoredPassages: SearchResultPassage[] = candidateChunks
      .map((chunk) => {
        const score = cosineSimilarity(queryVector, chunk.embedding);
        return {
          id: String(chunk._id),
          documentId: String(chunk.documentId),
          workspaceId: String(chunk.workspaceId),
          chunkIndex: chunk.chunkIndex,
          text: chunk.text,
          tokenCount: chunk.tokenCount,
          score: Number(score.toFixed(4)),
          metadata: chunk.metadata,
        };
      })
      .filter((p) => p.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return {
      passages: scoredPassages,
      engine: 'exact_cosine_similarity',
    };
  }

  /**
   * Performs semantic vector search across an entire workspace or specific documents within it.
   */
  async searchWorkspace(
    userId: string,
    workspaceId: string,
    input: SemanticSearchInput,
  ): Promise<SemanticSearchResponse> {
    const workspace = await WorkspaceModel.findById(workspaceId);
    if (!workspace) {
      throw AppError.notFound('Workspace not found');
    }

    if (String(workspace.userId) !== userId) {
      throw AppError.forbidden('You do not have permission to access this workspace');
    }

    const { query, topK = 5, minScore = 0.5, documentIds } = input;

    // Generate query embedding using Gemini
    logger.info(`Generating semantic query embedding for: "${query}"`);
    const queryVector = await geminiEmbeddingService.generateEmbedding(query);

    // Build security-isolated pre-filter
    const filter: Record<string, unknown> = {
      workspaceId: new mongoose.Types.ObjectId(workspaceId),
      userId: new mongoose.Types.ObjectId(userId),
    };

    if (documentIds && documentIds.length > 0) {
      filter.documentId = {
        $in: documentIds.map((id) => new mongoose.Types.ObjectId(id)),
      };
    }

    const { passages, engine } = await this.executeVectorSearch({
      queryVector,
      filter,
      topK,
      minScore,
    });

    return {
      query,
      count: passages.length,
      thresholdApplied: minScore,
      engineUsed: engine,
      results: passages,
    };
  }

  /**
   * Performs semantic vector search scoped strictly to a single document.
   */
  async searchDocument(
    userId: string,
    documentId: string,
    query: string,
    topK = 5,
    minScore = 0.5,
  ): Promise<SemanticSearchResponse> {
    const doc = await DocumentModel.findById(documentId);
    if (!doc) {
      throw AppError.notFound('Document not found');
    }

    if (String(doc.userId) !== userId) {
      throw AppError.forbidden('You do not have permission to access this document');
    }

    const queryVector = await geminiEmbeddingService.generateEmbedding(query);

    const filter = {
      documentId: new mongoose.Types.ObjectId(documentId),
      userId: new mongoose.Types.ObjectId(userId),
    };

    const { passages, engine } = await this.executeVectorSearch({
      queryVector,
      filter,
      topK,
      minScore,
    });

    return {
      query,
      count: passages.length,
      thresholdApplied: minScore,
      engineUsed: engine,
      results: passages,
    };
  }

  /**
   * Performs semantic vector search across all user's workspaces.
   */
  async searchAll(
    userId: string,
    input: SemanticSearchInput,
  ): Promise<SemanticSearchResponse> {
    const { query, topK = 5, minScore = 0.5 } = input;

    const queryVector = await geminiEmbeddingService.generateEmbedding(query);

    const filter: Record<string, unknown> = {
      userId: new mongoose.Types.ObjectId(userId),
    };

    if (input.workspaceId) {
      filter.workspaceId = new mongoose.Types.ObjectId(input.workspaceId);
    }

    if (input.documentIds && input.documentIds.length > 0) {
      filter.documentId = {
        $in: input.documentIds.map((id) => new mongoose.Types.ObjectId(id)),
      };
    }

    const { passages, engine } = await this.executeVectorSearch({
      queryVector,
      filter,
      topK,
      minScore,
    });

    return {
      query,
      count: passages.length,
      thresholdApplied: minScore,
      engineUsed: engine,
      results: passages,
    };
  }
}

export const searchService = new SearchService();

