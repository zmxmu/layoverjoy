"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const core_module_1 = require("./core.module");
const auth_module_1 = require("./auth/auth.module");
const atlas_module_1 = require("./atlas/atlas.module");
const health_controller_1 = require("./health.controller");
const airports_controller_1 = require("./airports/airports.controller");
const entry_rules_service_1 = require("./entry-rules/entry-rules.service");
const search_orchestrator_1 = require("./search/search.orchestrator");
const search_service_1 = require("./search/search.service");
const search_controller_1 = require("./search/search.controller");
const plans_service_1 = require("./plans/plans.service");
const plans_controller_1 = require("./plans/plans.controller");
const nosana_service_1 = require("./explanations/nosana.service");
const notifications_service_1 = require("./notifications/notifications.service");
const notifications_controller_1 = require("./notifications/notifications.controller");
const monitors_service_1 = require("./monitors/monitors.service");
const bookings_service_1 = require("./bookings/bookings.service");
const bookings_controller_1 = require("./bookings/bookings.controller");
const webhook_service_1 = require("./webhooks/webhook.service");
const webhook_controller_1 = require("./webhooks/webhook.controller");
const planning_jobs_service_1 = require("./planning-jobs/planning-jobs.service");
const planning_jobs_controller_1 = require("./planning-jobs/planning-jobs.controller");
const daytona_runner_1 = require("./planning-jobs/daytona.runner");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [core_module_1.CoreModule, auth_module_1.AuthModule, atlas_module_1.AtlasModule],
        controllers: [
            health_controller_1.HealthController,
            airports_controller_1.AirportsController,
            search_controller_1.SearchController,
            plans_controller_1.PlansController,
            notifications_controller_1.NotificationsController,
            notifications_controller_1.MonitorsController,
            bookings_controller_1.BookingsController,
            bookings_controller_1.OrdersMockController,
            webhook_controller_1.WebhookController,
            webhook_controller_1.WebhookDebugController,
            planning_jobs_controller_1.PlanningJobsController,
        ],
        providers: [
            entry_rules_service_1.EntryRulesService,
            search_orchestrator_1.SearchOrchestrator,
            search_service_1.SearchService,
            plans_service_1.PlansService,
            nosana_service_1.NosanaService,
            notifications_service_1.NotificationsService,
            monitors_service_1.MonitorsService,
            bookings_service_1.BookingsService,
            webhook_service_1.WebhookService,
            planning_jobs_service_1.PlanningJobsService,
            daytona_runner_1.DaytonaRunner,
        ],
    })
], AppModule);
