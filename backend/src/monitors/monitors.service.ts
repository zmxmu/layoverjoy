import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AtlasService } from '../atlas/atlas.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CityEntry, HUB_CATALOG, resolveLocation, ResolvedLocation } from '../airports/catalog';
import { AppError } from '../common/errors';

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 价格监控检查间隔 30 分钟
const TRIGGER_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 同一规则触发后 12 小时内不重复打扰

export interface MonitorRuleInput {
  planId: string;
  targetAirfare?: number;
  minJoyScore?: number;
  notifyEmail?: boolean;
  notifyApp?: boolean;
}

/** 价格监控规则：目标价到达时邮件 + App 通知。 */
@Injectable()
export class MonitorsService {
  private readonly logger = new Logger('MonitorsService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly atlas: AtlasService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(userId: string, input: MonitorRuleInput) {
    if (!input.planId) throw AppError.validation(['planId']);
    const plan = await this.prisma.stopoverPlan.findFirst({ where: { id: input.planId, searchRun: { userId } } });
    if (!plan) throw AppError.notFound('方案');
    if (input.targetAirfare === undefined && input.minJoyScore === undefined) {
      throw AppError.validation(['targetAirfare', 'minJoyScore'], '请至少设置目标票价或最低 JoyScore。');
    }
    const run = await this.prisma.searchRun.findUnique({ where: { id: plan.searchRunId } });
    const city = HUB_CATALOG.find((c) => c.cityId === plan.stopoverCityId);
    // 路线标签统一用完整城市名，不展示三字码缩写；落库存中文版，列表接口按语言重建。
    const routeLabel = this.buildRouteLabel(run, city, 'zh');

    const rule = await this.prisma.monitorRule.create({
      data: {
        userId,
        planId: plan.id,
        searchRunId: plan.searchRunId,
        routeLabel,
        targetAirfare: input.targetAirfare ?? null,
        minJoyScore: input.minJoyScore ?? null,
        notifyEmail: input.notifyEmail ?? true,
        notifyApp: input.notifyApp ?? true,
        nextCheckAt: new Date(Date.now() + 60 * 1000), // 首次检查 1 分钟后
      },
    });
    return { monitorId: rule.id, status: rule.status };
  }

  async list(userId: string, lang: 'zh' | 'en' = 'zh') {
    const rules = await this.prisma.monitorRule.findMany({
      where: { userId, status: { in: ['ACTIVE', 'PAUSED'] } },
      orderBy: { createdAt: 'desc' },
    });
    const monitors = await Promise.all(
      rules.map(async (r) => {
        // 历史数据的 routeLabel 可能含三字码：按当前语言从目录重建完整城市名标签。
        let routeLabel = r.routeLabel;
        try {
          const plan = await this.prisma.stopoverPlan.findUnique({
            where: { id: r.planId },
            select: { stopoverCityId: true, searchRunId: true },
          });
          const run = plan ? await this.prisma.searchRun.findUnique({ where: { id: plan.searchRunId } }) : null;
          if (plan && run) {
            const city = HUB_CATALOG.find((c) => c.cityId === plan.stopoverCityId);
            routeLabel = this.buildRouteLabel(run, city, lang);
          }
        } catch {
          /* 重建失败时保留已存标签 */
        }
        return {
          monitorId: r.id,
          planId: r.planId,
          routeLabel,
          targetAirfare: r.targetAirfare,
          minJoyScore: r.minJoyScore,
          notifyEmail: r.notifyEmail,
          notifyApp: r.notifyApp,
          status: r.status,
          lastCheckedAt: r.lastCheckedAt?.toISOString() ?? null,
          lastTriggeredAt: r.lastTriggeredAt?.toISOString() ?? null,
          lastTriggerReason: r.lastTriggerReason,
        };
      }),
    );
    return { monitors };
  }

  /** 路线标签：出发地 → 中转城市 → 目的地，全部用完整城市名（中/英）。 */
  private buildRouteLabel(run: any, city: CityEntry | undefined, lang: 'zh' | 'en'): string {
    const pick = (loc: ResolvedLocation | null, fallback: string): string => {
      if (!loc) return fallback;
      return lang === 'en' ? loc.cityNameEn || loc.cityNameZh : loc.cityNameZh || loc.cityNameEn;
    };
    const origin = pick(
      resolveLocation(run?.originCode ?? '') ?? resolveLocation(run?.originInput ?? ''),
      run?.originCode ?? '',
    );
    const dest = pick(
      resolveLocation(run?.destinationCode ?? '') ?? resolveLocation(run?.destinationInput ?? ''),
      run?.destinationCode ?? '',
    );
    const hub = city ? (lang === 'en' ? city.cityNameEn || city.cityNameZh : city.cityNameZh || city.cityNameEn) : '';
    return `${origin} → ${hub} → ${dest}`;
  }

  async setStatus(userId: string, monitorId: string, status: 'ACTIVE' | 'PAUSED' | 'STOPPED') {
    const rule = await this.prisma.monitorRule.findFirst({ where: { id: monitorId, userId } });
    if (!rule) throw AppError.notFound('监控规则');
    await this.prisma.monitorRule.update({
      where: { id: rule.id },
      data: { status, nextCheckAt: status === 'ACTIVE' ? new Date() : null },
    });
    return { monitorId: rule.id, status };
  }

  /** 删除监控：归属校验后物理删除；已产生的历史通知保留（monitorId 无外键约束）。 */
  async remove(userId: string, monitorId: string) {
    const rule = await this.prisma.monitorRule.findFirst({ where: { id: monitorId, userId } });
    if (!rule) throw AppError.notFound('监控规则');
    await this.prisma.monitorRule.delete({ where: { id: rule.id } });
    this.logger.log(`monitor ${rule.id} deleted by user ${userId}`);
    return { monitorId: rule.id, deleted: true };
  }

  /** Worker 入口：检查到期的监控规则。 */
  async evaluateDue(now = new Date()): Promise<number> {
    const due = await this.prisma.monitorRule.findMany({
      where: { status: 'ACTIVE', nextCheckAt: { lte: now } },
      take: 20,
    });
    let triggered = 0;
    for (const rule of due) {
      try {
        const hit = await this.checkRule(rule);
        await this.prisma.monitorRule.update({
          where: { id: rule.id },
          data: {
            lastCheckedAt: now,
            nextCheckAt: new Date(now.getTime() + CHECK_INTERVAL_MS),
            ...(hit
              ? { lastTriggeredAt: now, lastTriggerReason: hit.reason }
              : {}),
          },
        });
        if (hit) triggered += 1;
      } catch (e) {
        this.logger.warn(`monitor ${rule.id} check failed: ${(e as Error).message}`);
        await this.prisma.monitorRule
          .update({ where: { id: rule.id }, data: { lastCheckedAt: now, nextCheckAt: new Date(now.getTime() + CHECK_INTERVAL_MS) } })
          .catch(() => undefined);
      }
    }
    return triggered;
  }

  /** 重新搜索两段并比较当前票价；JoyScore 按已保存方案确定性评估。只读搜索缓存，不产生订单动作。 */
  private async checkRule(rule: any): Promise<{ reason: string } | null> {
    // 冷却去重：避免同一条件每 30 分钟重复打扰用户。
    if (rule.lastTriggeredAt && Date.now() - new Date(rule.lastTriggeredAt).getTime() < TRIGGER_COOLDOWN_MS) {
      return null;
    }

    const plan = await this.prisma.stopoverPlan.findUnique({ where: { id: rule.planId } });
    const run = await this.prisma.searchRun.findUnique({ where: { id: rule.searchRunId } });
    if (!plan || !run) return null;

    // JoyScore 条件：方案创建时已确定性计算，直接对比，不伪装成实时监测。
    if (rule.minJoyScore !== null && plan.joyScore >= rule.minJoyScore) {
      await this.sendAlert(rule, plan, `方案 JoyScore ${plan.joyScore} 达到你设置的 ${rule.minJoyScore}，可查看详情并预订。`, '体验分目标已达成', `Plan JoyScore ${plan.joyScore} reached your target ${rule.minJoyScore}. View details and book.`, 'JoyScore target reached');
      return { reason: `JOY_SCORE_REACHED:${plan.joyScore}` };
    }

    const legs = await this.prisma.flightOfferSnapshot.findMany({
      where: { id: { in: (plan.legOfferIdsJson as string[]) ?? [] } },
      orderBy: { legNo: 'asc' },
    });
    if (legs.length === 0) return null;

    let currentTotal = 0;
    for (const leg of legs) {
      const departDate = leg.departureAt.toISOString().slice(0, 10);
      const { offers } = await this.atlas.searchWithCache({
        origin: leg.origin,
        destination: leg.destination,
        departDate,
        adults: 1,
        currency: plan.currency,
      });
      const bookable = offers.filter((o) => o.priceStatus === 'current' && o.bookable);
      if (!bookable.length) return null; // 当前无库存，本轮不判定
      const best = Math.min(...bookable.map((o) => o.totalPrice));
      currentTotal += best;
    }

    const priceHit = rule.targetAirfare !== null && currentTotal <= rule.targetAirfare;
    if (priceHit) {
      const city = HUB_CATALOG.find((c) => c.cityId === plan.stopoverCityId);
      await this.sendAlert(
        rule,
        plan,
        `${rule.routeLabel} 当前两段合计约 ${currentTotal} ${plan.currency}，达到你设置的目标价 ${rule.targetAirfare} ${plan.currency}。价格随时可能变化，以验价结果为准。`,
        '好价提醒：目标票价已到达',
        `${rule.routeLabel} now totals about ${currentTotal} ${plan.currency}, hitting your target ${rule.targetAirfare} ${plan.currency}. Prices can change; verification is authoritative.`,
        'Price alert: target fare reached',
      );
      this.logger.log(`monitor ${rule.id} triggered for ${city?.cityNameZh ?? plan.stopoverCityId}: ${currentTotal}`);
      return { reason: `PRICE_TARGET_REACHED:${currentTotal}` };
    }
    return null;
  }

  /** 按用户渠道开关投递提醒（关闭的渠道不发送，不产生假状态）。 */
  private async sendAlert(rule: any, plan: any, body: string, title: string, bodyEn?: string, titleEn?: string) {
    await this.notifications.notify({
      userId: rule.userId,
      kind: 'PRICE_ALERT',
      title,
      body,
      titleEn,
      bodyEn,
      deepLink: `layoverjoy://plans/${plan.id}`,
      planId: plan.id,
      monitorId: rule.id,
      isSimulated: true,
      sendEmail: rule.notifyEmail,
      sendApp: rule.notifyApp,
    });
  }
}
