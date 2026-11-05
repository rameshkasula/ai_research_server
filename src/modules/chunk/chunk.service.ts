import mongoose from 'mongoose';
import { env } from '../../config/env';
import { AppError } from '../../common/errors/AppError';
import { storageService } from '../../common/storage/storage.service';
import { extractTextFromBuffer } from '../../common/utils/textExtractor';
import { splitTextIntoChunks } from '../../common/utils/textChunker';
import { geminiEmbeddingService } from '../../common/services/geminiEmbedding.service';
import { cosineSimilarity } from '../../common/utils/vectorMath';
import { logger } from '../../common/utils/logger';
import { DocumentModel } from '../document/document.model';
import { WorkspaceModel } from '../workspace/workspace.model';
import { ChunkModel, IChunk } from './chunk.model';
import { ListChunksQuery, ProcessDocumentBody } from './chunk.schema';

export interface ChunkSearchResult {
  chunk: {
    id: string;
    documentId: string;
    workspaceId: string;
    chunkIndex: number;
    text: string;
    tokenCount: number;
    metadata: {
      originalName: string;
      mimeType: string;
      pageNumber?: number;
      startChar: number;
      endChar: number;
    };
  };
  score: number;
}

export class ChunkService {
  /**
   * Processes a document: extracts text, chunks it, generates vector embeddings,
   * stores chunks with metadata, and tracks document lifecycle.
   */
  async processDocument(
    userId: string,
    documentId: string,
    options: ProcessDocumentBody = {},
  ): Promise<{
    documentId: string;
    status: string;
    chunkCount: number;
    message: string;
  }> {
    const doc = await DocumentModel.findById(documentId);
    if (!doc) {
      throw AppError.notFound('Document not found');
    }

    if (String(doc.userId) !== userId) {
      throw AppError.forbidden('You do not have permission to process this document');
    }

    if (doc.status === 'pending_upload') {
      throw AppError.badRequest('Cannot process document before upload has completed');
    }

    // Set document status to processing
    doc.status = 'processing';
    doc.processingError = null;
    await doc.save();

    try {
      // 1. Retrieve raw file buffer from Object Storage (Cloudinary or Local)
      logger.info(`Fetching document file from storage: ${doc.originalName} (${doc.storageKey})`);
      const fileBuffer = await storageService.getObjectBuffer(doc.storageKey);

      // 2. Extract text from buffer
      logger.info(`Extracting text from ${doc.mimeType} (${fileBuffer.length} bytes)`);
      const { fullText } = await extractTextFromBuffer(fileBuffer, doc.mimeType);

      if (!fullText || fullText.trim().length === 0) {
        throw new AppError(
          'No extractable text found in document',
          422,
          'EMPTY_DOCUMENT_TEXT',
        );
      }

      // 3. Divide text into overlapping chunks
      const chunkSize = options.chunkSize ?? env.CHUNK_SIZE;
      const chunkOverlap = options.chunkOverlap ?? env.CHUNK_OVERLAP;

      const rawChunks = splitTextIntoChunks(fullText, {
        chunkSize,
        chunkOverlap,
      });

      if (rawChunks.length === 0) {
        throw new AppError(
          'Failed to create text chunks from document content',
          422,
          'CHUNKING_FAILED',
        );
      }

      logger.info(
        `Divided document "${doc.originalName}" into ${rawChunks.length} chunks (size: ${chunkSize}, overlap: ${chunkOverlap})`,
      );

      // 4. Generate vector embeddings using Gemini
      logger.info(
        `Generating embeddings for ${rawChunks.length} chunks using Gemini model "${env.GEMINI_EMBEDDING_MODEL}"`,
      );
      const chunkTexts = rawChunks.map((c) => c.text);
      const embeddings = await geminiEmbeddingService.generateBatchEmbeddings(chunkTexts);

      // 5. Clean up any existing chunks for this document
      await ChunkModel.deleteMany({ documentId: doc._id });

      // 6. Bulk insert chunks with complete metadata
      const chunksToInsert = rawChunks.map((chunk, index) => ({
        documentId: doc._id,
        workspaceId: doc.workspaceId,
        userId: doc.userId,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        embedding: embeddings[index],
        tokenCount: chunk.tokenCount,
        metadata: {
          originalName: doc.originalName,
          mimeType: doc.mimeType,
          startChar: chunk.startChar,
          endChar: chunk.endChar,
        },
      }));

      await ChunkModel.insertMany(chunksToInsert);

      // 7. Update document status to ready
      doc.status = 'ready';
      doc.chunkCount = chunksToInsert.length;
      doc.uploadProgress = 100;
      doc.processingError = null;
      await doc.save();

      // Update workspace timestamp
      await WorkspaceModel.findByIdAndUpdate(doc.workspaceId, {
        $set: { updatedAt: new Date() },
      });

      logger.info(
        `Successfully processed document "${doc.originalName}" with ${chunksToInsert.length} vector chunks`,
      );

      return {
        documentId: String(doc._id),
        status: 'ready',
        chunkCount: chunksToInsert.length,
        message: 'Document processed and vector embeddings generated successfully',
      };
    } catch (error) {
      doc.status = 'failed';
      doc.processingError =
        error instanceof Error ? error.message : 'Unknown processing error';
      await doc.save();

      logger.error(`Document processing failed for "${doc.originalName}"`, {
        error: doc.processingError,
      });

      if (error instanceof AppError) throw error;
      throw new AppError(
        `Document processing failed: ${doc.processingError}`,
        500,
        'DOCUMENT_PROCESSING_FAILED',
      );
    }
  }

  /**
   * Retrieves paginated chunks for a document.
   */
  async getChunksByDocument(
    userId: string,
    documentId: string,
    query: ListChunksQuery,
  ): Promise<{
    chunks: any[];
    pagination: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  }> {
    const doc = await DocumentModel.findById(documentId);
    if (!doc) {
      throw AppError.notFound('Document not found');
    }

    if (String(doc.userId) !== userId) {
      throw AppError.forbidden('You do not have permission to view chunks for this document');
    }

    const { page = 1, limit = 20, includeEmbedding = 'false' } = query;
    const skip = (page - 1) * limit;

    const projection =
      includeEmbedding === 'true' ? {} : { embedding: 0 };

    const filter = { documentId: new mongoose.Types.ObjectId(documentId) };

    const [chunks, total] = await Promise.all([
      ChunkModel.find(filter, projection)
        .sort({ chunkIndex: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ChunkModel.countDocuments(filter),
    ]);

    return {
      chunks: chunks.map((c) => ({
        ...c,
        id: String(c._id),
      })),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Retrieves a single chunk by ID.
   */
  async getChunkById(userId: string, chunkId: string): Promise<IChunk> {
    const chunk = await ChunkModel.findById(chunkId);
    if (!chunk) {
      throw AppError.notFound('Chunk not found');
    }

    if (String(chunk.userId) !== userId) {
      throw AppError.forbidden('You do not have permission to access this chunk');
    }

    return chunk;
  }

  /**
   * Performs semantic vector similarity search across a workspace's chunks.
   */
  async searchWorkspaceChunks(
    userId: string,
    workspaceId: string,
    searchQuery: string,
    topK = 5,
  ): Promise<ChunkSearchResult[]> {
    const workspace = await WorkspaceModel.findById(workspaceId);
    if (!workspace) {
      throw AppError.notFound('Workspace not found');
    }

    if (String(workspace.userId) !== userId) {
      throw AppError.forbidden('You do not have permission to access this workspace');
    }

    // 1. Generate query embedding with Gemini
    const queryEmbedding = await geminiEmbeddingService.generateEmbedding(searchQuery);

    // 2. Fetch all chunks in the workspace with their embeddings
    const chunks = await ChunkModel.find({
      workspaceId: new mongoose.Types.ObjectId(workspaceId),
    }).lean();

    if (chunks.length === 0) {
      return [];
    }

    // 3. Compute cosine similarity for each chunk
    const scoredChunks = chunks.map((chunk) => {
      const score = cosineSimilarity(queryEmbedding, chunk.embedding);
      return {
        chunk: {
          id: String(chunk._id),
          documentId: String(chunk.documentId),
          workspaceId: String(chunk.workspaceId),
          chunkIndex: chunk.chunkIndex,
          text: chunk.text,
          tokenCount: chunk.tokenCount,
          metadata: chunk.metadata,
        },
        score: Number(score.toFixed(4)),
      };
    });

    // 4. Sort by highest cosine similarity and take topK
    scoredChunks.sort((a, b) => b.score - a.score);
    return scoredChunks.slice(0, topK);
  }

  /**
   * Deletes all chunks associated with a document.
   */
  async deleteChunksByDocument(documentId: string): Promise<number> {
    const result = await ChunkModel.deleteMany({
      documentId: new mongoose.Types.ObjectId(documentId),
    });
    return result.deletedCount ?? 0;
  }

  /**
   * Deletes all chunks associated with a workspace.
   */
  async deleteChunksByWorkspace(workspaceId: string): Promise<number> {
    const result = await ChunkModel.deleteMany({
      workspaceId: new mongoose.Types.ObjectId(workspaceId),
    });
    return result.deletedCount ?? 0;
  }
}

export const chunkService = new ChunkService();
