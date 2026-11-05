import { GoogleGenAI } from '@google/genai';
import { ZodType } from 'zod';
import { env } from '../../config/env';
import { AppError } from '../errors/AppError';
import { logger } from '../utils/logger';
import {
  aiTelemetryService,
  PROMPT_VERSIONS,
} from '../observability/aiTelemetry.service';

export interface GenerateTextOptions {
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: 'text/plain' | 'application/json';
  operation?: string;
  promptVersion?: string;
  userId?: string;
  workspaceId?: string;
  timeoutMs?: number;
}

export interface GenerateTextResult {
  text: string;
  usage: {
    promptTokens: number;
    responseTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new AppError(`LLM request timed out after ${timeoutMs}ms`, 504, 'LLM_TIMEOUT'));
    }, timeoutMs);

    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
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
   * Invokes Gemini LLM with timeout, retry/model fallback, and token/cost telemetry.
   */
  async generateText(
    prompt: string,
    options: GenerateTextOptions = {},
  ): Promise<GenerateTextResult> {
    const ai = this.getClient();
    const primaryModel = env.GEMINI_CHAT_MODEL || 'gemini-2.5-flash';
    const fallbackModel = 'gemini-1.5-flash';
    const modelsToTry =
      primaryModel === fallbackModel ? [primaryModel] : [primaryModel, fallbackModel];
    const timeoutMs = options.timeoutMs ?? env.GEMINI_TIMEOUT_MS;
    const startTime = Date.now();

    let lastError: unknown;

    for (let attempt = 0; attempt < modelsToTry.length; attempt++) {
      const model = modelsToTry[attempt];
      try {
        const response = await withTimeout(
          ai.models.generateContent({
            model,
            contents: prompt,
            config: {
              systemInstruction: options.systemInstruction,
              temperature: options.temperature ?? 0.2,
              maxOutputTokens: options.maxOutputTokens,
              ...(options.responseMimeType
                ? { responseMimeType: options.responseMimeType }
                : {}),
            },
          }),
          timeoutMs,
        );

        const text = (response.text ?? '').trim();
        const promptTokens =
          response.usageMetadata?.promptTokenCount ?? Math.ceil(prompt.length / 4);
        const responseTokens =
          response.usageMetadata?.candidatesTokenCount ?? Math.ceil(text.length / 4);
        const totalTokens =
          response.usageMetadata?.totalTokenCount ?? promptTokens + responseTokens;

        const telemetry = aiTelemetryService.recordCall({
          model,
          operation: options.operation ?? 'generateText',
          promptVersion: options.promptVersion ?? PROMPT_VERSIONS.RAG_QA,
          promptTokens,
          responseTokens,
          totalTokens,
          durationMs: Date.now() - startTime,
          success: true,
          userId: options.userId,
          workspaceId: options.workspaceId,
        });

        return {
          text,
          usage: {
            promptTokens,
            responseTokens,
            totalTokens,
            estimatedCostUsd: telemetry.estimatedCostUsd,
          },
        };
      } catch (error) {
        lastError = error;
        logger.warn(`Gemini LLM attempt ${attempt + 1} with model "${model}" failed`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    aiTelemetryService.recordCall({
      model: primaryModel,
      operation: options.operation ?? 'generateText',
      promptVersion: options.promptVersion ?? PROMPT_VERSIONS.RAG_QA,
      promptTokens: Math.ceil(prompt.length / 4),
      responseTokens: 0,
      totalTokens: Math.ceil(prompt.length / 4),
      durationMs: Date.now() - startTime,
      success: false,
      userId: options.userId,
      workspaceId: options.workspaceId,
    });

    if (lastError instanceof AppError) throw lastError;
    throw new AppError(
      `Gemini LLM generation error: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
      502,
      'GEMINI_LLM_ERROR',
    );
  }

  /**
   * Generates structured JSON output from Gemini and validates it against a Zod schema.
   */
  async generateStructuredJson<T>(
    prompt: string,
    schema: ZodType<T>,
    options: GenerateTextOptions = {},
  ): Promise<{ data: T; usage: GenerateTextResult['usage'] }> {
    const result = await this.generateText(prompt, {
      ...options,
      responseMimeType: 'application/json',
    });

    const cleaned = result.text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new AppError(
        'LLM returned malformed JSON output',
        502,
        'LLM_INVALID_JSON_OUTPUT',
      );
    }

    const validated = schema.safeParse(parsed);
    if (!validated.success) {
      throw new AppError(
        'LLM JSON output failed schema validation',
        502,
        'LLM_SCHEMA_VALIDATION_ERROR',
        validated.error.issues,
      );
    }

    return {
      data: validated.data,
      usage: result.usage,
    };
  }

  /**
   * Streams text generation progressively from Gemini LLM.
   */
  async *generateTextStream(
    prompt: string,
    options: GenerateTextOptions = {},
  ): AsyncGenerator<string, void, unknown> {
    const ai = this.getClient();
    const model = env.GEMINI_CHAT_MODEL || 'gemini-2.5-flash';
    const startTime = Date.now();
    let streamedChars = 0;

    try {
      const responseStream = await ai.models.generateContentStream({
        model,
        contents: prompt,
        config: {
          systemInstruction: options.systemInstruction,
          temperature: options.temperature ?? 0.2,
          maxOutputTokens: options.maxOutputTokens,
        },
      });

      for await (const chunk of responseStream) {
        if (chunk.text) {
          streamedChars += chunk.text.length;
          yield chunk.text;
        }
      }

      const promptTokens = Math.ceil(prompt.length / 4);
      const responseTokens = Math.ceil(streamedChars / 4);
      aiTelemetryService.recordCall({
        model,
        operation: options.operation ?? 'generateTextStream',
        promptVersion: options.promptVersion ?? PROMPT_VERSIONS.CHAT_CONVERSATION,
        promptTokens,
        responseTokens,
        totalTokens: promptTokens + responseTokens,
        durationMs: Date.now() - startTime,
        success: true,
        userId: options.userId,
        workspaceId: options.workspaceId,
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('Gemini LLM stream generation failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new AppError(
        `Gemini LLM stream error: ${error instanceof Error ? error.message : String(error)}`,
        502,
        'GEMINI_STREAM_ERROR',
      );
    }
  }
}

export const geminiLlmService = new GeminiLlmService();
