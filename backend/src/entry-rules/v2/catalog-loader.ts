/**
 * RuleCatalogLoader（ER-01/02/15）：启动时按 JSON Schema 校验数据，解析版本和校验和；
 * 校验失败则服务健康状态 degraded，绝不部分激活。支持 DRAFT→ACTIVE 原子激活与回滚。
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma.service';
import { validateDataset } from './schema-validator';
import { DatasetV2, RuleV2 } from './types';
import bundled from '../data/cn-ordinary-passport-entry-rules.v2.json';

export function computeChecksum(ds: any): string {
  const canonical = JSON.stringify({
    schemaVersion: ds.schemaVersion,
    dataset: { ...ds.dataset, checksum: null },
    subject: ds.subject,
    policy: ds.policy,
    referenceGroups: ds.referenceGroups,
    sourceDocuments: ds.sourceDocuments,
    verifiedRules: ds.verifiedRules,
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

@Injectable()
export class RuleCatalogLoader implements OnModuleInit {
  private readonly logger = new Logger('RuleCatalogLoader');
  private active: { dataset: DatasetV2; checksum: string; ruleSetId: string } | null = null;
  loadErrors: string[] = [];

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    try {
      const existing = await this.prisma.entryRuleSet.findFirst({ where: { status: 'ACTIVE' }, include: { rules: true, sources: true } });
      if (existing) {
        this.active = { dataset: this.rebuildDataset(existing as any), checksum: existing.checksum, ruleSetId: existing.id };
        this.logger.log(`entry rules v2 ACTIVE: ${existing.datasetId} checksum=${existing.checksum}`);
        return;
      }
      // 首次启动：导入内置数据集并激活
      const res = await this.importDataset(bundled as any, true);
      if (res.ok) {
        this.logger.log(`entry rules v2 imported+activated checksum=${res.checksum}`);
      } else {
        this.loadErrors = res.errors;
        this.logger.error(`entry rules v2 import FAILED (${res.errors.length} errors); health degraded`);
      }
    } catch (e) {
      this.loadErrors = [(e as Error).message];
      this.logger.error(`entry rules v2 load crashed: ${(e as Error).message}`);
    }
  }

  get healthy(): boolean {
    return this.active !== null;
  }

  getActive() {
    return this.active;
  }

  /** 导入新数据集（默认 DRAFT）；activate=true 时原子激活。校验失败返回错误列表，不落库。 */
  async importDataset(ds: any, activate: boolean): Promise<{ ok: boolean; errors: string[]; checksum?: string; ruleSetId?: string }> {
    const errors = validateDataset(ds);
    if (errors.length) return { ok: false, errors };
    const checksum = computeChecksum(ds);
    const created = await this.prisma.$transaction(async (tx) => {
      const ruleSet = await tx.entryRuleSet.create({
        data: {
          datasetId: ds.dataset.datasetId,
          schemaVersion: ds.schemaVersion,
          asOf: new Date(ds.dataset.asOf),
          checksum,
          status: 'DRAFT',
          rules: {
            create: (ds.verifiedRules as RuleV2[]).map((r) => ({
              ruleId: r.ruleId,
              version: r.version,
              destinationCode: r.destination.countryCode,
              jurisdictionCode: r.destination.jurisdictionCode ?? null,
              category: r.category,
              status: r.status,
              priority: r.priority,
              effectiveFrom: r.validity.effectiveFrom ? new Date(r.validity.effectiveFrom) : null,
              effectiveTo: r.validity.effectiveTo ? new Date(r.validity.effectiveTo) : null,
              ruleJson: r as any,
            })),
          },
          sources: {
            create: (ds.sourceDocuments as any[]).map((s) => ({
              sourceId: s.sourceId,
              authority: s.authority,
              url: s.url,
              tier: s.tier,
              sourceUpdatedAt: s.sourceUpdatedAt ? new Date(s.sourceUpdatedAt) : null,
              lastCheckedAt: new Date(s.lastCheckedAt),
              status: s.status,
              supportsAutoDecision: s.supportsAutoDecision,
              summaryZh: s.summaryZh ?? null,
            })),
          },
        },
        include: { rules: true, sources: true },
      });
      if (activate) {
        await tx.entryRuleSet.updateMany({ where: { status: 'ACTIVE' }, data: { status: 'SUPERSEDED' } });
        await tx.entryRuleSet.update({ where: { id: ruleSet.id }, data: { status: 'ACTIVE', activatedAt: new Date() } });
      }
      return ruleSet;
    });
    if (activate) {
      this.active = { dataset: this.rebuildDataset(created as any), checksum, ruleSetId: created.id };
    }
    return { ok: true, errors: [], checksum, ruleSetId: created.id };
  }

  /** 激活指定 DRAFT 版本（原子）。 */
  async activate(ruleSetId: string) {
    await this.prisma.$transaction([
      this.prisma.entryRuleSet.updateMany({ where: { status: 'ACTIVE' }, data: { status: 'SUPERSEDED' } }),
      this.prisma.entryRuleSet.update({ where: { id: ruleSetId }, data: { status: 'ACTIVE', activatedAt: new Date() } }),
    ]);
    const full = await this.prisma.entryRuleSet.findUnique({ where: { id: ruleSetId }, include: { rules: true, sources: true } });
    if (full) this.active = { dataset: this.rebuildDataset(full as any), checksum: full.checksum, ruleSetId: full.id };
  }

  /** 回滚到上一 ACTIVE（即最近一个 SUPERSEDED）。 */
  async rollback() {
    const prev = await this.prisma.entryRuleSet.findFirst({ where: { status: 'SUPERSEDED' }, orderBy: { activatedAt: 'desc' }, include: { rules: true, sources: true } });
    if (!prev) throw new Error('no previous ACTIVE rule set');
    await this.activate(prev.id);
  }

  private rebuildDataset(set: { datasetId: string; schemaVersion: string; rules: any[]; sources: any[] } & Record<string, any>): DatasetV2 {
    const rules = set.rules.map((r) => r.ruleJson) as RuleV2[];
    const base = bundled as any;
    return {
      ...(base as DatasetV2),
      verifiedRules: rules,
      sourceDocuments: set.sources.map((s) => ({
        sourceId: s.sourceId,
        authority: s.authority,
        title: base.sourceDocuments.find((x: any) => x.sourceId === s.sourceId)?.title ?? s.sourceId,
        url: s.url,
        tier: s.tier,
        language: base.sourceDocuments.find((x: any) => x.sourceId === s.sourceId)?.language ?? 'en',
        lastCheckedAt: s.lastCheckedAt instanceof Date ? s.lastCheckedAt.toISOString() : s.lastCheckedAt,
        status: s.status,
        supportsAutoDecision: s.supportsAutoDecision,
        summaryZh: s.summaryZh ?? undefined,
      })),
    } as DatasetV2;
  }

  /** 复核队列：即将过期、来源陈旧、仅候选清单的国家。 */
  async reviewQueue(now = new Date()) {
    const ds = this.active?.dataset;
    if (!ds) return [];
    const items: any[] = [];
    for (const r of ds.verifiedRules) {
      if (r.validity.effectiveTo) {
        const to = new Date(`${r.validity.effectiveTo}T00:00:00Z`);
        if (to.getTime() - now.getTime() < 30 * 24 * 3600 * 1000) items.push({ ruleId: r.ruleId, kind: 'EXPIRING_SOON', effectiveTo: r.validity.effectiveTo });
      }
      if (r.review.reviewBy && new Date(r.review.reviewBy).getTime() < now.getTime()) items.push({ ruleId: r.ruleId, kind: 'REVIEW_OVERDUE', reviewBy: r.review.reviewBy });
      if (r.status === 'REVIEW_REQUIRED') items.push({ ruleId: r.ruleId, kind: 'REVIEW_REQUIRED' });
    }
    for (const list of ['unilateralVisaFree', 'visaOnArrival', 'visaFreeTransit'] as const) {
      for (const e of ds.coverageInventories?.legacyMfa2023?.[list] ?? []) {
        if (e.status === 'REVERIFY_REQUIRED') items.push({ countryCode: e.countryCode, jurisdictionCode: e.jurisdictionCode, kind: 'LEGACY_INVENTORY_REVERIFY', list });
      }
    }
    return items;
  }
}
