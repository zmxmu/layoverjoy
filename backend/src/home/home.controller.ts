import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, JwtAuthGuard, AuthUser } from '../common/auth';
import { HomeService } from './home.service';

/** 首页机会卡：只读本地已落库搜索结果，不调用任何外部 Provider。 */
@ApiTags('home')
@Controller('home')
@UseGuards(JwtAuthGuard)
export class HomeController {
  constructor(private readonly home: HomeService) {}

  @Get('opportunity')
  opportunity(@CurrentUser() user: AuthUser) {
    return this.home.opportunity(user.userId);
  }
}
