import { Module } from '@nestjs/common';
import { CoreModule } from './core.module';
import { AuthModule } from './auth/auth.module';
import { AtlasModule } from './atlas/atlas.module';
import { HealthController } from './health.controller';
import { AirportsController } from './airports/airports.controller';
import { EntryRulesService } from './entry-rules/entry-rules.service';
import { EntryEligibilityController } from './entry-rules/entry-eligibility.controller';
import { RuleCatalogLoader } from './entry-rules/v2/catalog-loader';
import { EligibilityAssessService } from './entry-rules/v2/assess.service';
import { SearchOrchestrator } from './search/search.orchestrator';
import { SearchService } from './search/search.service';
import { SearchController } from './search/search.controller';
import { PlansService } from './plans/plans.service';
import { PlansController } from './plans/plans.controller';
import { NosanaService } from './explanations/nosana.service';
import { NosanaStreamService } from './explanations/nosana-stream.service';
import { AiInsightStreamService } from './explanations/ai-insight-stream.service';
import { NotificationsService } from './notifications/notifications.service';
import { NotificationsController, MonitorsController } from './notifications/notifications.controller';
import { MonitorsService } from './monitors/monitors.service';
import { BookingsService } from './bookings/bookings.service';
import { BookingsController, OrdersMockController } from './bookings/bookings.controller';
import { WebhookService } from './webhooks/webhook.service';
import { WebhookController, WebhookDebugController } from './webhooks/webhook.controller';
import { PlanningJobsService } from './planning-jobs/planning-jobs.service';
import { PlanningJobsController } from './planning-jobs/planning-jobs.controller';
import { DaytonaRunner } from './planning-jobs/daytona.runner';
import { HomeModule } from './home/home.module';

@Module({
  imports: [CoreModule, AuthModule, AtlasModule, HomeModule],
  controllers: [
    HealthController,
    AirportsController,
    EntryEligibilityController,
    SearchController,
    PlansController,
    NotificationsController,
    MonitorsController,
    BookingsController,
    OrdersMockController,
    WebhookController,
    WebhookDebugController,
    PlanningJobsController,
  ],
  providers: [
    EntryRulesService,
    RuleCatalogLoader,
    EligibilityAssessService,
    SearchOrchestrator,
    SearchService,
    PlansService,
    NosanaService,
    NosanaStreamService,
    AiInsightStreamService,
    NotificationsService,
    MonitorsService,
    BookingsService,
    WebhookService,
    PlanningJobsService,
    DaytonaRunner,
  ],
})
export class AppModule {}
