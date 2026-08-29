import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, JwtAuthGuard, AuthUser } from '../common/auth';
import { BookingsService, CompositeOrderInput } from './bookings.service';

/** 07 文档 §7 模拟接口（路径不经过 /v1 前缀）。 */
@ApiTags('orders-mock')
@Controller('api/orders')
@UseGuards(JwtAuthGuard)
export class OrdersMockController {
  constructor(private readonly bookings: BookingsService) {}

  @Post('composite')
  composite(@CurrentUser() user: AuthUser, @Body() body: CompositeOrderInput) {
    return this.bookings.createComposite(user.userId, body);
  }

  @Post(':id/mock-pay')
  mockPay(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bookings.mockPay(user.userId, id);
  }

  @Post(':id/simulate-leg-b-failure')
  simulateLegB(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bookings.simulateLegBFailure(user.userId, id);
  }

  @Post(':id/mock-refund')
  mockRefund(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bookings.mockRefund(user.userId, id);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bookings.get(id, user.userId);
  }
}

/** 用户预订列表（/v1）。 */
@ApiTags('bookings')
@Controller('bookings')
@UseGuards(JwtAuthGuard)
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.bookings.list(user.userId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bookings.get(id, user.userId);
  }
}
