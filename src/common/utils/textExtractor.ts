import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import { AllowedMimeType } from './fileValidator';
import { AppError } from '../errors/AppError';

export interface ExtractedPage {
  pageNumber?: number;
  text: string;
}

export interface ExtractedContent {
  fullText: string;
  pages?: ExtractedPage[];
}

export async function extractTextFromBuffer(
  buffer: Buffer,
  mimeType: AllowedMimeType,
): Promise<ExtractedContent> {
  if (buffer.length === 0) {
    throw AppError.badRequest('Cannot extract text from empty buffer');
  }

  try {
    switch (mimeType) {
      case 'text/plain': {
        const fullText = buffer.toString('utf-8').trim();
        return { fullText };
      }

      case 'application/pdf': {
        const parser = new PDFParse({ data: buffer });
        try {
          const result = await parser.getText();
          const fullText = (result.text ?? '').trim();
          const pages: ExtractedPage[] = (result.pages ?? []).map((p) => ({
            pageNumber: p.num,
            text: p.text.trim(),
          }));
          return { fullText, pages };
        } finally {
          await parser.destroy().catch(() => undefined);
        }
      }

      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
        const docxResult = await mammoth.extractRawText({ buffer });
        const fullText = docxResult.value ? docxResult.value.trim() : '';
        return { fullText };
      }

      default:
        throw AppError.badRequest(`Unsupported MIME type for text extraction: ${mimeType}`);
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      `Failed to extract text from document: ${error instanceof Error ? error.message : String(error)}`,
      422,
      'TEXT_EXTRACTION_FAILED',
    );
  }
}
