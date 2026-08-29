"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const core_1 = require("@nestjs/core");
const platform_fastify_1 = require("@nestjs/platform-fastify");
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const app_module_1 = require("./app.module");
const env_1 = require("./config/env");
const exception_filter_1 = require("./common/exception.filter");
const envelope_interceptor_1 = require("./common/envelope.interceptor");
async function bootstrap() {
    const env = (0, env_1.loadEnv)();
    const app = await core_1.NestFactory.create(app_module_1.AppModule, new platform_fastify_1.FastifyAdapter({ bodyLimit: 256 * 1024 }));
    app.setGlobalPrefix('v1', {
        exclude: [
            { path: 'api/webhooks/atlas/:sharedToken', method: common_1.RequestMethod.POST },
            { path: 'api/debug/webhooks/atlas/simulate', method: common_1.RequestMethod.POST },
            { path: 'api/orders/composite', method: common_1.RequestMethod.POST },
            { path: 'api/orders/:id/mock-pay', method: common_1.RequestMethod.POST },
            { path: 'api/orders/:id/simulate-leg-b-failure', method: common_1.RequestMethod.POST },
            { path: 'api/orders/:id/mock-refund', method: common_1.RequestMethod.POST },
            { path: 'api/orders/:id', method: common_1.RequestMethod.GET },
            { path: 'api/v1/planning-jobs', method: common_1.RequestMethod.POST },
            { path: 'api/v1/planning-jobs/:id', method: common_1.RequestMethod.GET },
            { path: 'api/v1/planning-jobs/:id/evidence', method: common_1.RequestMethod.GET },
            { path: 'api/v1/planning-jobs/:id', method: common_1.RequestMethod.DELETE },
        ],
    });
    app.useGlobalFilters(new exception_filter_1.GlobalExceptionFilter());
    app.useGlobalInterceptors(new envelope_interceptor_1.ResponseEnvelopeInterceptor());
    const swagger = new swagger_1.DocumentBuilder()
        .setTitle('LayoverJoy Backend')
        .setDescription('转机的乐趣 —— 签证感知的 Agentic Stopover Planner（Atlas Sandbox 模拟报价，不会产生真实出票或扣款）')
        .setVersion('1.0')
        .addBearerAuth()
        .build();
    const doc = swagger_1.SwaggerModule.createDocument(app, swagger);
    swagger_1.SwaggerModule.setup('docs', app, doc);
    await app.listen(env.PORT, '0.0.0.0');
    console.log(`[layoverjoy] backend listening on :${env.PORT} (target=${env.RUNTIME_TARGET}, atlas=${env.ATLAS_MODE})`);
}
bootstrap().catch((e) => {
    console.error('[layoverjoy] failed to start:', e?.message ?? e);
    process.exit(1);
});
