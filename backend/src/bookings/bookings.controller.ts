import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
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

  /** 涨价检查点：用户明确确认新总价后才继续下单。 */
  @Post(':id/confirm-price')
  confirmPrice(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: { acceptedTotal: number; currency?: string }) {
    return this.bookings.confirmPrice(user.userId, id, body);
  }

  /** 支付：Sandbox 支付必须逐单提交一次性付款确认令牌。 */
  @Post(':id/pay')
  pay(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { paymentConfirmationIds?: string[] },
    @Headers('x-demo-pay-result') demoPayResult?: string,
  ) {
    return this.bookings.pay(user.userId, id, body?.paymentConfirmationIds, demoPayResult);
  }

  /** 手动刷新出票状态（单次查询，不轮询）。 */
  @Post(':id/refresh-ticketing')
  refreshTicketing(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bookings.refreshTicketing(user.userId, id);
  }

  @Post(':id/mock-pay')
  mockPay(@CurrentUser() user: AuthUser, @Param('id') id: string, @Headers('x-demo-pay-result') demoPayResult?: string) {
    return this.bookings.pay(user.userId, id, undefined, demoPayResult);
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
