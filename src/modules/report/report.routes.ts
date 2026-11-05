import { Request, Response, Router } from 'express';
import { AppError } from '../../common/errors/AppError';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { sendSuccess } from '../../common/utils/apiResponse';
import { sanitizeFileName } from '../../common/utils/fileValidator';
import { authenticate } from '../../common/middlewares/auth.middleware';
import { validateRequest } from '../../common/middlewares/validateRequest';
import { aiRateLimiter } from '../../common/middlewares/rateLimiter';
import { ReportSectionKey } from './report.model';
import { reportService } from './report.service';
import {
  renderReportToMarkdown,
  renderReportToPdfBuffer,
} from './pdfGenerator.util';
import {
  CreateReportInput,
  createReportBodySchema,
  RegenerateSectionInput,
  regenerateSectionBodySchema,
  regenerateSectionParamsSchema,
  reportIdParamsSchema,
  sharedExportParamsSchema,
  ShareReportInput,
  shareReportBodySchema,
  shareTokenParamsSchema,
  UpdateReportInput,
  updateReportBodySchema,
  workspaceReportParamsSchema,
} from './report.schema';

function requireUserId(req: Request): string {
  if (!req.user?.id) {
    throw AppError.unauthorized('Authentication required');
  }
  return req.user.id;
}

function resolveWorkspaceId(req: Request): string {
  const wsId =
    (req.params as { workspaceId?: string }).workspaceId ||
    (req.body as { workspaceId?: string } | undefined)?.workspaceId ||
    (req.query as { workspaceId?: string } | undefined)?.workspaceId;

  if (!wsId || !/^[0-9a-fA-F]{24}$/.test(wsId)) {
    throw AppError.badRequest('A valid workspaceId is required');
  }
  return wsId;
}

export class ReportController {
  generate = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const workspaceId = resolveWorkspaceId(req);
    const body = req.body as CreateReportInput;

    const report = await reportService.generateReport(userId, workspaceId, body);
    sendSuccess(res, { report }, 201, 'Research report generated successfully');
  });

  list = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const workspaceId =
      (req.params as { workspaceId?: string }).workspaceId ||
      (req.query as { workspaceId?: string } | undefined)?.workspaceId;

    const reports = await reportService.listReports(userId, workspaceId);
    sendSuccess(res, { reports }, 200, 'Reports retrieved successfully');
  });

  getById = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    const report = await reportService.getOwnedReportOrThrow(userId, id);
    const markdown = renderReportToMarkdown(report);
    sendSuccess(
      res,
      { report, markdown },
      200,
      'Report retrieved successfully',
    );
  });

  updateManually = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    const body = req.body as UpdateReportInput;

    const report = await reportService.updateReportManually(userId, id, body);
    sendSuccess(res, { report }, 200, 'Report updated successfully');
  });

  regenerateSection = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const { id, sectionKey } = req.params as {
      id: string;
      sectionKey: ReportSectionKey;
    };
    const body = req.body as RegenerateSectionInput;

    const report = await reportService.regenerateSection(
      userId,
      id,
      sectionKey,
      body,
    );
    sendSuccess(
      res,
      { report, updatedSection: report.sections[sectionKey] },
      200,
      `Section "${sectionKey}" regenerated successfully`,
    );
  });

  remove = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    await reportService.deleteReport(userId, id);
    sendSuccess(res, null, 200, 'Report deleted successfully');
  });

  exportMarkdown = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    const report = await reportService.getOwnedReportOrThrow(userId, id);
    const markdown = renderReportToMarkdown(report);
    const fileName = `${sanitizeFileName(report.title || 'research-report')}.md`;

    if (req.query.raw === 'true') {
      sendSuccess(res, { title: report.title, markdown }, 200, 'Markdown generated');
      return;
    }

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.status(200).send(markdown);
  });

  exportPdf = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    const report = await reportService.getOwnedReportOrThrow(userId, id);
    const pdfBuffer = renderReportToPdfBuffer(report);
    const fileName = `${sanitizeFileName(report.title || 'research-report')}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', String(pdfBuffer.length));
    res.status(200).send(pdfBuffer);
  });

  configureShare = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    const body = req.body as ShareReportInput;
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    const result = await reportService.configureSharing(userId, id, body, baseUrl);
    sendSuccess(res, result, 200, 'Report sharing settings updated');
  });

  revokeShare = asyncHandler(async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    await reportService.revokeSharing(userId, id);
    sendSuccess(res, null, 200, 'Report sharing link revoked');
  });

  /**
   * Public read-only endpoint for shared reports.
   * Exposes ONLY report content and citations — never exposes private workspaceId or userId.
   */
  getSharedReport = asyncHandler(async (req: Request, res: Response) => {
    const { shareToken } = req.params as { shareToken: string };
    const report = await reportService.getSharedReportByToken(shareToken);

    sendSuccess(
      res,
      {
        report: {
          title: report.title,
          objective: report.objective,
          sections: report.sections,
          sources: report.sources,
          version: report.version,
          allowDownload: report.shareSettings.allowDownload,
          expiresAt: report.shareSettings.expiresAt,
          createdAt: report.createdAt,
          updatedAt: report.updatedAt,
        },
        markdown: renderReportToMarkdown(report),
      },
      200,
      'Shared report retrieved (read-only)',
    );
  });

  exportSharedReport = asyncHandler(async (req: Request, res: Response) => {
    const { shareToken, format } = req.params as {
      shareToken: string;
      format: 'pdf' | 'markdown' | 'md';
    };

    const report = await reportService.getSharedReportByToken(shareToken);
    if (!report.shareSettings.allowDownload) {
      throw AppError.forbidden('Downloads are disabled for this shared report');
    }

    const baseName = sanitizeFileName(report.title || 'shared-research-report');

    if (format === 'pdf') {
      const pdfBuffer = renderReportToPdfBuffer(report);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.pdf"`);
      res.status(200).send(pdfBuffer);
      return;
    }

    const markdown = renderReportToMarkdown(report);
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.md"`);
    res.status(200).send(markdown);
  });
}

export const reportController = new ReportController();

const router = Router();

// Public read-only shared report routes (no auth required, validated by expiring shareToken)
router.get(
  '/shared/reports/:shareToken',
  validateRequest({ params: shareTokenParamsSchema }),
  reportController.getSharedReport,
);

router.get(
  '/shared/reports/:shareToken/export/:format',
  validateRequest({ params: sharedExportParamsSchema }),
  reportController.exportSharedReport,
);

// Authenticated report routes
router.use(authenticate);

router.post(
  '/reports',
  aiRateLimiter,
  validateRequest({ body: createReportBodySchema }),
  reportController.generate,
);

router.get('/reports', reportController.list);

router.get(
  '/reports/:id',
  validateRequest({ params: reportIdParamsSchema }),
  reportController.getById,
);

router.patch(
  '/reports/:id',
  validateRequest({
    params: reportIdParamsSchema,
    body: updateReportBodySchema,
  }),
  reportController.updateManually,
);

router.post(
  '/reports/:id/sections/:sectionKey/regenerate',
  aiRateLimiter,
  validateRequest({
    params: regenerateSectionParamsSchema,
    body: regenerateSectionBodySchema,
  }),
  reportController.regenerateSection,
);

router.get(
  '/reports/:id/export/markdown',
  validateRequest({ params: reportIdParamsSchema }),
  reportController.exportMarkdown,
);

router.get(
  '/reports/:id/export/pdf',
  validateRequest({ params: reportIdParamsSchema }),
  reportController.exportPdf,
);

router.post(
  '/reports/:id/share',
  validateRequest({
    params: reportIdParamsSchema,
    body: shareReportBodySchema,
  }),
  reportController.configureShare,
);

router.delete(
  '/reports/:id/share',
  validateRequest({ params: reportIdParamsSchema }),
  reportController.revokeShare,
);

router.delete(
  '/reports/:id',
  validateRequest({ params: reportIdParamsSchema }),
  reportController.remove,
);

router.post(
  '/workspaces/:workspaceId/reports',
  aiRateLimiter,
  validateRequest({
    params: workspaceReportParamsSchema,
    body: createReportBodySchema,
  }),
  reportController.generate,
);

router.get(
  '/workspaces/:workspaceId/reports',
  validateRequest({ params: workspaceReportParamsSchema }),
  reportController.list,
);

export const reportRoutes = router;

