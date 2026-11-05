import { v2 as cloudinary } from 'cloudinary';
import { env } from './env';
import { AppError } from '../common/errors/AppError';

let isConfigured = false;

export function getCloudinary() {
  if (!isConfigured) {
    if (
      !env.CLOUDINARY_CLOUD_NAME ||
      !env.CLOUDINARY_API_KEY ||
      !env.CLOUDINARY_API_SECRET
    ) {
      throw new AppError(
        'Cloudinary credentials (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET) are not configured',
        500,
        'CLOUDINARY_CONFIG_ERROR',
      );
    }

    cloudinary.config({
      cloud_name: env.CLOUDINARY_CLOUD_NAME,
      api_key: env.CLOUDINARY_API_KEY,
      api_secret: env.CLOUDINARY_API_SECRET,
      secure: true,
    });

    isConfigured = true;
  }

  return cloudinary;
}

