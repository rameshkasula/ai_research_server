import crypto from 'crypto';
import path from 'path';
import { env } from '../../config/env';
import { AppError } from '../errors/AppError';

export const ALLOWED_DOCUMENT_TYPES = {
  'application/pdf': {
    extensions: ['.pdf'],
    label: 'PDF',
  },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    extensions: ['.docx'],
    label: 'DOCX',
  },
  'text/plain': {
    extensions: ['.txt'],
    label: 'TXT',
  },
} as const;

export type AllowedMimeType = keyof typeof ALLOWED_DOCUMENT_TYPES;

export const ALLOWED_MIME_TYPES = Object.keys(
  ALLOWED_DOCUMENT_TYPES,
) as AllowedMimeType[];

export const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.txt'] as const;

const EXTENSION_TO_MIME: Record<string, AllowedMimeType> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
};

export function resolveMimeType(
  originalName: string,
  providedMimeType?: string,
): AllowedMimeType {
  const ext = path.extname(originalName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext as (typeof ALLOWED_EXTENSIONS)[number])) {
    throw AppError.badRequest(
      `Unsupported file extension "${ext || 'none'}". Allowed formats: PDF (.pdf), DOCX (.docx), TXT (.txt)`,
    );
  }

  const expectedMime = EXTENSION_TO_MIME[ext];
  const normalizedMime = providedMimeType?.toLowerCase().split(';')[0].trim();

  // Browsers sometimes send application/octet-stream for drag-and-drop files;
  // allow it if the extension is valid and magic bytes match, otherwise require matching MIME.
  if (
    normalizedMime &&
    normalizedMime !== 'application/octet-stream' &&
    normalizedMime !== expectedMime
  ) {
    throw AppError.badRequest(
      `File MIME type "${normalizedMime}" does not match extension "${ext}" (expected "${expectedMime}")`,
    );
  }

  return expectedMime;
}

export function validateFileSize(fileSize: number, maxBytes = env.MAX_FILE_SIZE_BYTES): void {
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    throw AppError.badRequest('File cannot be empty (0 bytes)');
  }

  if (fileSize > maxBytes) {
    const maxMb = (maxBytes / (1024 * 1024)).toFixed(1);
    throw AppError.badRequest(
      `File size (${fileSize} bytes) exceeds maximum allowed size of ${maxMb} MB`,
    );
  }
}

export function validateFileMagicBytes(buffer: Buffer, mimeType: AllowedMimeType): void {
  if (buffer.length === 0) {
    throw AppError.badRequest('Uploaded file is empty');
  }

  if (mimeType === 'application/pdf') {
    // PDF files start with "%PDF-" (0x25 0x50 0x44 0x46 0x2D)
    const header = buffer.subarray(0, 5).toString('ascii');
    if (header !== '%PDF-') {
      throw AppError.badRequest('Invalid PDF file content (missing %PDF- signature)');
    }
    return;
  }

  if (
    mimeType ===
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    // DOCX is a ZIP container starting with PK\x03\x04 (0x50 0x4B 0x03 0x04)
    if (
      buffer.length < 4 ||
      buffer[0] !== 0x50 ||
      buffer[1] !== 0x4b ||
      buffer[2] !== 0x03 ||
      buffer[3] !== 0x04
    ) {
      throw AppError.badRequest('Invalid DOCX file content (invalid OpenXML/ZIP signature)');
    }
    return;
  }

  if (mimeType === 'text/plain') {
    // Reject binary files disguised as .txt by checking for null bytes in the first 8KB
    const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
    if (sample.includes(0x00)) {
      throw AppError.badRequest('Invalid TXT file content (binary content detected)');
    }
  }
}

export function validateFileMetadata(input: {
  originalName: string;
  mimeType?: string;
  fileSize: number;
}): { mimeType: AllowedMimeType } {
  if (!input.originalName || !input.originalName.trim()) {
    throw AppError.badRequest('File originalName is required');
  }

  const mimeType = resolveMimeType(input.originalName, input.mimeType);
  validateFileSize(input.fileSize);

  return { mimeType };
}

export function computeSha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function sanitizeFileName(fileName: string): string {
  const base = path.basename(fileName);
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

