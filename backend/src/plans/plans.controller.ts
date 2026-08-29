import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, JwtAuthGuard, AuthUser } from '../common/auth';
import { PlansService, normLang } from './plans.service';

@ApiTags('plans')
@Controller('plans')
@UseGuards(JwtAuthGuard)
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  /** 方案详情：航段、全成本、JoyScore、资格证据与城市体验包（按 lang 返回对应语言）。 */
  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('lang') lang?: string) {
    return this.plans.getPlan(user.userId, id, normLang(lang));
  }

  /** 生成/获取 Nosana 解释（失败自动降级模板解释；lang 变化时重新生成）。 */
  @Post(':id/explanation')
  explain(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('lang') lang?: string) {
    return this.plans.explain(user.userId, id, normLang(lang));
  }

  @Get(':id/explanation')
  getExplanation(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('lang') lang?: string) {
    return this.plans.explain(user.userId, id, normLang(lang));
  }
}
