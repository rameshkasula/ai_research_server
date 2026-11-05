import mongoose from 'mongoose';
import { AppError } from '../../common/errors/AppError';
import { documentService } from '../document/document.service';
import { IWorkspace, WorkspaceModel } from './workspace.model';
import {
  CreateWorkspaceInput,
  ListWorkspacesQuery,
  UpdateWorkspaceInput,
} from './workspace.schema';

export interface WorkspaceCounts {
  documentCount: number;
  conversationCount: number;
}

export interface WorkspaceWithStats {
  id: string;
  userId: string;
  name: string;
  description: string;
  status: string;
  documentCount: number;
  conversationCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceDashboard {
  workspace: WorkspaceWithStats;
  stats: {
    documentCount: number;
    conversationCount: number;
    lastUpdatedAt: Date;
  };
}

export interface PaginatedWorkspaces {
  workspaces: WorkspaceWithStats[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class WorkspaceService {
  /**
   * Counts documents and research conversations belonging to a workspace.
   * Queries the underlying `documents` and `conversations` collections safely even
   * before their Mongoose models are registered in later phases.
   */
  private async getWorkspaceCounts(
    workspaceId: mongoose.Types.ObjectId,
  ): Promise<WorkspaceCounts> {
    const db = mongoose.connection.db;
    if (!db) {
      return { documentCount: 0, conversationCount: 0 };
    }

    const filter = {
      $or: [{ workspaceId }, { workspaceId: String(workspaceId) }],
    };

    const [documentCount, conversationCount] = await Promise.all([
      db
        .collection('documents')
        .countDocuments(filter)
        .catch(() => 0),
      db
        .collection('conversations')
        .countDocuments(filter)
        .catch(() => 0),
    ]);

    return { documentCount, conversationCount };
  }

  private formatWorkspaceWithStats(
    workspace: IWorkspace,
    counts: WorkspaceCounts,
  ): WorkspaceWithStats {
    return {
      id: String(workspace._id),
      userId: String(workspace.userId),
      name: workspace.name,
      description: workspace.description,
      status: workspace.status,
      documentCount: counts.documentCount,
      conversationCount: counts.conversationCount,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    };
  }

  /**
   * Fetches a workspace by ID and enforces strict user ownership isolation.
   */
  private async getOwnedWorkspaceOrThrow(
    userId: string,
    workspaceId: string,
  ): Promise<IWorkspace> {
    const workspace = await WorkspaceModel.findById(workspaceId);

    if (!workspace) {
      throw AppError.notFound('Workspace not found');
    }

    if (String(workspace.userId) !== userId) {
      throw AppError.forbidden('You do not have permission to access this workspace');
    }

    return workspace;
  }

  async createWorkspace(
    userId: string,
    input: CreateWorkspaceInput,
  ): Promise<WorkspaceWithStats> {
    const workspace = await WorkspaceModel.create({
      userId: new mongoose.Types.ObjectId(userId),
      name: input.name,
      description: input.description ?? '',
      status: input.status ?? 'active',
    });

    return this.formatWorkspaceWithStats(workspace, {
      documentCount: 0,
      conversationCount: 0,
    });
  }

  async listWorkspaces(
    userId: string,
    query: ListWorkspacesQuery,
  ): Promise<PaginatedWorkspaces> {
    const {
      search,
      q,
      status,
      page = 1,
      limit = 20,
      sortBy = 'updatedAt',
      sortOrder = 'desc',
    } = query;

    const filter: Record<string, unknown> = {
      userId: new mongoose.Types.ObjectId(userId),
    };

    if (status) {
      filter.status = status;
    }

    const searchTerm = (search ?? q)?.trim();
    if (searchTerm) {
      const regex = new RegExp(escapeRegex(searchTerm), 'i');
      filter.$or = [{ name: regex }, { description: regex }];
    }

    const skip = (page - 1) * limit;
    const sortDirection = sortOrder === 'asc' ? 1 : -1;

    const [workspaces, total] = await Promise.all([
      WorkspaceModel.find(filter)
        .sort({ [sortBy]: sortDirection })
        .skip(skip)
        .limit(limit),
      WorkspaceModel.countDocuments(filter),
    ]);

    const workspacesWithStats = await Promise.all(
      workspaces.map(async (ws) => {
        const counts = await this.getWorkspaceCounts(ws._id);
        return this.formatWorkspaceWithStats(ws, counts);
      }),
    );

    return {
      workspaces: workspacesWithStats,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async getWorkspaceById(
    userId: string,
    workspaceId: string,
  ): Promise<WorkspaceWithStats> {
    const workspace = await this.getOwnedWorkspaceOrThrow(userId, workspaceId);
    const counts = await this.getWorkspaceCounts(workspace._id);
    return this.formatWorkspaceWithStats(workspace, counts);
  }

  async getWorkspaceDashboard(
    userId: string,
    workspaceId: string,
  ): Promise<WorkspaceDashboard> {
    const workspace = await this.getOwnedWorkspaceOrThrow(userId, workspaceId);
    const counts = await this.getWorkspaceCounts(workspace._id);
    const formatted = this.formatWorkspaceWithStats(workspace, counts);

    return {
      workspace: formatted,
      stats: {
        documentCount: counts.documentCount,
        conversationCount: counts.conversationCount,
        lastUpdatedAt: workspace.updatedAt,
      },
    };
  }

  async updateWorkspace(
    userId: string,
    workspaceId: string,
    input: UpdateWorkspaceInput,
  ): Promise<WorkspaceWithStats> {
    const workspace = await this.getOwnedWorkspaceOrThrow(userId, workspaceId);

    if (input.name !== undefined) {
      workspace.name = input.name;
    }
    if (input.description !== undefined) {
      workspace.description = input.description;
    }
    if (input.status !== undefined) {
      workspace.status = input.status;
    }

    await workspace.save();

    const counts = await this.getWorkspaceCounts(workspace._id);
    return this.formatWorkspaceWithStats(workspace, counts);
  }

  async deleteWorkspace(userId: string, workspaceId: string): Promise<void> {
    const workspace = await this.getOwnedWorkspaceOrThrow(userId, workspaceId);
    await documentService.deleteAllWorkspaceDocuments(String(workspace._id));
    await workspace.deleteOne();
  }
}

export const workspaceService = new WorkspaceService();

