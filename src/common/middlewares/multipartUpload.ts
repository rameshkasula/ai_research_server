import { Request, Response, NextFunction, RequestHandler } from 'express';
import { env } from '../../config/env';
import { AppError } from '../errors/AppError';
import {
  AllowedMimeType,
  computeSha256,
  resolveMimeType,
  validateFileMagicBytes,
  validateFileSize,
} from '../utils/fileValidator';

export interface UploadedFile {
  fieldName: string;
  originalName: string;
  mimeType: AllowedMimeType;
  size: number;
  buffer: Buffer;
  contentHash: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      uploadedFiles?: UploadedFile[];
    }
  }
}

function extractBoundary(contentType: string): string | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  return (match?.[1] ?? match?.[2])?.trim() ?? null;
}

function parseMultipartBody(
  rawBody: Buffer,
  boundary: string,
  maxFiles: number,
  maxFileSizeBytes: number,
): { fields: Record<string, string>; files: UploadedFile[] } {
  const fields: Record<string, string> = {};
  const files: UploadedFile[] = [];

  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const headerDelimiter = Buffer.from('\r\n\r\n');

  let cursor = rawBody.indexOf(boundaryBuffer);
  if (cursor === -1) {
    throw AppError.badRequest('Malformed multipart/form-data payload');
  }

  while (cursor !== -1) {
    cursor += boundaryBuffer.length;

    // Final boundary "--boundary--"
    if (rawBody[cursor] === 0x2d && rawBody[cursor + 1] === 0x2d) {
      break;
    }

    // Advance past CRLF after boundary
    if (rawBody[cursor] === 0x0d && rawBody[cursor + 1] === 0x0a) {
      cursor += 2;
    }

    const nextBoundaryIndex = rawBody.indexOf(boundaryBuffer, cursor);
    if (nextBoundaryIndex === -1) {
      break;
    }

    const headerEndIndex = rawBody.indexOf(headerDelimiter, cursor);
    if (headerEndIndex === -1 || headerEndIndex >= nextBoundaryIndex) {
      cursor = nextBoundaryIndex;
      continue;
    }

    const rawHeaders = rawBody.subarray(cursor, headerEndIndex).toString('utf8');
    const contentStart = headerEndIndex + headerDelimiter.length;
    // Strip trailing CRLF before the next boundary
    let contentEnd = nextBoundaryIndex;
    if (
      contentEnd >= 2 &&
      rawBody[contentEnd - 2] === 0x0d &&
      rawBody[contentEnd - 1] === 0x0a
    ) {
      contentEnd -= 2;
    }

    const partContent = rawBody.subarray(contentStart, contentEnd);

    const dispositionMatch = /content-disposition:\s*form-data;([^\r\n]+)/i.exec(
      rawHeaders,
    );
    if (dispositionMatch) {
      const dispositionParams = dispositionMatch[1];
      const nameMatch = /\bname="([^"]+)"/i.exec(dispositionParams);
      const fileNameMatch = /\bfilename="([^"]*)"/i.exec(dispositionParams);
      const contentTypeMatch = /content-type:\s*([^\r\n;]+)/i.exec(rawHeaders);

      const fieldName = nameMatch?.[1] ?? 'file';

      if (fileNameMatch) {
        const originalName = fileNameMatch[1].trim();
        if (originalName) {
          if (files.length >= maxFiles) {
            throw AppError.badRequest(
              `Too many files uploaded. Maximum allowed per request is ${maxFiles}`,
            );
          }

          validateFileSize(partContent.length, maxFileSizeBytes);
          const mimeType = resolveMimeType(
            originalName,
            contentTypeMatch?.[1]?.trim(),
          );
          validateFileMagicBytes(partContent, mimeType);

          const fileBuffer = Buffer.from(partContent);
          files.push({
            fieldName,
            originalName,
            mimeType,
            size: fileBuffer.length,
            buffer: fileBuffer,
            contentHash: computeSha256(fileBuffer),
          });
        }
      } else if (nameMatch) {
        fields[fieldName] = partContent.toString('utf8');
      }
    }

    cursor = nextBoundaryIndex;
  }

  return { fields, files };
}

export interface MultipartUploadOptions {
  maxFiles?: number;
  maxFileSizeBytes?: number;
}

/**
 * Middleware that parses `multipart/form-data` uploads, validates file types
 * (PDF, DOCX, TXT), enforces file size and count limits, and attaches parsed
 * files to `req.uploadedFiles`.
 */
export function parseMultipartUpload(
  options: MultipartUploadOptions = {},
): RequestHandler {
  const maxFiles = options.maxFiles ?? env.MAX_FILES_PER_UPLOAD;
  const maxFileSizeBytes = options.maxFileSizeBytes ?? env.MAX_FILE_SIZE_BYTES;
  // Total request ceiling: maxFiles * maxFileSizeBytes + 1 MB overhead for headers/fields
  const maxTotalPayloadBytes = maxFiles * maxFileSizeBytes + 1024 * 1024;

  return (req: Request, _res: Response, next: NextFunction): void => {
    const contentType = req.headers['content-type'] ?? '';
    if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
      next(
        AppError.badRequest(
          'Content-Type must be multipart/form-data for file uploads',
        ),
      );
      return;
    }

    const boundary = extractBoundary(contentType);
    if (!boundary) {
      next(AppError.badRequest('Missing multipart/form-data boundary'));
      return;
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let aborted = false;

    req.on('data', (chunk: Buffer) => {
      if (aborted) return;
      totalBytes += chunk.length;
      if (totalBytes > maxTotalPayloadBytes) {
        aborted = true;
        next(
          AppError.badRequest(
            `Upload payload exceeds maximum allowed size (${(
              maxTotalPayloadBytes /
              (1024 * 1024)
            ).toFixed(1)} MB)`,
          ),
        );
        return;
      }
      chunks.push(chunk);
    });

    req.on('error', (err) => {
      if (!aborted) {
        aborted = true;
        next(err);
      }
    });

    req.on('end', () => {
      if (aborted) return;
      try {
        const rawBody = Buffer.concat(chunks);
        const { fields, files } = parseMultipartBody(
          rawBody,
          boundary,
          maxFiles,
          maxFileSizeBytes,
        );

        if (files.length === 0) {
          throw AppError.badRequest('At least one file is required');
        }

        req.body = { ...(req.body ?? {}), ...fields };
        req.uploadedFiles = files;
        next();
      } catch (error) {
        next(error);
      }
    });
  };
}

