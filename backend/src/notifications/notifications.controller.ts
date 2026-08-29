import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, JwtAuthGuard, AuthUser } from '../common/auth';
import { NotificationsService } from './notifications.service';
import { MonitorRuleInput, MonitorsService } from '../monitors/monitors.service';

@ApiTags('notifications')
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** App 端本地通知：WorkManager 定时轮询本接口（15 分钟）。 */
  @Get()
  list(@CurrentUser() user: AuthUser, @Query('unread') unread?: string) {
    return this.notifications.list(user.userId, unread === 'true');
  }

  @Patch(':id/read')
  markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notifications.markRead(user.userId, id);
  }
}

@ApiTags('monitors')
@Controller('monitors')
@UseGuards(JwtAuthGuard)
export class MonitorsController {
  constructor(private readonly monitors: MonitorsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: MonitorRuleInput) {
    return this.monitors.create(user.userId, body);
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.monitors.list(user.userId);
  }

  @Patch(':id/status')
  setStatus(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: { status: 'ACTIVE' | 'PAUSED' | 'STOPPED' }) {
    return this.monitors.setStatus(user.userId, id, body.status);
  }
}
