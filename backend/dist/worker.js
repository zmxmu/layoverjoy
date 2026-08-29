"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const core_module_1 = require("./core.module");
const atlas_module_1 = require("./atlas/atlas.module");
const auth_module_1 = require("./auth/auth.module");
const monitors_service_1 = require("./monitors/monitors.service");
const notifications_service_1 = require("./notifications/notifications.service");
const entry_rules_service_1 = require("./entry-rules/entry-rules.service");
let WorkerModule = class WorkerModule {
};
WorkerModule = __decorate([
    (0, common_1.Module)({
        imports: [core_module_1.CoreModule, atlas_module_1.AtlasModule, auth_module_1.AuthModule],
        providers: [monitors_service_1.MonitorsService, notifications_service_1.NotificationsService, entry_rules_service_1.EntryRulesService],
    })
], WorkerModule);
const WORKER_INTERVAL_MS = 5 * 60 * 1000;
async function main() {
    const logger = new common_1.Logger('MonitorWorker');
    const ctx = await core_1.NestFactory.createApplicationContext(WorkerModule, { logger: ['error', 'warn', 'log'] });
    const monitors = ctx.get(monitors_service_1.MonitorsService);
    logger.log(`monitor-worker started (interval=${WORKER_INTERVAL_MS / 1000}s)`);
    const tick = async () => {
        try {
            const triggered = await monitors.evaluateDue();
            if (triggered > 0)
                logger.log(`price alerts triggered: ${triggered}`);
        }
        catch (e) {
            logger.error(`worker tick failed: ${e.message}`);
        }
    };
    await tick();
    setInterval(tick, WORKER_INTERVAL_MS);
}
main().catch((e) => {
    console.error('[layoverjoy] worker failed to start:', e?.message ?? e);
    process.exit(1);
});
