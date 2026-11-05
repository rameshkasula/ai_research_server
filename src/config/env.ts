import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    PORT: z.coerce.number().int().positive().default(5000),
    MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
    CORS_ORIGIN: z.string().default("*"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

    // Auth & JWT
    JWT_ACCESS_SECRET: z
      .string()
      .min(16, "JWT_ACCESS_SECRET must be at least 16 characters"),
    JWT_REFRESH_SECRET: z
      .string()
      .min(16, "JWT_REFRESH_SECRET must be at least 16 characters"),
    JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
    JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
    BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(8).max(16).default(12),

    // Object Storage & Document Uploads (Cloudinary + Local fallback)
    STORAGE_PROVIDER: z.enum(["cloudinary", "local"]).default("cloudinary"),
    CLOUDINARY_CLOUD_NAME: z.string().optional(),
    CLOUDINARY_API_KEY: z.string().optional(),
    CLOUDINARY_API_SECRET: z.string().optional(),
    CLOUDINARY_FOLDER: z.string().default("ai_research_assistant"),

    LOCAL_STORAGE_DIR: z.string().default("storage/objects"),
    STORAGE_SIGNING_SECRET: z
      .string()
      .min(16, "STORAGE_SIGNING_SECRET must be at least 16 characters")
      .default("dev_storage_presigned_url_secret_2026"),
    PRESIGNED_URL_EXPIRES_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(900),
    MAX_FILE_SIZE_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(25 * 1024 * 1024), // 25 MB
    MAX_FILES_PER_UPLOAD: z.coerce
      .number()
      .int()
      .positive()
      .max(20)
      .default(10),

    // Gemini AI & Vector Embeddings
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_EMBEDDING_MODEL: z.string().default('text-embedding-004'),
    GEMINI_CHAT_MODEL: z.string().default('gemini-2.5-flash'),
    CHUNK_SIZE: z.coerce.number().int().positive().default(1000),
    CHUNK_OVERLAP: z.coerce.number().int().nonnegative().default(200),
    RAG_MAX_CONTEXT_CHUNKS: z.coerce.number().int().positive().default(6),
    RAG_MIN_SIMILARITY_SCORE: z.coerce.number().min(0).max(1).default(0.60),
  })
  .superRefine((data, ctx) => {
    if (data.STORAGE_PROVIDER === "cloudinary") {
      if (!data.CLOUDINARY_CLOUD_NAME?.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["CLOUDINARY_CLOUD_NAME"],
          message:
            "CLOUDINARY_CLOUD_NAME is required when STORAGE_PROVIDER=cloudinary",
        });
      }
      if (!data.CLOUDINARY_API_KEY?.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["CLOUDINARY_API_KEY"],
          message:
            "CLOUDINARY_API_KEY is required when STORAGE_PROVIDER=cloudinary",
        });
      }
      if (!data.CLOUDINARY_API_SECRET?.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["CLOUDINARY_API_SECRET"],
          message:
            "CLOUDINARY_API_SECRET is required when STORAGE_PROVIDER=cloudinary",
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

let validatedEnv: Env | null = null;

/**
 * Validates all required environment variables and exits immediately on failure.
 */
export function validateEnv(): Env {
  if (validatedEnv) {
    return validatedEnv;
  }

  const parsedEnv = envSchema.safeParse(process.env);

  if (!parsedEnv.success) {
    console.error("❌ Invalid environment variables:");
    for (const issue of parsedEnv.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  validatedEnv = parsedEnv.data;
  return validatedEnv;
}

export const env: Env = validateEnv();
