import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { RequestMethod } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';
import { GlobalExceptionFilter } from './common/exception.filter';
import { ResponseEnvelopeInterceptor } from './common/envelope.interceptor';

/**
 * 应用入口（Fastify）。
 * - 全局前缀 /v1；webhook、debug、mock orders、planning-jobs 按文档路径挂载，不加前缀；
 * - Body 限制 256 KB（07 文档 §3）。
 */
async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ bodyLimit: 256 * 1024 }));

  app.setGlobalPrefix('v1', {
    exclude: [
      { path: 'api/webhooks/atlas/:sharedToken', method: RequestMethod.POST },
      { path: 'api/debug/webhooks/atlas/simulate', method: RequestMethod.POST },
      { path: 'api/orders/composite', method: RequestMethod.POST },
      { path: 'api/orders/:id/mock-pay', method: RequestMethod.POST },
      { path: 'api/orders/:id/confirm-price', method: RequestMethod.POST },
      { path: 'api/orders/:id/pay', method: RequestMethod.POST },
      { path: 'api/orders/:id/refresh-ticketing', method: RequestMethod.POST },
      { path: 'api/orders/:id/simulate-leg-b-failure', method: RequestMethod.POST },
      { path: 'api/orders/:id/mock-refund', method: RequestMethod.POST },
      { path: 'api/orders/:id', method: RequestMethod.GET },
      { path: 'api/v1/planning-jobs', method: RequestMethod.POST },
      { path: 'api/v1/planning-jobs/:id', method: RequestMethod.GET },
      { path: 'api/v1/planning-jobs/:id/evidence', method: RequestMethod.GET },
      { path: 'api/v1/planning-jobs/:id', method: RequestMethod.DELETE },
    ],
  });

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());

  const swagger = new DocumentBuilder()
    .setTitle('LayoverJoy Backend')
    .setDescription('转机的乐趣 —— 签证感知的 Agentic Stopover Planner')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const doc = SwaggerModule.createDocument(app, swagger);
  SwaggerModule.setup('docs', app, doc);

  await app.listen(env.PORT, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`[layoverjoy] backend listening on :${env.PORT} (target=${env.RUNTIME_TARGET}, atlas=${env.ATLAS_MODE})`);
}

bootstrap().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[layoverjoy] failed to start:', e?.message ?? e);
  process.exit(1);
});
