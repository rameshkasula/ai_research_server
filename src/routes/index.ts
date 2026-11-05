import { Router } from 'express';
import { healthRoutes } from '../modules/health/health.routes';
import { authRoutes } from '../modules/auth/auth.routes';
import { workspaceRoutes } from '../modules/workspace/workspace.routes';
import { documentRoutes } from '../modules/document/document.routes';
import { chunkRoutes } from '../modules/chunk/chunk.routes';
import { searchRoutes } from '../modules/search/search.routes';
import { ragRoutes } from '../modules/rag/rag.routes';

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/workspaces', workspaceRoutes);
router.use('/documents', documentRoutes);
router.use('/', chunkRoutes);
router.use('/', searchRoutes);
router.use('/', ragRoutes);

export const apiRouter = router;
