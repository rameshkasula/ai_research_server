import { GoogleGenAI } from '@google/genai';
import { env } from '../../config/env';
import { AppError } from '../errors/AppError';
import { logger } from '../utils/logger';

export class GeminiEmbeddingService {
  private aiClient: GoogleGenAI | null = null;

  private getClient(): GoogleGenAI {
    if (!this.aiClient) {
      if (!env.GEMINI_API_KEY || !env.GEMINI_API_KEY.trim()) {
        throw new AppError(
          'GEMINI_API_KEY is not configured in .env. Please provide a valid Gemini API key to generate vector embeddings.',
          500,
          'GEMINI_CONFIG_ERROR',
        );
      }
      this.aiClient = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY.trim() });
    }
    return this.aiClient;
  }

  /**
   * Generates a 768-dimensional vector embedding for a single text string.
   */
  async generateEmbedding(text: string): Promise<number[]> {
    const ai = this.getClient();
    const model = env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004';

    try {
      const response = await ai.models.embedContent({
        model,
        contents: text,
      });

      const embeddingValues = response.embeddings?.[0]?.values;
      if (!embeddingValues || !Array.isArray(embeddingValues) || embeddingValues.length === 0) {
        throw new AppError(
          'Gemini returned an empty embedding response',
          502,
          'GEMINI_EMBEDDING_FAILED',
        );
      }

      return embeddingValues;
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('Gemini embedding generation failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new AppError(
        `Gemini embedding error: ${error instanceof Error ? error.message : String(error)}`,
        502,
        'GEMINI_API_ERROR',
      );
    }
  }

  /**
   * Generates embeddings for multiple chunks in controlled batch sizes to respect rate limits.
   */
  async generateBatchEmbeddings(
    texts: string[],
    batchSize = 10,
  ): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const embeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchPromises = batch.map((text) => this.generateEmbedding(text));
      const batchResults = await Promise.all(batchPromises);
      embeddings.push(...batchResults);
    }

    return embeddings;
  }
}

export const geminiEmbeddingService = new GeminiEmbeddingService();
