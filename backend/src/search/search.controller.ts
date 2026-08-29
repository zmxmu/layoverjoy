import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, JwtAuthGuard, AuthUser } from '../common/auth';
import { SearchService, SearchRequestInput } from './search.service';

@ApiTags('searches')
@Controller('searches')
@UseGuards(JwtAuthGuard)
export class SearchController {
  constructor(private readonly searches: SearchService) {}

  /** 创建一次搜索编排（异步执行，返回 searchRunId 供轮询）。 */
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: SearchRequestInput) {
    return this.searches.create(user.userId, body);
  }

  @Get(':id')
  status(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.searches.getStatus(user.userId, id);
  }

  /** 结果：直飞基准 + Stopover 方案 + 漏斗与资格证据。 */
  @Get(':id/plans')
  plans(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.searches.getPlans(user.userId, id);
  }
}
