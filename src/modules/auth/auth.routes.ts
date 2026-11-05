import { Router } from 'express';
import { validateRequest } from '../../common/middlewares/validateRequest';
import { authenticate, authorize } from '../../common/middlewares/auth.middleware';
import { authController } from './auth.controller';
import {
  changePasswordBodySchema,
  loginBodySchema,
  refreshTokenBodySchema,
  registerBodySchema,
  updateProfileBodySchema,
  updateUserRoleBodySchema,
  updateUserRoleParamsSchema,
} from './auth.schema';

const router = Router();

// Public routes
router.post(
  '/register',
  validateRequest({ body: registerBodySchema }),
  authController.register,
);

router.post(
  '/login',
  validateRequest({ body: loginBodySchema }),
  authController.login,
);

router.post(
  '/refresh',
  validateRequest({ body: refreshTokenBodySchema }),
  authController.refresh,
);

// Authenticated routes
router.post('/logout', authenticate, authController.logout);
router.get('/me', authenticate, authController.getMe);

router.patch(
  '/me',
  authenticate,
  validateRequest({ body: updateProfileBodySchema }),
  authController.updateProfile,
);

router.patch(
  '/change-password',
  authenticate,
  validateRequest({ body: changePasswordBodySchema }),
  authController.changePassword,
);

// Admin-only routes (Role-Based Access Control)
router.get(
  '/admin/users',
  authenticate,
  authorize('admin'),
  authController.listUsers,
);

router.patch(
  '/admin/users/:id/role',
  authenticate,
  authorize('admin'),
  validateRequest({
    params: updateUserRoleParamsSchema,
    body: updateUserRoleBodySchema,
  }),
  authController.updateUserRole,
);

export const authRoutes = router;

