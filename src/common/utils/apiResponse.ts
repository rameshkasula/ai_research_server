import { Response } from 'express';

export interface ApiSuccessResponse<T> {
  success: true;
  message?: string;
  data: T;
}

export function sendSuccess<T>(
  res: Response,
  data: T,
  statusCode = 200,
  message?: string,
): Response<ApiSuccessResponse<T>> {
  return res.status(statusCode).json({
    success: true,
    ...(message ? { message } : {}),
    data,
  });
}

