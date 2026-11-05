import jwt, { SignOptions } from 'jsonwebtoken';
import { env } from '../../config/env';
import { AppError } from '../errors/AppError';
import { TokenPayload, UserRole } from '../types/auth.types';

export interface SignTokenInput {
  userId: string;
  email: string;
  role: UserRole;
}

export function signAccessToken(input: SignTokenInput): string {
  const payload: TokenPayload = {
    sub: input.userId,
    email: input.email,
    role: input.role,
    type: 'access',
  };

  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as SignOptions['expiresIn'],
  });
}

export function signRefreshToken(input: SignTokenInput): string {
  const payload: TokenPayload = {
    sub: input.userId,
    email: input.email,
    role: input.role,
    type: 'refresh',
  };

  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as SignOptions['expiresIn'],
  });
}

export function verifyAccessToken(token: string): TokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as TokenPayload;
    if (decoded.type !== 'access') {
      throw AppError.unauthorized('Invalid access token type');
    }
    return decoded;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw AppError.unauthorized('Invalid or expired access token');
  }
}

export function verifyRefreshToken(token: string): TokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET) as TokenPayload;
    if (decoded.type !== 'refresh') {
      throw AppError.unauthorized('Invalid refresh token type');
    }
    return decoded;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw AppError.unauthorized('Invalid or expired refresh token');
  }
}

