"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadEnv = loadEnv;
const zod_1 = require("zod");
const EnvSchema = zod_1.z.object({
    NODE_ENV: zod_1.z.enum(['development', 'test', 'production']).default('development'),
    RUNTIME_TARGET: zod_1.z.enum(['local', 'daytona']).default('local'),
    PORT: zod_1.z.coerce.number().default(8080),
    DATABASE_URL: zod_1.z.string().min(1),
    REDIS_URL: zod_1.z.string().default('redis://redis:6379'),
    JWT_SECRET: zod_1.z.string().min(16),
    DATA_ENCRYPTION_KEY: zod_1.z.string().min(16),
    ATLAS_MODE: zod_1.z.enum(['mock', 'sandbox', 'production']).default('sandbox'),
    ATLAS_BASE_URL: zod_1.z.string().default('https://sandbox.atriptech.com'),
    ATLAS_CLIENT_ID: zod_1.z.string().optional().default(''),
    ATLAS_CLIENT_SECRET: zod_1.z.string().optional().default(''),
    ATLAS_CID: zod_1.z.string().optional().default(''),
    ATLAS_SEARCH_PROVIDER: zod_1.z.enum(['mock', 'sandbox']).default('sandbox'),
    ATLAS_VERIFY_PROVIDER: zod_1.z.enum(['mock', 'sandbox']).default('sandbox'),
    ATLAS_ORDER_PROVIDER: zod_1.z.enum(['mock']).default('mock'),
    ATLAS_PAYMENT_PROVIDER: zod_1.z.enum(['mock']).default('mock'),
    ATLAS_REFUND_PROVIDER: zod_1.z.enum(['mock']).default('mock'),
    ATLAS_SEARCH_TIMEOUT_MS: zod_1.z.coerce.number().default(8000),
    ATLAS_DEFAULT_CURRENCY: zod_1.z.string().default('SGD'),
    ATLAS_WEBHOOK_SHARED_TOKEN: zod_1.z.string().optional().default(''),
    WEBHOOK_MODE: zod_1.z.enum(['simulate', 'tunnel']).default('simulate'),
    PUBLIC_WEBHOOK_BASE_URL: zod_1.z.string().optional().default(''),
    DEMO_FIXTURE_ENABLED: zod_1.z
        .string()
        .default('true')
        .transform((v) => v === 'true' || v === '1'),
    NOSANA_API_KEY: zod_1.z.string().optional().default(''),
    NOSANA_OPENAI_BASE_URL: zod_1.z.string().optional().default(''),
    NOSANA_MODEL: zod_1.z.string().default('qwen3.5:9b'),
    NOSANA_TIMEOUT_MS: zod_1.z.coerce.number().default(20000),
    INFERENCE_PROVIDER: zod_1.z.enum(['mock', 'nosana']).default('nosana'),
    DAYTONA_MODE: zod_1.z.enum(['mock', 'local-runner', 'live']).default('local-runner'),
    DAYTONA_API_KEY: zod_1.z.string().optional().default(''),
    DAYTONA_API_URL: zod_1.z.string().default('https://app.daytona.io/api'),
    DAYTONA_TARGET_REGION: zod_1.z.string().default('us'),
    DAYTONA_SNAPSHOT: zod_1.z.string().default('layoverjoy-dind-v1'),
    SMTP_HOST: zod_1.z.string().optional().default(''),
    SMTP_PORT: zod_1.z.coerce.number().default(465),
    SMTP_SECURE: zod_1.z
        .string()
        .default('true')
        .transform((v) => v === 'true' || v === '1'),
    SMTP_USER: zod_1.z.string().optional().default(''),
    SMTP_PASSWORD: zod_1.z.string().optional().default(''),
    MAIL_FROM: zod_1.z.string().optional().default(''),
    MAIL_PROVIDER: zod_1.z.enum(['console', 'smtp']).default('smtp'),
    NOTIFICATION_MODE: zod_1.z.string().default('email,local'),
    FCM_ENABLED: zod_1.z
        .string()
        .default('false')
        .transform((v) => v === 'true' || v === '1'),
    ADMIN_DEBUG_TOKEN: zod_1.z.string().optional().default(''),
});
let cached = null;
function loadEnv() {
    if (cached)
        return cached;
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
        const fields = parsed.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ');
        throw new Error(`[env] invalid environment configuration -> ${fields}`);
    }
    cached = parsed.data;
    return cached;
}
