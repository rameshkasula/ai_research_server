import { Router } from 'express';
import { healthRoutes } from '../modules/health/health.routes';
import { authRoutes } from '../modules/auth/auth.routes';
import { workspaceRoutes } from '../modules/workspace/workspace.routes';
import { documentRoutes } from '../modules/document/document.routes';
import { chunkRoutes } from '../modules/chunk/chunk.routes';
import { searchRoutes } from '../modules/search/search.routes';
import { ragRoutes } from '../modules/rag/rag.routes';
import { conversationRoutes } from '../modules/conversation/conversation.routes';
import { webResearchRoutes } from '../modules/web-research/webResearch.routes';
import { agentRoutes } from '../modules/agent/agent.routes';
import { reportRoutes } from '../modules/report/report.routes';
import { observabilityRoutes } from '../modules/observability/observability.routes';
import { authRateLimiter } from '../common/middlewares/rateLimiter';

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRateLimiter, authRoutes);
router.use('/workspaces', workspaceRoutes);
router.use('/documents', documentRoutes);
router.use('/conversations', conversationRoutes);
router.use('/', chunkRoutes);
router.use('/', searchRoutes);
router.use('/', ragRoutes);
router.use('/', webResearchRoutes);
router.use('/', agentRoutes);
router.use('/', reportRoutes);
router.use('/', observabilityRoutes);

export const apiRouter = router;
