import { Request, Response, NextFunction, RequestHandler } from 'express';
import { cacheService } from '../cache/cache.service';

interface CachedIdempotentResponse {
  statusCode: number;
  body: unknown;
}

/**
 * Idempotency middleware supporting the `Idempotency-Key` header on mutating requests.
 * Prevents duplicate execution when clients retry network requests.
 */
export const idempotencyMiddleware: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  if (!['POST', 'PATCH', 'PUT'].includes(req.method)) {
    next();
    return;
  }

  const idempotencyKey = req.header('Idempotency-Key')?.trim();
  if (!idempotencyKey) {
    next();
    return;
  }

  const userScope = req.user?.id ?? req.ip ?? 'anon';
  const cacheKey = `idempotency:${userScope}:${req.method}:${req.originalUrl}:${idempotencyKey}`;

  const existing = await cacheService.get<CachedIdempotentResponse>(cacheKey);
  if (existing) {
    res.setHeader('X-Idempotent-Replayed', 'true');
    res.status(existing.statusCode).json(existing.body);
    return;
  }

  const originalJson = res.json.bind(res);
  res.json = (body: unknown): Response => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      void cacheService.set(
        cacheKey,
        { statusCode: res.statusCode, body },
        3600, // 1 hour TTL
      );
    }
    return originalJson(body);
  };

  next();
};

