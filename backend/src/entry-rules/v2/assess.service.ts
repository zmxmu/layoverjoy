/**
 * EligibilityAssessService（ER-09）：编排 loader + facts + matcher + aggregator，
 * 持久化评估与证据快照，返回 §10.1 契约。LLM/Nosana 不参与结论（ER-14 模板解释）。
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { RuleCatalogLoader } from './catalog-loader';
import { buildFacts, factsHash, itineraryHash } from './facts';
import { evalExpression, getFact as getFactsSafe } from './matcher';
import { aggregate, RuleEval } from './aggregator';
import { withDescriptionEn } from './requirement-text';
import { AssessInput, AssessResult, DecisionCode, RuleV2 } from './types';

const DAY_MS = 24 * 3600 * 1000;

@Injectable()
export class EligibilityAssessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly loader: RuleCatalogLoader,
  ) {}

  assess(input: AssessInput, opts?: { persist?: boolean }): AssessResult {
    const active = this.loader.getActive();
    const now = input.now ? new Date(input.now) : new Date();
    if (!active) {
      return {
        assessmentId: 'ela_unavailable',
        searchDecision: 'NEEDS_REVIEW',
        bookingDecision: 'NEEDS_REVIEW',
        matchedRuleIds: [],
        missingFacts: [],
        requirements: [],
        explanationZh: '规则库暂不可用，本次仅能给出待人工核对状态。',
        warningsZh: ['规则库加载失败时不得自动放行。'],
        sources: [],
        ruleSet: { schemaVersion: '0.0.0', checksum: 'unavailable' },
        expiresAt: new Date(now.getTime() + DAY_MS).toISOString(),
        maxStay: null,
        disclaimerZh: LEGAL_NOTICE,
      };
    }
    const ds = active.dataset;
    const facts = buildFacts(input);
    const destCountry = input.itinerary.stopover?.country ?? input.itinerary.destination?.country;
    const jurisdiction = input.itinerary.stopover?.jurisdiction ?? null;

    const candidates = ds.verifiedRules.filter((r) => {
      if (jurisdiction && r.destination.jurisdictionCode) return r.destination.jurisdictionCode === jurisdiction;
      if (jurisdiction && !r.destination.jurisdictionCode) return r.destination.countryCode === jurisdiction || r.destination.countryCode === destCountry;
      if (!jurisdiction && r.destination.jurisdictionCode) return false; // 辖区规则不匹配普通国家目的地
      return r.destination.countryCode === destCountry;
    });

    const arrivalDate = (facts as any).itinerary?.arrivalDate as string | undefined;
    const evals: RuleEval[] = candidates.map((rule) => ({
      rule,
      outcome: evalExpression(rule.match, { facts, dataset: ds, rule, arrivalDate, now }),
    }));

    const agg = aggregate(ds, evals, { mode: input.mode, arrivalDate, now });
    const matched = agg.matched[0] as RuleV2 | undefined;

    const requirements = (matched?.requirements ?? []).map((req) => {
      const paths = req.factPaths ?? [];
      const missing = paths.filter((p) => getFactsSafe(facts, p) === undefined);
      const inMissingFacts = agg.missingFacts.some((m) => paths.includes(m));
      return {
        code: req.code,
        descriptionZh: req.descriptionZh,
        ...withDescriptionEn(req),
        status: (missing.length === 0 ? 'SATISFIED' : inMissingFacts ? 'MISSING' : 'PENDING') as 'SATISFIED' | 'PENDING' | 'MISSING',
      };
    });

    const sources = (matched?.sourceIds ?? []).map((id) => {
      const s = ds.sourceDocuments.find((x) => x.sourceId === id);
      return s ? { sourceId: s.sourceId, authority: s.authority, url: s.url, lastCheckedAt: s.lastCheckedAt } : { sourceId: id, authority: id, url: '', lastCheckedAt: '' };
    });

    let expiresAt = new Date(now.getTime() + DAY_MS);
    if (matched?.status === 'TEMPORARY_ACTIVE' && matched.validity.effectiveTo) {
      const to = new Date(`${matched.validity.effectiveTo}T23:59:59Z`);
      const safety = new Date(now.getTime() + ds.policy.temporaryRuleSafetyHours * 3600 * 1000);
      expiresAt = to < safety ? to : safety;
    }

    const result: AssessResult = {
      assessmentId: '',
      searchDecision: agg.searchDecision,
      bookingDecision: agg.bookingDecision,
      matchedRuleIds: agg.matched.map((r) => r.ruleId),
      missingFacts: agg.missingFacts,
      requirements,
      explanationZh: explainTemplate(matched, agg.searchDecision),
      warningsZh: [...(matched?.warningsZh ?? []), '最终以边检、领馆和航空公司的实时决定为准。'],
      sources,
      ruleSet: { schemaVersion: ds.schemaVersion, checksum: active.checksum },
      expiresAt: expiresAt.toISOString(),
      maxStay: matched?.decision.maxStay ?? null,
      entryMode: matched?.decision.entryMode,
      category: matched?.category,
      disclaimerZh: ds.dataset.legalNoticeZh,
    };

    if (opts?.persist !== false) {
      void this.persist(input, facts, result, agg.reasonCodes, matched);
    }
    return result;
  }

  private async persist(input: AssessInput, facts: Record<string, any>, result: AssessResult, reasonCodes: string[], matched?: RuleV2) {
    try {
      const assessment = await this.prisma.eligibilityAssessment.create({
        data: {
          userId: input.userId,
          destinationCode: input.itinerary.stopover?.country ?? input.itinerary.destination?.country ?? '',
          itineraryHash: itineraryHash(input.itinerary),
          factsHash: factsHash(facts),
          ruleSetChecksum: result.ruleSet.checksum,
          searchDecision: result.searchDecision,
          bookingDecision: result.bookingDecision,
          missingFactsJson: result.missingFacts as any,
          matchedRuleIdsJson: result.matchedRuleIds as any,
          expiresAt: new Date(result.expiresAt),
        },
      });
      await this.prisma.eligibilityEvidenceSnapshot.create({
        data: {
          assessmentId: assessment.id,
          normalizedFactsJsonEncrypted: null, // 事实不含证件号等敏感原文；MVP 不明文存敏感字段
          matchedRulesJson: { matchedRuleIds: result.matchedRuleIds, reasonCodes } as any,
          sourceRefsJson: result.sources as any,
          resultJson: { searchDecision: result.searchDecision, bookingDecision: result.bookingDecision, requirements: result.requirements, explanationZh: result.explanationZh, warningsZh: result.warningsZh, maxStay: result.maxStay, entryMode: result.entryMode, category: result.category } as any,
        },
      });
      result.assessmentId = assessment.id;
    } catch {
      // 持久化失败不影响确定性结论返回
    }
  }

  async getAssessment(userId: string, id: string) {
    const a = await this.prisma.eligibilityAssessment.findFirst({ where: { id, userId }, include: { evidence: true } });
    if (!a) return null;
    return {
      assessmentId: a.id,
      destinationCode: a.destinationCode,
      searchDecision: a.searchDecision,
      bookingDecision: a.bookingDecision,
      matchedRuleIds: a.matchedRuleIdsJson,
      missingFacts: a.missingFactsJson,
      ruleSetChecksum: a.ruleSetChecksum,
      itineraryHash: a.itineraryHash,
      factsHash: a.factsHash,
      expiresAt: a.expiresAt.toISOString(),
      createdAt: a.createdAt.toISOString(),
      evidence: a.evidence
        ? { matchedRules: a.evidence.matchedRulesJson, sourceRefs: a.evidence.sourceRefsJson, result: a.evidence.resultJson }
        : null,
    };
  }
}

const LEGAL_NOTICE = '本数据仅用于行程资格预筛，不构成法律、领事或入境保证。边检、领馆、承运人和目的地主管机关的实时决定具有最终效力。';

/** ER-14：模板解释。Nosana 只允许润色措辞且不得改变结论；MVP 默认模板，超时/不可用不影响结论。 */
function explainTemplate(matched: RuleV2 | undefined, decision: DecisionCode): string {
  if (!matched) {
    return '当前规则库没有可自动适用的详细规则，需人工核对目的地官方入境要求。';
  }
  const base = matched.decision.explanationZh;
  const mode =
    decision === 'ELIGIBLE' ? '搜索预筛：初步匹配。' :
    decision === 'CONDITIONALLY_ELIGIBLE' ? '搜索预筛：条件匹配，出票前需完成材料或人工复核。' :
    decision === 'NEEDS_INFO' ? '缺少必要事实，请补充证件或行程信息。' :
    decision === 'NEEDS_REVIEW' ? '规则或来源需人工核对，暂不自动放行。' :
    '该路线不满足此规则的适用条件。';
  return `${base} ${mode}`;
}
