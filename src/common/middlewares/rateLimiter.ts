import { Request, Response, NextFunction, RequestHandler } from 'express';
import { env } from '../../config/env';
import { AppError } from '../errors/AppError';

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export interface RateLimiterOptions {
  windowMs?: number;
  maxRequests?: number;
  keyPrefix?: string;
  message?: string;
}

export function createRateLimiter(options: RateLimiterOptions = {}): RequestHandler {
  const windowMs = options.windowMs ?? env.RATE_LIMIT_WINDOW_MS;
  const maxRequests = options.maxRequests ?? env.RATE_LIMIT_MAX_REQUESTS;
  const keyPrefix = options.keyPrefix ?? 'global';
  const message =
    options.message ?? 'Too many requests, please try again later.';

  const buckets = new Map<string, RateLimitBucket>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const identifier = req.user?.id || req.ip || 'anonymous';
    const bucketKey = `${keyPrefix}:${identifier}`;
    const now = Date.now();

    let bucket = buckets.get(bucketKey);
    if (!bucket || now > bucket.resetAt) {
      bucket = {
        count: 0,
        resetAt: now + windowMs,
      };
    }

    bucket.count += 1;
    buckets.set(bucketKey, bucket);

    const remaining = Math.max(0, maxRequests - bucket.count);
    const resetSeconds = Math.ceil((bucket.resetAt - now) / 1000);

    res.setHeader('X-RateLimit-Limit', String(maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(resetSeconds));

    if (bucket.count > maxRequests) {
      res.setHeader('Retry-After', String(resetSeconds));
      next(new AppError(message, 429, 'RATE_LIMIT_EXCEEDED'));
      return;
    }

    next();
  };
}

export const apiRateLimiter = createRateLimiter({
  keyPrefix: 'api',
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  maxRequests: env.RATE_LIMIT_MAX_REQUESTS,
});

export const authRateLimiter = createRateLimiter({
  keyPrefix: 'auth',
  windowMs: 60_000,
  maxRequests: 25,
  message: 'Too many authentication attempts. Please wait a minute.',
});

export const aiRateLimiter = createRateLimiter({
  keyPrefix: 'ai',
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  maxRequests: env.AI_RATE_LIMIT_MAX_REQUESTS,
  message: 'AI generation rate limit reached. Please wait briefly before retrying.',
});

