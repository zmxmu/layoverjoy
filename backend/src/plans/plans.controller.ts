import { Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { CurrentUser, JwtAuthGuard, AuthUser } from '../common/auth';
import { AiInsightStreamService, InsightEvent } from '../explanations/ai-insight-stream.service';
import { NosanaStreamService } from '../explanations/nosana-stream.service';
import { PlansService, normLang } from './plans.service';

@ApiTags('plans')
@Controller('plans')
@UseGuards(JwtAuthGuard)
export class PlansController {
  constructor(
    private readonly plans: PlansService,
    private readonly insight: AiInsightStreamService,
    private readonly upstream: NosanaStreamService,
  ) {}

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

  /**
   * 流式 AI 推荐（SSE）。事件仅限 status / section_start / delta / section_complete / done / error。
   *
   * 用 `reply.hijack()` 接管连接后直接写 `reply.raw`：绕过统一响应包装（SSE 不能被包成 JSON 信封），
   * 并在客户端断开时 abort 上游 Nosana 请求，避免继续占用 GPU。
   */
  @Get(':id/ai-insight/stream')
  async streamInsight(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
    @Query('language') language?: string,
    @Query('lang') lang?: string,
  ): Promise<void> {
    const target = normLang(language ?? lang);
    const controller = new AbortController();
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // 反向代理（Daytona 预览域）默认会缓冲响应，必须显式关闭才有流式效果。
      'X-Accel-Buffering': 'no',
    });
    // 立刻刷一条注释帧，避免代理在首个事件前先缓存住响应头。
    raw.write(': stream-open\n\n');

    const onClose = () => controller.abort();
    raw.on('close', onClose);

    const write = (ev: InsightEvent) => {
      if (controller.signal.aborted || raw.writableEnded) return false;
      raw.write(`event: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`);
      return true;
    };

    try {
      const { ctx } = await this.plans.planExperienceContext(user.userId, id);
      for await (const ev of this.insight.stream(id, ctx, target, controller.signal)) {
        if (!write(ev)) break;
      }
    } catch (e) {
      // 方案不存在/无权限等：以 error 事件收尾，客户端据此展示可重试文案而不是空白卡。
      write({ event: 'error', data: { code: (e as any)?.code ?? 'AI_STREAM_UNAVAILABLE', recoverable: true } });
    } finally {
      raw.off('close', onClose);
      controller.abort();
      if (!raw.writableEnded) raw.end();
    }
  }

  /**
   * 非流式版本的同一份结果（旧客户端、回滚路径与自动化验收共用）。
   * 与 SSE 走同一编排、同一缓存键，因此两条路径的内容一致。
   */
  @Get(':id/ai-insight')
  async insightJson(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('language') language?: string,
    @Query('lang') lang?: string,
  ) {
    const target = normLang(language ?? lang);
    const { ctx } = await this.plans.planExperienceContext(user.userId, id);
    const insight = await this.insight.generateBlocking(id, ctx, target);
    return { insight };
  }

  /**
   * 推理服务诊断：/v1/models 的实际响应摘要（含真实模型 id）。
   * 仅供后端/运维排查，UI 不展示这些字段。
   */
  @Get(':id/ai-insight/diagnostics')
  async diagnostics(@CurrentUser() _user: AuthUser, @Param('id') _id: string) {
    const probe = await this.upstream.probeModels();
    return {
      models: { httpStatus: probe.httpStatus, modelIds: probe.modelIds, servedModel: probe.servedModel, latencyMs: probe.latencyMs },
      lastStream: NosanaStreamService.lastStream,
    };
  }
}
