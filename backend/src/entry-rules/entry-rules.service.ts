import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { EligibilityInput, EligibilityResult, evaluateEligibility, RuleSeed } from './rule-engine';

/**
 * 版本化入境规则服务：规则来自数据库种子（06 签证规则种子数据），
 * 评估结果为确定性硬门槛，LLM 不参与。
 */
@Injectable()
export class EntryRulesService {
  constructor(private readonly prisma: PrismaService) {}

  /** 查找适用规则：按护照国籍、类型与中转国家匹配。 */
  async findRule(passportCountry: string, passportType: string, transitCountry: string): Promise<RuleSeed | null> {
    const rule = await this.prisma.entryRule.findFirst({
      where: { passportCountry, passportType, transitCountry, status: 'ACTIVE' },
    });
    if (!rule) return null;
    return {
      id: rule.id,
      version: rule.version,
      passportCountry: rule.passportCountry,
      passportType: rule.passportType,
      transitCountry: rule.transitCountry,
      candidateCities: (rule.candidateCitiesJson as any) ?? [],
      entryMode: rule.entryMode as RuleSeed['entryMode'],
      maxStayDays: rule.maxStayDays,
      maxCumulativeStayDays: rule.maxCumulativeStayDays ?? undefined,
      cumulativeWindowDays: rule.cumulativeWindowDays ?? undefined,
      minPassportValidityMonths: rule.minPassportValidityMonths ?? undefined,
      requiredEvidence: (rule.requiredEvidenceJson as any) ?? [],
      hardConditions: (rule.hardConditionsJson as any) ?? [],
      sourceUrl: rule.sourceUrl,
      sourceVersion: rule.sourceVersion,
      verifiedAt: rule.verifiedAt.toISOString().slice(0, 10),
    };
  }

  async evaluate(input: EligibilityInput & { passportCountry?: string; passportType?: string }): Promise<EligibilityResult> {
    const country = input.passportCountry || input.passport?.issuingCountry || '';
    const type = input.passportType || input.passport?.type || '';
    const rule = country ? await this.findRule(country, type, input.destinationCountry) : null;
    return evaluateEligibility(rule, input);
  }

  /** 保存资格证据快照到搜索。 */
  async snapshot(
    searchRunId: string,
    cityId: string,
    countryCode: string,
    result: EligibilityResult,
  ): Promise<string> {
    const snap = await this.prisma.eligibilitySnapshot.create({
      data: {
        searchRunId,
        cityId,
        countryCode,
        status: result.status,
        ruleId: result.ruleId,
        ruleVersion: result.ruleVersion,
        reasonCodesJson: result.reasonCodes as any,
        requiredDocsJson: result.requiredDocuments as any,
        sourceUrl: result.sourceUrl,
        verifiedAt: result.verifiedAt,
      },
    });
    return snap.id;
  }
}
