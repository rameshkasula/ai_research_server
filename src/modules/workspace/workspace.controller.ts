import { Request, Response } from 'express';
import { AppError } from '../../common/errors/AppError';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { sendSuccess } from '../../common/utils/apiResponse';
import { workspaceService } from './workspace.service';
import {
  CreateWorkspaceInput,
  ListWorkspacesQuery,
  UpdateWorkspaceInput,
  WorkspaceIdParams,
} from './workspace.schema';

function requireUserId(req: Request): string {
  if (!req.user?.id) {
    throw AppError.unauthorized('Authentication required');
  }
  return req.user.id;
}

export class WorkspaceController {
  create = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const body = req.body as CreateWorkspaceInput;

    const workspace = await workspaceService.createWorkspace(userId, body);
    sendSuccess(res, { workspace }, 201, 'Workspace created successfully');
  });

  list = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const query = req.query as unknown as ListWorkspacesQuery;

    const result = await workspaceService.listWorkspaces(userId, query);
    sendSuccess(res, result, 200, 'Workspaces retrieved successfully');
  });

  getById = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const { id } = req.params as unknown as WorkspaceIdParams;

    const workspace = await workspaceService.getWorkspaceById(userId, id);
    sendSuccess(res, { workspace }, 200, 'Workspace details retrieved successfully');
  });

  getDashboard = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const { id } = req.params as unknown as WorkspaceIdParams;

    const dashboard = await workspaceService.getWorkspaceDashboard(userId, id);
    sendSuccess(res, dashboard, 200, 'Workspace dashboard retrieved successfully');
  });

  update = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const { id } = req.params as unknown as WorkspaceIdParams;
    const body = req.body as UpdateWorkspaceInput;

    const workspace = await workspaceService.updateWorkspace(userId, id, body);
    sendSuccess(res, { workspace }, 200, 'Workspace updated successfully');
  });

  remove = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const { id } = req.params as unknown as WorkspaceIdParams;

    await workspaceService.deleteWorkspace(userId, id);
    sendSuccess(res, null, 200, 'Workspace deleted successfully');
  });
}

export const workspaceController = new WorkspaceController();

