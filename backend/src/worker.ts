import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Module, Logger } from '@nestjs/common';
import { CoreModule } from './core.module';
import { AtlasModule } from './atlas/atlas.module';
import { AuthModule } from './auth/auth.module';
import { MonitorsService } from './monitors/monitors.service';
import { NotificationsService } from './notifications/notifications.service';
import { EntryRulesService } from './entry-rules/entry-rules.service';

/**
 * monitor-worker（07 文档 §4）：
 * 每 5 分钟扫描到期的价格监控规则并触发通知。
 * 独立进程启动：npm run start:worker
 */
@Module({
  imports: [CoreModule, AtlasModule, AuthModule],
  providers: [MonitorsService, NotificationsService, EntryRulesService],
})
class WorkerModule {}

const WORKER_INTERVAL_MS = 5 * 60 * 1000;

async function main() {
  const logger = new Logger('MonitorWorker');
  const ctx = await NestFactory.createApplicationContext(WorkerModule, { logger: ['error', 'warn', 'log'] });
  const monitors = ctx.get(MonitorsService);
  logger.log(`monitor-worker started (interval=${WORKER_INTERVAL_MS / 1000}s)`);

  const tick = async () => {
    try {
      const triggered = await monitors.evaluateDue();
      if (triggered > 0) logger.log(`price alerts triggered: ${triggered}`);
    } catch (e) {
      logger.error(`worker tick failed: ${(e as Error).message}`);
    }
  };
  await tick();
  setInterval(tick, WORKER_INTERVAL_MS);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[layoverjoy] worker failed to start:', e?.message ?? e);
  process.exit(1);
});
