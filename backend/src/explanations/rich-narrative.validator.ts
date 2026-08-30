/**
 * RichNarrativeValidator（14 号方案 §11）：模型输出必须通过全部检查，
 * 失败只重试一次，然后 RichTemplateNarrator 降级。
 */

import { StopoverExperienceContext } from './experience-context.builder';

export interface RichStopoverNarrative {
  schemaVersion: '2.0';
  lang: 'zh' | 'en';
  verdict: 'EXCELLENT_FIT' | 'GOOD_FIT' | 'BALANCED' | 'ONLY_IF_INTERESTED' | 'NOT_RECOMMENDED';
  headline: string;
  summary: string;
  cityAdvantages: Array<{ title: string; body: string; evidenceKeys: string[] }>;
  miniPlan: Array<{ slot: 'ARRIVAL_DAY' | 'FULL_DAY' | 'DEPARTURE_DAY'; title: string; description: string; evidenceKeys: string[] }>;
  easeNarrative: { summary: string; positives: string[]; cautions: string[] };
  tradeoff: { gain: string; sacrifice: string };
  practicalTip: string;
}

const VERDICTS = ['EXCELLENT_FIT', 'GOOD_FIT', 'BALANCED', 'ONLY_IF_INTERESTED', 'NOT_RECOMMENDED'];
const SLOTS = ['ARRIVAL_DAY', 'FULL_DAY', 'DEPARTURE_DAY'];

const MONEY_RE = /(\$|¥|€|£)|\d[\d,.]*\s*(SGD|USD|CNY|RMB|RM|THB|HKD|KRW|元|美元|美金|泰铢|港币|韩元)|(SGD|USD|CNY|RMB|RM|THB|HKD|KRW)\s*\d/i;
const TECH_RE = /nosana|ollama|qwen|gpu|deployment|推理耗时|inference time|model name/i;
const VISA_GUARANTEE_RE = /保证入境|guaranteed entry|一定可以入境|visa-free guarantee/i;
const REPEAT_RE = /停留\s*\d+\s*天|stay\s*\d+\s*days?|\d+(\.\d+)?\s*(小时|hours?)|usable hours|可玩|JoyScore|综合.{0,12}(价格|时间|舒适|风险)/i;
const CJK_RE = /[一-鿿]/;

export type ValidationResult = { ok: true; narrative: RichStopoverNarrative } | { ok: false; errors: string[] };

export function validateRichNarrative(raw: any, ctx: StopoverExperienceContext, lang: 'zh' | 'en'): ValidationResult {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null) return { ok: false, errors: ['not an object'] };

  if (!VERDICTS.includes(raw.verdict)) errors.push('verdict invalid');
  if (typeof raw.headline !== 'string' || raw.headline.length === 0) errors.push('headline missing');
  if (typeof raw.summary !== 'string' || raw.summary.length === 0) errors.push('summary missing');
  if (!Array.isArray(raw.cityAdvantages) || raw.cityAdvantages.length < 1 || raw.cityAdvantages.length > 3) errors.push('cityAdvantages count');
  if (!Array.isArray(raw.miniPlan) || raw.miniPlan.length < 1 || raw.miniPlan.length > 4) errors.push('miniPlan count');
  if (typeof raw.easeNarrative?.summary !== 'string') errors.push('easeNarrative.summary missing');
  if (!Array.isArray(raw.easeNarrative?.positives) || raw.easeNarrative.positives.length < 1 || raw.easeNarrative.positives.length > 3) errors.push('positives count');
  if (!Array.isArray(raw.easeNarrative?.cautions) || raw.easeNarrative.cautions.length > 2) errors.push('cautions count');
  if (typeof raw.tradeoff?.gain !== 'string' || typeof raw.tradeoff?.sacrifice !== 'string') errors.push('tradeoff missing');
  if (typeof raw.practicalTip !== 'string') errors.push('practicalTip missing');
  if (errors.length) return { ok: false, errors };

  const allowedKeys = new Set<string>([
    ...ctx.cityEvidence.map((e) => e.evidenceKey),
    ...ctx.feasibleExperienceBlocks.map((b) => b.evidenceKey),
  ]);
  const allowedAreas = new Set<string>([
    ...ctx.feasibleExperienceBlocks.map((b) => b.area),
    ...ctx.feasibleExperienceBlocks.map((b) => b.areaEn),
  ]);

  const allTexts: string[] = [raw.headline, raw.summary, raw.practicalTip, raw.tradeoff.gain, raw.tradeoff.sacrifice, raw.easeNarrative.summary, ...raw.easeNarrative.positives, ...raw.easeNarrative.cautions];
  for (const a of raw.cityAdvantages) {
    allTexts.push(a.title, a.body);
    if (!Array.isArray(a.evidenceKeys) || a.evidenceKeys.length === 0) errors.push('advantage without evidenceKeys');
    for (const k of a.evidenceKeys ?? []) if (!allowedKeys.has(k)) errors.push(`unknown evidenceKey ${k}`);
  }
  for (const m of raw.miniPlan) {
    if (!SLOTS.includes(m.slot)) errors.push('miniPlan slot invalid');
    allTexts.push(m.title, m.description);
    if (!Array.isArray(m.evidenceKeys) || m.evidenceKeys.length === 0) errors.push('miniPlan without evidenceKeys');
    for (const k of m.evidenceKeys ?? []) if (!allowedKeys.has(k)) errors.push(`unknown evidenceKey ${k}`);
  }

  const joined = allTexts.join('\n');
  if (MONEY_RE.test(joined)) errors.push('contains money/currency');
  if (TECH_RE.test(joined)) errors.push('contains tech attribution');
  if (VISA_GUARANTEE_RE.test(joined)) errors.push('contains visa guarantee');
  if (REPEAT_RE.test(joined)) errors.push('repeats stay/usable/JoyScore facts');
  // 未提供的区域/景点：文本不得引用资料库以外的具名区域
  for (const area of extractQuotedAreas(joined)) {
    if (!allowedAreas.has(area)) errors.push(`unprovided area ${area}`);
  }
  if (lang === 'zh' && !CJK_RE.test(raw.summary)) errors.push('lang mismatch: zh expected');
  if (lang === 'en' && CJK_RE.test(joined)) errors.push('lang mismatch: en expected');

  if (errors.length) return { ok: false, errors };
  return { ok: true, narrative: raw as RichStopoverNarrative };
}

/** 仅抽取引号内的具名区域，避免误伤普通描述。 */
function extractQuotedAreas(text: string): string[] {
  const out: string[] = [];
  const re = /[「『]([^」』]{2,18})[」』]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}
