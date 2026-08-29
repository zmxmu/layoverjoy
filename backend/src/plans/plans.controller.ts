import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, JwtAuthGuard, AuthUser } from '../common/auth';
import { PlansService } from './plans.service';

@ApiTags('plans')
@Controller('plans')
@UseGuards(JwtAuthGuard)
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  /** 方案详情：航段、全成本、JoyScore、资格证据与城市体验包。 */
  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.plans.getPlan(user.userId, id);
  }

  /** 生成/获取 Nosana 解释（失败自动降级模板解释）。 */
  @Post(':id/explanation')
  explain(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.plans.explain(user.userId, id);
  }

  @Get(':id/explanation')
  getExplanation(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.plans.explain(user.userId, id);
  }
}
