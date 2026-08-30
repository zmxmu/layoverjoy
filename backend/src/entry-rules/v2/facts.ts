/**
 * EligibilityFactsBuilder：把账户证件、签证/居留、历史声明与完整行程归一为事实对象（ER-03/09）。
 * 事实路径与规则 JSON 中的 fact 字段一一对应；缺失路径返回 undefined → 三值 UNKNOWN。
 */

import { HUB_CATALOG } from '../../airports/catalog';
import { AssessInput, QualifyingDoc } from './types';

const iataIndex = new Map<string, { countryCode: string; cityId: string }>();
for (const c of HUB_CATALOG) {
  for (const a of c.airports) iataIndex.set(a.iata, { countryCode: c.countryCode, cityId: c.cityId });
}

export function cityByIata(iata: string): { countryCode: string; cityId: string } | undefined {
  return iataIndex.get((iata || '').toUpperCase());
}

/** 由 AssessInput 构建事实对象。 */
export function buildFacts(input: AssessInput): Record<string, any> {
  const it = input.itinerary;
  const segments = it.segments ?? [];
  const stopoverCountry = it.stopover?.country ?? (segments.length >= 2 ? cityByIata(segments[0].to)?.countryCode : undefined);
  const stopoverJurisdiction = it.stopover?.jurisdiction ?? null;
  const stopoverAirport = it.stopover?.airport ?? (segments.length >= 1 ? segments[0].to : undefined);
  const stayHours = it.stopover?.stayHours ?? (segments.length >= 2 ? hoursBetween(segments[0].arrivalAt, segments[1].departureAt) : undefined);
  const stayDays = it.stayDays ?? (stayHours !== undefined ? Math.max(1, Math.round(stayHours / 24)) : undefined);
  const arrivalDate = it.arrivalDate ?? (segments.length ? segments[0].arrivalAt?.slice(0, 10) : undefined);
  // 评估对象是中转地：destination.* 优先取 stopover，避免航段末点与评估对象不一致。
  const destCountry = it.stopover?.country ?? it.destination?.country ?? (segments.length ? cityByIata(segments[segments.length - 1].to)?.countryCode : undefined);
  const destRegion = it.destination?.region ?? null;
  const entryAirport = it.stopover?.airport ?? it.entryAirport ?? (segments.length ? segments[0].to : undefined);

  const docs: QualifyingDoc[] = input.traveler.documents ?? [];

  return {
    traveler: {
      passport: input.traveler.passport ?? {},
      qualifyingDocuments: docs,
      visas: docs.filter((d) => d.kind === 'VISA'),
      history: input.traveler.history ?? {},
    },
    itinerary: {
      purpose: it.purpose,
      segments,
      stayDays,
      stayHours,
      arrivalDate,
      entryAirport,
      exitAirport: it.exitAirport ?? (segments.length ? segments[segments.length - 1].from : undefined),
      destination: { country: destCountry, region: destRegion },
      stopover: { country: stopoverCountry, jurisdiction: stopoverJurisdiction, airport: stopoverAirport, stayHours },
      route: { segments },
    },
    documents: input.documents ?? {},
    assessment: {
      sourceCheckedAt: new Date().toISOString(),
      manualReview: input.manualReview ?? {},
    },
  };
}

function hoursBetween(a?: string, b?: string): number | undefined {
  if (!a || !b) return undefined;
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return undefined;
  return (db.getTime() - da.getTime()) / 3600_000;
}

/** 事实哈希（不含证件号等敏感原文）：仅护照签发国/类型/有效期与签证签发国/类型/次数/有效期。 */
export function factsHash(facts: Record<string, any>): string {
  const p = facts.traveler?.passport ?? {};
  const docs = (facts.traveler?.qualifyingDocuments ?? []).map((d: QualifyingDoc) => ({
    k: d.kind, i: d.issuerCountry, t: d.visaType, e: d.entryCount, vf: d.validFrom, vu: d.validUntil, u: d.usedBefore,
  }));
  const payload = JSON.stringify({ p: { c: p.issuingCountry, t: p.type, vu: p.validUntil }, docs });
  return simpleHash(payload);
}

export function itineraryHash(it: AssessInput['itinerary']): string {
  return simpleHash(JSON.stringify(it));
}

export function simpleHash(s: string): string {
  // FNV-1a 32bit ×2（演示级指纹，非加密用途）
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    h1 ^= s.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = (Math.imul(h2 ^ s.charCodeAt(i), 0x85ebca6b) >>> 0);
  }
  return `${h1.toString(16)}${h2.toString(16)}`;
}
