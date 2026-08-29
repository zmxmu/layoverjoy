import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { DaytonaRunner } from './daytona.runner';
import { EntryRulesService } from '../entry-rules/entry-rules.service';
import { AtlasService } from '../atlas/atlas.service';
import { NosanaService } from '../explanations/nosana.service';
import { candidateHubs } from '../airports/catalog';
import { FlightOffer } from '../atlas/atlas.types';
import { AppError } from '../common/errors';

const MAX_PARALLEL_SANDBOXES = 3; // MVP 固定最大并发（09 文档 §5）

export interface PlanningJobRequest {
  origin: string;
  destination: string;
  departureDate: string;
  stayDays: number[];
  passportCountry: string;
  passportType?: string;
  visas?: Array<{ country: string; validUntil?: string }>;
  preferences?: { acceptRedEye?: boolean; airlines?: string[] };
}

interface CandidateResult {
  candidateCity: string;
  eligibility: string;
  ruleIds: string[];
  flightOfferIds: string[];
  totalCost: number | null;
  currency: string | null;
  usableHours: number | null;
  riskFlags: string[];
  evidenceTimestamp: string;
}

/**
 * Daytona planning-jobs（09 文档 §4）：
 * 状态机 QUEUED -> GENERATING_CANDIDATES -> RUNNING_SANDBOXES -> AGGREGATING -> EXPLAINING -> COMPLETED/PARTIAL/FAILED。
 * 候选输入最小化：不传护照号、签证号、姓名、邮箱和证件照片。
 */
@Injectable()
export class PlanningJobsService {
  private readonly logger = new Logger('PlanningJobsService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: DaytonaRunner,
    private readonly rules: EntryRulesService,
    private readonly atlas: AtlasService,
    private readonly nosana: NosanaService,
  ) {}

  async create(userId: string, request: PlanningJobRequest) {
    const missing: string[] = [];
    if (!request.origin) missing.push('origin');
    if (!request.destination) missing.push('destination');
    if (!request.departureDate) missing.push('departureDate');
    if (!request.passportCountry) missing.push('passportCountry');
    if (missing.length) throw AppError.validation(missing);
    // 最小化输入校验：禁止携带可识别个人身份字段
    const serialized = JSON.stringify(request);
    if (/passportNumber|documentNumber|fullName|email/i.test(serialized)) {
      throw AppError.validation(['request'], 'planning-jobs 输入只允许最小化字段，不接受证件号、姓名或邮箱。');
    }

    const job = await this.prisma.planningJob.create({
      data: {
        userId,
        requestJson: request as any,
        runnerMode: this.runner.mode(),
      },
    });
    void this.runPipeline(job.id).catch((e) => this.logger.error(`planning job ${job.id} crashed: ${(e as Error).message}`));
    return { jobId: job.id, status: 'QUEUED', runnerMode: job.runnerMode };
  }

  private async setStatus(jobId: string, status: string) {
    await this.prisma.planningJob.update({ where: { id: jobId }, data: { status } });
  }

  private async runPipeline(jobId: string) {
    const job = await this.prisma.planningJob.findUnique({ where: { id: jobId } });
    if (!job) return;
    const request = job.requestJson as any as PlanningJobRequest;
    try {
      await this.prisma.planningJob.update({ where: { id: jobId }, data: { status: 'GENERATING_CANDIDATES', startedAt: new Date() } });

      // 生成候选：排除出发/目的地国家后的优先级 Hub
      const excludeCountries = new Set<string>();
      const cityIds = [...new Set([request.origin, request.destination])];
      const originCity = candidateHubs([], 20).find((c) => c.metroCode === request.origin || c.airports.some((a) => a.iata === request.origin));
      const destCity = candidateHubs([], 20).find((c) => c.metroCode === request.destination || c.airports.some((a) => a.iata === request.destination));
      if (originCity) excludeCountries.add(originCity.countryCode);
      if (destCity) excludeCountries.add(destCity.countryCode);
      void cityIds;
      const hubs = candidateHubs([...excludeCountries], MAX_PARALLEL_SANDBOXES);

      for (const hub of hubs) {
        await this.prisma.planningJobCandidate.create({
          data: { planningJobId: jobId, candidateCity: hub.metroCode ?? hub.airports[0].iata },
        });
      }

      await this.setStatus(jobId, 'RUNNING_SANDBOXES');
      const candidates = await this.prisma.planningJobCandidate.findMany({ where: { planningJobId: jobId } });

      // 并行执行（最大并发 3），单候选失败不拖垮整体
      await Promise.all(
        candidates.map((candidate) => this.runCandidate(jobId, candidate.id, candidate.candidateCity, request, hubs)),
      );

      await this.setStatus(jobId, 'AGGREGATING');
      const done = await this.prisma.planningJobCandidate.findMany({ where: { planningJobId: jobId } });
      const successes = done.filter((c) => c.status === 'DONE');
      const failures = done.filter((c) => c.status === 'FAILED');

      // 解释阶段：只对通过的候选生成解释
      await this.setStatus(jobId, 'EXPLAINING');
      const explanations: any[] = [];
      for (const c of successes.slice(0, 2)) {
        const explanation = await this.nosana.explain({
          cityNameZh: c.candidateCity,
          stayDays: Math.max(...(request.stayDays ?? [2])),
          usableHours: c.usableHours ?? 0,
          airfareDelta: 0,
          currency: c.currency ?? 'SGD',
          joyScore: 0,
          joyScoreBreakdown: {},
          riskFlags: (c.riskFlagsJson as string[]) ?? [],
          interests: [],
        });
        explanations.push({ candidateCity: c.candidateCity, ...explanation });
      }

      const finalStatus = failures.length === 0 ? 'COMPLETED' : successes.length > 0 ? 'PARTIAL' : 'FAILED';
      await this.prisma.planningJob.update({
        where: { id: jobId },
        data: {
          status: finalStatus,
          resultJson: {
            totalCandidates: done.length,
            succeeded: successes.length,
            failed: failures.length,
            failedCandidates: failures.map((f) => ({ city: f.candidateCity, error: f.error })),
            sandboxCleanedUp: true,
          } as any,
          explanationJson: explanations as any,
          completedAt: new Date(),
        },
      });
    } catch (e) {
      this.logger.error(`planning job ${jobId} failed: ${(e as Error).message}`);
      await this.prisma.planningJob
        .update({
          where: { id: jobId },
          data: { status: 'FAILED', resultJson: { error: (e as Error).message } as any, completedAt: new Date() },
        })
        .catch(() => undefined);
    }
  }

  /** 单个候选：Daytona 隔离执行 + 资格硬过滤 + 两段搜索。 */
  private async runCandidate(
    jobId: string,
    candidateId: string,
    candidateCity: string,
    request: PlanningJobRequest,
    hubs: Array<{ cityId: string; countryCode: string; metroCode: string | null; airports: Array<{ iata: string }> }>,
  ) {
    await this.prisma.planningJobCandidate.update({
      where: { id: candidateId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
    const hub = hubs.find((h) => (h.metroCode ?? h.airports[0].iata) === candidateCity) ?? hubs[0];
    try {
      const { result, sandbox } = await this.runner.runIsolated<CandidateResult>(candidateCity, async () => {
        // 1) 确定性签证规则前置过滤
        const stayDays = Math.max(...(request.stayDays ?? [2]));
        const eligibility = await this.rules.evaluate({
          travelDate: request.departureDate,
          purpose: 'TOURISM',
          stayDays,
          passport: {
            issuingCountry: request.passportCountry,
            type: request.passportType || 'ORDINARY',
          },
          visas: (request.visas ?? []).map((v) => ({ country: v.country, validUntil: v.validUntil })),
          destinationCountry: hub.countryCode,
          // 候选规划属搜索期初筛：第二段尚未 Verify，不得谎报已确认；硬判定在预订期复核。
          mode: 'SEARCH_SCREEN',
        });
        if (eligibility.status !== 'ELIGIBLE') {
          return {
            candidateCity,
            eligibility: eligibility.status,
            ruleIds: eligibility.ruleId ? [eligibility.ruleId] : [],
            flightOfferIds: [],
            totalCost: null,
            currency: null,
            usableHours: null,
            riskFlags: eligibility.reasonCodes,
            evidenceTimestamp: new Date().toISOString(),
          };
        }

        // 2) Atlas 搜索两段
        const hubCode = hub.metroCode ?? hub.airports[0].iata;
        const leg1 = await this.atlas.searchWithCache({
          origin: request.origin,
          destination: hubCode,
          departDate: request.departureDate,
          adults: 1,
          currency: 'SGD',
        });
        const leg1Best = bestBookable(leg1.offers);
        const depart2 = addDays(request.departureDate, stayDays);
        const leg2 = await this.atlas.searchWithCache({
          origin: hubCode,
          destination: request.destination,
          departDate: depart2,
          adults: 1,
          currency: 'SGD',
        });
        const leg2Best = bestBookable(leg2.offers);
        if (!leg1Best || !leg2Best) {
          return {
            candidateCity,
            eligibility: 'NO_INVENTORY',
            ruleIds: eligibility.ruleId ? [eligibility.ruleId] : [],
            flightOfferIds: [],
            totalCost: null,
            currency: null,
            usableHours: null,
            riskFlags: ['NO_SANDBOX_INVENTORY'],
            evidenceTimestamp: new Date().toISOString(),
          };
        }
        const usableHours = Math.max(0, (new Date(leg2Best.departureAt).getTime() - new Date(leg1Best.arrivalAt).getTime()) / 3600_000 - 6);
        return {
          candidateCity,
          eligibility: 'ELIGIBLE',
          ruleIds: eligibility.ruleId ? [eligibility.ruleId] : [],
          flightOfferIds: [leg1Best.providerOfferId, leg2Best.providerOfferId],
          totalCost: Math.round((leg1Best.totalPrice + leg2Best.totalPrice) * 100) / 100,
          currency: leg1Best.currency,
          usableHours: Math.round(usableHours * 10) / 10,
          riskFlags: ['SEPARATE_TICKETS', 'RECHECK_BAGGAGE'],
          evidenceTimestamp: new Date().toISOString(),
        };
      });

      await this.prisma.planningJobCandidate.update({
        where: { id: candidateId },
        data: {
          status: result.eligibility === 'ELIGIBLE' && result.totalCost !== null ? 'DONE' : result.eligibility === 'NO_INVENTORY' ? 'FAILED' : 'DONE',
          eligibility: result.eligibility,
          ruleIdsJson: result.ruleIds as any,
          flightOfferIdsJson: result.flightOfferIds as any,
          totalCost: result.totalCost,
          currency: result.currency,
          usableHours: result.usableHours,
          riskFlagsJson: result.riskFlags as any,
          sandboxId: sandbox.sandboxId,
          durationMs: sandbox.durationMs,
          evidenceJson: { candidateResult: result, sandboxId: sandbox.sandboxId, logs: sandbox.logs, runnerMode: this.runner.mode() } as any,
          finishedAt: new Date(),
        },
      });
    } catch (e) {
      await this.prisma.planningJobCandidate.update({
        where: { id: candidateId },
        data: { status: 'FAILED', error: (e as Error).message.slice(0, 500), finishedAt: new Date() },
      });
    }
  }

  async get(userId: string, jobId: string) {
    const job = await this.prisma.planningJob.findFirst({
      where: { id: jobId, userId },
      include: { candidates: { orderBy: { startedAt: 'asc' } } },
    });
    if (!job) throw AppError.notFound('规划任务');
    return {
      jobId: job.id,
      status: job.status,
      runnerMode: job.runnerMode,
      startedAt: job.startedAt?.toISOString() ?? null,
      completedAt: job.completedAt?.toISOString() ?? null,
      result: job.resultJson,
      explanation: job.explanationJson,
      candidates: job.candidates.map((c) => ({
        candidateCity: c.candidateCity,
        status: c.status,
        eligibility: c.eligibility,
        totalCost: c.totalCost,
        currency: c.currency,
        usableHours: c.usableHours,
        sandboxId: c.sandboxId,
        durationMs: c.durationMs,
        error: c.error,
      })),
    };
  }

  /** 运行证据：包含每个 Sandbox 的日志、工具调用摘要与结构化结果（不含思维链）。 */
  async evidence(userId: string, jobId: string) {
    const job = await this.prisma.planningJob.findFirst({ where: { id: jobId, userId } });
    if (!job) throw AppError.notFound('规划任务');
    const candidates = await this.prisma.planningJobCandidate.findMany({ where: { planningJobId: jobId } });
    return {
      jobId: job.id,
      runnerMode: job.runnerMode,
      sandboxCleanedUp: true,
      candidates: candidates.map((c) => ({
        candidateCity: c.candidateCity,
        status: c.status,
        sandboxId: c.sandboxId,
        durationMs: c.durationMs,
        evidence: c.evidenceJson,
      })),
    };
  }

  async remove(userId: string, jobId: string) {
    const job = await this.prisma.planningJob.findFirst({ where: { id: jobId, userId } });
    if (!job) throw AppError.notFound('规划任务');
    await this.prisma.planningJob.delete({ where: { id: job.id } });
    return { ok: true };
  }
}

function bestBookable(offers: FlightOffer[]): FlightOffer | null {
  const list = offers.filter((o) => o.priceStatus === 'current' && o.bookable);
  if (!list.length) return null;
  return [...list].sort((a, b) => a.totalPrice - b.totalPrice)[0];
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return new Date(d.getTime() + days * 24 * 3600 * 1000).toISOString().slice(0, 10);
}
