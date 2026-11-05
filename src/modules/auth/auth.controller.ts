import { Request, Response, CookieOptions } from "express";
import { env } from "../../config/env";
import { AppError } from "../../common/errors/AppError";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { sendSuccess } from "../../common/utils/apiResponse";
import { authService, AuthTokens } from "./auth.service";
import {
  ChangePasswordInput,
  LoginInput,
  RefreshTokenInput,
  RegisterInput,
  UpdateProfileInput,
  UpdateUserRoleInput,
} from "./auth.schema";

const REFRESH_COOKIE_NAME = "refreshToken";

function getRefreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: env.NODE_ENV === "production" ? "strict" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: "/api/v1/auth",
  };
}

function attachRefreshCookie(res: Response, tokens: AuthTokens): void {
  res.cookie(
    REFRESH_COOKIE_NAME,
    tokens.refreshToken,
    getRefreshCookieOptions(),
  );
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: env.NODE_ENV === "production" ? "strict" : "lax",
    path: "/api/v1/auth",
  });
}

export class AuthController {
  register = asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as RegisterInput;
    const { user, tokens } = await authService.register(body);

    attachRefreshCookie(res, tokens);
    sendSuccess(res, { user, tokens }, 201, "User registered successfully");
  });

  login = asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as LoginInput;
    const { user, tokens } = await authService.login(body);

    attachRefreshCookie(res, tokens);
    sendSuccess(res, { user, tokens }, 200, "Logged in successfully");
  });

  refresh = asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as RefreshTokenInput;
    const cookieToken = (
      req.cookies as Record<string, string | undefined> | undefined
    )?.[REFRESH_COOKIE_NAME];
    const refreshToken = body.refreshToken || cookieToken;

    if (!refreshToken) {
      throw AppError.unauthorized("Refresh token is required");
    }

    const { user, tokens } = await authService.refreshTokens(refreshToken);

    attachRefreshCookie(res, tokens);
    sendSuccess(res, { user, tokens }, 200, "Tokens refreshed successfully");
  });

  logout = asyncHandler(async (req: Request, res: Response) => {
    if (req.user) {
      await authService.logout(req.user.id);
    }

    clearRefreshCookie(res);
    sendSuccess(res, null, 200, "Logged out successfully");
  });

  getMe = asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      throw AppError.unauthorized("Authentication required");
    }

    const user = await authService.getMe(req.user.id);
    sendSuccess(res, { user }, 200, "Current user profile retrieved");
  });

  updateProfile = asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      throw AppError.unauthorized("Authentication required");
    }

    const body = req.body as UpdateProfileInput;
    const user = await authService.updateProfile(req.user.id, body);
    sendSuccess(res, { user }, 200, "Profile updated successfully");
  });

  changePassword = asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      throw AppError.unauthorized("Authentication required");
    }

    const body = req.body as ChangePasswordInput;
    await authService.changePassword(req.user.id, body);

    clearRefreshCookie(res);
    sendSuccess(
      res,
      null,
      200,
      "Password changed successfully. Please log in again.",
    );
  });

  listUsers = asyncHandler(async (_req: Request, res: Response) => {
    const users = await authService.listUsers();
    sendSuccess(res, { users }, 200, "Users retrieved successfully");
  });

  updateUserRole = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const { role } = req.body as UpdateUserRoleInput;

    const user = await authService.updateUserRole(id, role);
    sendSuccess(res, { user }, 200, "User role updated successfully");
  });
}

export const authController = new AuthController();
