import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AppError } from '../common/errors';

export interface DocumentInput {
  kind: 'PASSPORT' | 'VISA' | 'RESIDENCE';
  countryCode: string;
  passportType?: string;
  visaType?: string;
  entryType?: string;
  entryCount?: string; // SINGLE | DOUBLE | MULTIPLE | NOT_APPLICABLE | UNKNOWN
  verificationMode?: string; // PASSPORT_STICKER | E_VISA | ONLINE_PORTAL | PHYSICAL_CARD | UNKNOWN
  issuerCountry?: string;
  usedBefore?: boolean;
  remainingEntries?: number;
  validFrom?: string;
  expiresOn?: string;
  isPrimary?: boolean;
}

/**
 * 证件钱包服务。
 * 边界：MVP 不保存证件号码、签证号码与证件照片，只保存规则判断所需属性。
 * 每用户最多一本 ACTIVE 且 isPrimary 的主护照。
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  private toUtcDate(s?: string): Date | null {
    if (!s) return null;
    const d = new Date(`${s.slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }

  async listDocuments(userId: string) {
    const docs = await this.prisma.travelDocument.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
    });
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return docs.map((d) => {
      let docStatus: string = d.status;
      if (d.expiresOn && d.expiresOn < today) docStatus = 'EXPIRED';
      return {
        id: d.id,
        kind: d.kind,
        countryCode: d.countryCode,
        passportType: d.passportType,
        visaType: d.visaType,
        entryType: d.entryType,
        remainingEntries: d.remainingEntries,
        validFrom: d.validFrom?.toISOString().slice(0, 10) ?? null,
        expiresOn: d.expiresOn?.toISOString().slice(0, 10) ?? null,
        isPrimary: d.isPrimary,
        status: docStatus,
        // 缺有效期的签证：需要补充资料
        needsInfo: d.kind !== 'PASSPORT' && !d.expiresOn ? true : undefined,
      };
    });
  }

  /** 首页钱包摘要：护照与有效签证数量分开统计。 */
  async walletSummary(userId: string) {
    const docs = await this.listDocuments(userId);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const passport = docs.find((d) => d.kind === 'PASSPORT' && d.status !== 'EXPIRED') || null;
    const visas = docs.filter((d) => d.kind === 'VISA');
    const validVisas = visas.filter((d) => {
      if (!d.expiresOn) return false;
      const exp = new Date(`${d.expiresOn}T00:00:00Z`);
      if (exp < today) return false;
      if (d.validFrom) {
        const from = new Date(`${d.validFrom}T00:00:00Z`);
        if (from > today) return false; // 有效期尚未完整开始
      }
      return true;
    });
    const expiredVisas = visas.filter((d) => d.status === 'EXPIRED');
    const needsInfoVisas = visas.filter((d) => !d.expiresOn);
    return {
      passport: passport
        ? { countryCode: passport.countryCode, passportType: passport.passportType, expiresOn: passport.expiresOn, status: passport.status }
        : null,
      validVisaCount: validVisas.length,
      validVisas: validVisas.map((v) => ({ countryCode: v.countryCode, visaType: v.visaType, expiresOn: v.expiresOn })),
      expiredVisaCount: expiredVisas.length,
      needsInfoCount: needsInfoVisas.length,
    };
  }

  async createDocument(userId: string, input: DocumentInput) {
    if (!input.kind || !['PASSPORT', 'VISA', 'RESIDENCE'].includes(input.kind)) {
      throw AppError.validation(['kind'], '证件类型不正确。');
    }
    if (!/^[A-Z]{2}$/.test(input.countryCode || '')) {
      throw AppError.validation(['countryCode'], '国家代码必须为 ISO 3166-1 alpha-2。');
    }
    if (input.kind === 'PASSPORT') {
      const existing = await this.prisma.travelDocument.findFirst({
        where: { userId, kind: 'PASSPORT', deletedAt: null, status: 'ACTIVE' },
      });
      if (existing) {
        throw new AppError('DUPLICATE_PASSPORT', '每位用户只能保留一本有效主护照，请先删除旧护照。', 409);
      }
      input.isPrimary = true;
    }
    const doc = await this.prisma.travelDocument.create({
      data: {
        userId,
        kind: input.kind,
        countryCode: input.countryCode,
        passportType: input.passportType,
        visaType: input.visaType,
        entryType: input.entryType,
        remainingEntries: input.remainingEntries,
        validFrom: this.toUtcDate(input.validFrom) ?? undefined,
        expiresOn: this.toUtcDate(input.expiresOn) ?? undefined,
        isPrimary: Boolean(input.isPrimary),
      },
    });
    return { id: doc.id };
  }

  async updateDocument(userId: string, id: string, input: Partial<DocumentInput>) {
    const doc = await this.prisma.travelDocument.findFirst({ where: { id, userId, deletedAt: null } });
    if (!doc) throw AppError.notFound('证件');
    const updated = await this.prisma.travelDocument.update({
      where: { id },
      data: {
        countryCode: input.countryCode,
        passportType: input.passportType,
        visaType: input.visaType,
        entryType: input.entryType,
        entryCount: input.entryCount !== undefined ? input.entryCount : undefined,
        verificationMode: input.verificationMode !== undefined ? input.verificationMode : undefined,
        issuerCountry: input.issuerCountry !== undefined ? input.issuerCountry : undefined,
        usedBefore: input.usedBefore !== undefined ? input.usedBefore : undefined,
        remainingEntries: input.remainingEntries,
        validFrom: input.validFrom !== undefined ? this.toUtcDate(input.validFrom) ?? undefined : undefined,
        expiresOn: input.expiresOn !== undefined ? this.toUtcDate(input.expiresOn) ?? undefined : undefined,
      },
    });
    return { id: updated.id };
  }

  async deleteDocument(userId: string, id: string) {
    const doc = await this.prisma.travelDocument.findFirst({ where: { id, userId, deletedAt: null } });
    if (!doc) throw AppError.notFound('证件');
    await this.prisma.travelDocument.update({ where: { id }, data: { deletedAt: new Date(), status: 'REVOKED' } });
    return { ok: true };
  }

  /** 供规则引擎使用的用户证件视图。 */
  async profileForRules(userId: string) {
    const docs = await this.listDocuments(userId);
    const passport = docs.find((d) => d.kind === 'PASSPORT' && d.status !== 'EXPIRED');
    const visas = docs.filter((d) => d.kind === 'VISA' && d.status !== 'EXPIRED');
    return {
      passport: passport
        ? { issuingCountry: passport.countryCode, type: passport.passportType || 'ORDINARY', validUntil: passport.expiresOn || undefined, validFrom: passport.validFrom || undefined }
        : undefined,
      visas: visas.map((v) => ({ country: v.countryCode, type: v.visaType || undefined, validUntil: v.expiresOn || undefined, entryType: v.entryType || undefined })),
      /** v2 规则引擎证件视图（ER-03）：含签发地/次数/载体/是否使用。 */
      qualifyingDocuments: docs
        .filter((d) => (d.kind === 'VISA' || d.kind === 'RESIDENCE') && d.status !== 'EXPIRED' && d.status !== 'REVOKED')
        .map((d) => ({
          kind: d.kind === 'RESIDENCE' ? 'PERMANENT_RESIDENCE' : d.kind,
          issuerCountry: (d as any).issuerCountry ?? d.countryCode,
          visaType: d.visaType || undefined,
          entryCount: (d as any).entryCount ?? d.entryType ?? undefined,
          validFrom: d.validFrom || undefined,
          validUntil: d.expiresOn || undefined,
          usedBefore: (d as any).usedBefore ?? undefined,
          verificationMode: (d as any).verificationMode ?? undefined,
          status: d.status,
        })),
      residenceCountry: null as string | null,
    };
  }
}
