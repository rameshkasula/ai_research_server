import { GoogleGenAI } from '@google/genai';
import { env } from '../../config/env';
import { AppError } from '../errors/AppError';
import { logger } from '../utils/logger';

export interface GenerateTextOptions {
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface GenerateTextResult {
  text: string;
  usage?: {
    promptTokens?: number;
    responseTokens?: number;
    totalTokens?: number;
  };
}

export class GeminiLlmService {
  private aiClient: GoogleGenAI | null = null;

  private getClient(): GoogleGenAI {
    if (!this.aiClient) {
      if (!env.GEMINI_API_KEY || !env.GEMINI_API_KEY.trim()) {
        throw new AppError(
          'GEMINI_API_KEY is not configured in .env. Please provide a valid Gemini API key to invoke the LLM.',
          500,
          'GEMINI_CONFIG_ERROR',
        );
      }
      this.aiClient = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY.trim() });
    }
    return this.aiClient;
  }

  /**
   * Invokes Gemini LLM to generate grounded text using system instructions and user prompt.
   */
  async generateText(
    prompt: string,
    options: GenerateTextOptions = {},
  ): Promise<GenerateTextResult> {
    const ai = this.getClient();
    const model = env.GEMINI_CHAT_MODEL || 'gemini-2.5-flash';

    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction: options.systemInstruction,
          temperature: options.temperature ?? 0.2,
          maxOutputTokens: options.maxOutputTokens,
        },
      });

      const text = response.text ?? '';

      return {
        text: text.trim(),
        usage: {
          promptTokens: response.usageMetadata?.promptTokenCount,
          responseTokens: response.usageMetadata?.candidatesTokenCount,
          totalTokens: response.usageMetadata?.totalTokenCount,
        },
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('Gemini LLM generation failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new AppError(
        `Gemini LLM generation error: ${error instanceof Error ? error.message : String(error)}`,
        502,
        'GEMINI_LLM_ERROR',
      );
    }
  }
}

export const geminiLlmService = new GeminiLlmService();

