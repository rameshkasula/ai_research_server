import { Request, Response, NextFunction, RequestHandler } from "express";
import { AppError } from "../errors/AppError";
import { verifyAccessToken } from "../utils/jwt";
import { UserRole } from "../types/auth.types";

function extractAccessToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }

  const cookieToken = (req as Request & { cookies?: Record<string, string> })
    .cookies?.accessToken;
  if (cookieToken) {
    return cookieToken;
  }

  return null;
}

/**
 * Authentication middleware: requires a valid JWT access token.
 */
export const authenticate: RequestHandler = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  try {
    const token = extractAccessToken(req);
    if (!token) {
      throw AppError.unauthorized("Authentication token is required");
    }

    const decoded = verifyAccessToken(token);
    req.user = {
      id: decoded.sub,
      email: decoded.email,
      role: decoded.role,
    };

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Optional authentication middleware: attaches `req.user` when a valid token is present,
 * otherwise proceeds anonymously.
 */
export const optionalAuthenticate: RequestHandler = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  const token = extractAccessToken(req);
  if (!token) {
    next();
    return;
  }

  try {
    const decoded = verifyAccessToken(token);
    req.user = {
      id: decoded.sub,
      email: decoded.email,
      role: decoded.role,
    };
  } catch {
    // Ignore invalid token in optional mode
  }

  next();
};

/**
 * Role-Based Access Control (RBAC) authorization middleware.
 * Must be used after `authenticate`.
 */
export const authorize = (...allowedRoles: UserRole[]): RequestHandler => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(AppError.unauthorized("Authentication required"));
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      next(
        AppError.forbidden(
          `Access denied. Required role(s): ${allowedRoles.join(", ")}`,
        ),
      );
      return;
    }

    next();
  };
};

/**
 * Resource ownership or Admin authorization middleware.
 * Allows access if `req.user.id === req.params[paramKey]` or `req.user.role === 'admin'`.
 */
export const authorizeSelfOrAdmin = (paramKey = "id"): RequestHandler => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(AppError.unauthorized("Authentication required"));
      return;
    }

    const targetId = req.params[paramKey];
    if (req.user.role === "admin" || req.user.id === targetId) {
      next();
      return;
    }

    next(
      AppError.forbidden("You do not have permission to access this resource"),
    );
  };
};
