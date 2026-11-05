import bcrypt from 'bcryptjs';
import { AppError } from '../../common/errors/AppError';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../common/utils/jwt';
import { UserRole } from '../../common/types/auth.types';
import { IUser, UserModel } from '../user/user.model';
import {
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
  UpdateProfileInput,
} from './auth.schema';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult {
  user: IUser;
  tokens: AuthTokens;
}

export class AuthService {
  private async generateAndStoreTokens(user: IUser): Promise<AuthTokens> {
    const tokenInput = {
      userId: String(user._id),
      email: user.email,
      role: user.role,
    };

    const accessToken = signAccessToken(tokenInput);
    const refreshToken = signRefreshToken(tokenInput);

    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    await UserModel.findByIdAndUpdate(user._id, { refreshTokenHash });

    return { accessToken, refreshToken };
  }

  async register(input: RegisterInput): Promise<AuthResult> {
    const existingUser = await UserModel.findOne({ email: input.email });
    if (existingUser) {
      throw AppError.conflict('A user with this email already exists');
    }

    const user = await UserModel.create({
      name: input.name,
      email: input.email,
      password: input.password,
      role: input.role,
      lastLoginAt: new Date(),
    });

    const tokens = await this.generateAndStoreTokens(user);
    return { user, tokens };
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const user = await UserModel.findOne({ email: input.email }).select('+password');
    if (!user) {
      throw AppError.unauthorized('Invalid email or password');
    }

    if (!user.isActive) {
      throw AppError.forbidden('Account has been deactivated');
    }

    const isPasswordValid = await user.comparePassword(input.password);
    if (!isPasswordValid) {
      throw AppError.unauthorized('Invalid email or password');
    }

    user.lastLoginAt = new Date();
    await user.save();

    const tokens = await this.generateAndStoreTokens(user);
    return { user, tokens };
  }

  async refreshTokens(refreshToken: string): Promise<AuthResult> {
    const decoded = verifyRefreshToken(refreshToken);

    const user = await UserModel.findById(decoded.sub).select('+refreshTokenHash');
    if (!user || !user.refreshTokenHash) {
      throw AppError.unauthorized('Invalid refresh session');
    }

    if (!user.isActive) {
      throw AppError.forbidden('Account has been deactivated');
    }

    const isMatch = await bcrypt.compare(refreshToken, user.refreshTokenHash);
    if (!isMatch) {
      // Potential token reuse; invalidate stored refresh token
      await UserModel.findByIdAndUpdate(user._id, { refreshTokenHash: null });
      throw AppError.unauthorized('Invalid or revoked refresh token');
    }

    const tokens = await this.generateAndStoreTokens(user);
    return { user, tokens };
  }

  async logout(userId: string): Promise<void> {
    await UserModel.findByIdAndUpdate(userId, { refreshTokenHash: null });
  }

  async getMe(userId: string): Promise<IUser> {
    const user = await UserModel.findById(userId);
    if (!user) {
      throw AppError.notFound('User not found');
    }
    return user;
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<IUser> {
    const user = await UserModel.findByIdAndUpdate(
      userId,
      { name: input.name },
      { new: true, runValidators: true },
    );

    if (!user) {
      throw AppError.notFound('User not found');
    }

    return user;
  }

  async changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
    const user = await UserModel.findById(userId).select('+password');
    if (!user) {
      throw AppError.notFound('User not found');
    }

    const isMatch = await user.comparePassword(input.currentPassword);
    if (!isMatch) {
      throw AppError.badRequest('Current password is incorrect');
    }

    user.password = input.newPassword;
    user.refreshTokenHash = null;
    await user.save();
  }

  async listUsers(): Promise<IUser[]> {
    return UserModel.find().sort({ createdAt: -1 });
  }

  async updateUserRole(userId: string, role: UserRole): Promise<IUser> {
    const user = await UserModel.findByIdAndUpdate(
      userId,
      { role },
      { new: true, runValidators: true },
    );

    if (!user) {
      throw AppError.notFound('User not found');
    }

    return user;
  }
}

export const authService = new AuthService();

