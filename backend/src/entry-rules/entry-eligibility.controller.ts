import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common/auth';
import { AppError } from '../common/errors';
import { RuleCatalogLoader } from './v2/catalog-loader';
import { EligibilityAssessService } from './v2/assess.service';
import { AssessInput } from './v2/types';
import { UsersService } from '../users/users.service';

/**
 * v2 入境资格评估 API（13 号方案 §10）。
 * assess 与快照查询要求登录；管理导入/激活/回滚/复核队列同守卫（MVP 无独立管理员角色）。
 */
@ApiTags('entry-eligibility')
@Controller()
@UseGuards(JwtAuthGuard)
export class EntryEligibilityController {
  constructor(
    private readonly assess: EligibilityAssessService,
    private readonly loader: RuleCatalogLoader,
    private readonly users: UsersService,
  ) {}

  @Post('entry-eligibility/assess')
  async assessNow(@CurrentUser() user: AuthUser, @Body() body: Omit<AssessInput, 'userId'> & { travelerId?: string }) {
    const input: AssessInput = { ...body, userId: user.userId } as AssessInput;
    if (!input.itinerary?.segments?.length && !input.itinerary?.stopover && !input.itinerary?.destination) {
      throw AppError.validation(['itinerary'], '行程至少需要航段、中转地或目的地之一。');
    }
    // 请求未携带证件时合并用户证件钱包（护照/签证/居留），保证与规则引擎事实一致。
    if (!input.traveler?.passport) {
      const profile = await this.users.profileForRules(user.userId);
      input.traveler = {
        passport: profile.passport,
        documents: (profile as any).qualifyingDocuments ?? [],
        history: (input.traveler as any)?.history ?? {},
      };
    }
    return this.assess.assess(input, { persist: true });
  }

  @Get('entry-eligibility/assessments/:id')
  getAssessment(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.assess.getAssessment(user.userId, id).then((r) => {
      if (!r) throw AppError.notFound('评估快照');
      return r;
    });
  }

  @Get('entry-eligibility/ruleset')
  ruleset() {
    const active = this.loader.getActive();
    if (!active) throw new AppError('RULES_UNAVAILABLE', '规则库暂不可用。', 503, true);
    return {
      schemaVersion: active.dataset.schemaVersion,
      checksum: active.checksum,
      datasetId: active.dataset.dataset.datasetId,
      asOf: active.dataset.dataset.asOf,
      ruleCount: active.dataset.verifiedRules.length,
      legalNoticeZh: active.dataset.dataset.legalNoticeZh,
    };
  }

  // ---- 规则维护（ER-15；MVP 提供导入/激活/回滚/复核队列） ----

  @Post('admin/entry-rule-sets/import')
  importSet(@Body() body: { dataset: any; activate?: boolean }) {
    return this.loader.importDataset(body.dataset, body.activate === true);
  }

  @Post('admin/entry-rule-sets/:id/activate')
  activateSet(@Param('id') id: string) {
    return this.loader.activate(id).then(() => ({ ok: true }));
  }

  @Post('admin/entry-rule-sets/:id/rollback')
  rollbackSet() {
    return this.loader.rollback().then(() => ({ ok: true }));
  }

  @Get('admin/entry-rules/review-queue')
  reviewQueue() {
    return this.loader.reviewQueue().then((items) => ({ items }));
  }
}
