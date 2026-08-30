import { z } from 'zod';

/**
 * 环境变量 Zod 校验。缺少必需变量时给出字段级错误，绝不打印变量值。
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  RUNTIME_TARGET: z.enum(['local', 'daytona']).default('local'),
  PORT: z.coerce.number().default(8080),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://redis:6379'),
  JWT_SECRET: z.string().min(16),
  DATA_ENCRYPTION_KEY: z.string().min(16),

  ATLAS_MODE: z.enum(['mock', 'sandbox', 'production']).default('sandbox'),
  ATLAS_BASE_URL: z.string().default('https://sandbox.atriptech.com'),
  ATLAS_CLIENT_ID: z.string().optional().default(''),
  ATLAS_CLIENT_SECRET: z.string().optional().default(''),
  ATLAS_CID: z.string().optional().default(''),
  ATLAS_SEARCH_PROVIDER: z.enum(['mock', 'sandbox']).default('sandbox'),
  ATLAS_VERIFY_PROVIDER: z.enum(['mock', 'sandbox']).default('sandbox'),
  ATLAS_ORDER_PROVIDER: z.enum(['mock']).default('mock'),
  ATLAS_PAYMENT_PROVIDER: z.enum(['mock']).default('mock'),
  ATLAS_REFUND_PROVIDER: z.enum(['mock']).default('mock'),
  ATLAS_SEARCH_TIMEOUT_MS: z.coerce.number().default(8000),
  ATLAS_DEFAULT_CURRENCY: z.string().default('SGD'),
  ATLAS_WEBHOOK_SHARED_TOKEN: z.string().optional().default(''),
  WEBHOOK_MODE: z.enum(['simulate', 'tunnel']).default('simulate'),
  PUBLIC_WEBHOOK_BASE_URL: z.string().optional().default(''),
  DEMO_FIXTURE_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v === 'true' || v === '1'),

  NOSANA_API_KEY: z.string().optional().default(''),
  NOSANA_OPENAI_BASE_URL: z.string().optional().default(''),
  NOSANA_MODEL: z.string().default('layoverjoy-qwen2.5-3b'),
  // 实测 qwen3.5:9b 单次推理可达 60s，默认超时须覆盖最坏情况，否则全部降级模板。
  NOSANA_TIMEOUT_MS: z.coerce.number().default(90000),
  NOSANA_DEPLOYMENT_ID: z.string().optional().default(''),
  INFERENCE_PROVIDER: z.enum(['mock', 'nosana']).default('nosana'),

  DAYTONA_MODE: z.enum(['mock', 'local-runner', 'live']).default('local-runner'),
  DAYTONA_API_KEY: z.string().optional().default(''),
  DAYTONA_API_URL: z.string().default('https://app.daytona.io/api'),
  DAYTONA_TARGET_REGION: z.string().default('us'),
  // Empty means Daytona's current default snapshot. The retired DIND snapshot is not required.
  DAYTONA_SNAPSHOT: z.string().default(''),
  DAYTONA_SANDBOX_TTL_MINUTES: z.coerce.number().int().min(2).max(30).default(10),
  DAYTONA_CREATE_TIMEOUT_SECONDS: z.coerce.number().int().min(30).max(600).default(120),
  DAYTONA_EXEC_TIMEOUT_SECONDS: z.coerce.number().int().min(5).max(120).default(30),

  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().default(465),
  SMTP_SECURE: z
    .string()
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASSWORD: z.string().optional().default(''),
  MAIL_FROM: z.string().optional().default(''),
  MAIL_PROVIDER: z.enum(['console', 'smtp']).default('smtp'),
  NOTIFICATION_MODE: z.string().default('email,local'),
  FCM_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),

  ADMIN_DEBUG_TOKEN: z.string().optional().default(''),
});

export type AppEnv = z.infer<typeof EnvSchema>;

/** 检测脱敏占位符（页面复制的 ••• 或 REPLACE_ME 等），避免把无效 Secret 当有效配置。 */
export function isMaskedSecret(value: string | undefined | null): boolean {
  if (!value) return true;
  return /[•●*]{3,}/.test(value) || /REPLACE_ME|CHANGEME/i.test(value);
}

let cached: AppEnv | null = null;

export function loadEnv(): AppEnv {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    // 只输出字段名和错误原因，不输出变量值
    throw new Error(`[env] invalid environment configuration -> ${fields}`);
  }
  cached = parsed.data;
  return cached;
}
