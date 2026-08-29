import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, JwtAuthGuard, AuthUser } from '../common/auth';
import { PlanningJobsService, PlanningJobRequest } from './planning-jobs.service';

/** Daytona 并行候选规划任务（09 文档 §4，路径 /api/v1）。 */
@ApiTags('planning-jobs')
@Controller('api/v1/planning-jobs')
@UseGuards(JwtAuthGuard)
export class PlanningJobsController {
  constructor(private readonly jobs: PlanningJobsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: PlanningJobRequest) {
    return this.jobs.create(user.userId, body);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.jobs.get(user.userId, id);
  }

  /** 运行证据：Sandbox 日志、结构化结果与清理状态（不展示思维链）。 */
  @Get(':id/evidence')
  evidence(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.jobs.evidence(user.userId, id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.jobs.remove(user.userId, id);
  }
}
