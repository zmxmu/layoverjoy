/**
 * Rich AI Stopover Insight v2 的「逐区块」契约（流式实施任务 §3 / §5）。
 *
 * 与旧 `RichStopoverNarrative` 的关系：旧结构继续服务非流式接口与回滚路径，
 * 本文件定义**流式专用**的 8 区块结构，字段名与任务文档逐字一致，便于 Android 直接渲染。
 *
 * 全部为纯函数：不依赖 Nest、不发网络请求，因此可在 vitest 里穷举流式边界。
 */

import { createHash } from 'crypto';
import { StopoverExperienceContext } from './experience-context.builder';
import { buildRichTemplateNarrative } from './rich-template-narrator';

export const INSIGHT_SCHEMA_VERSION = 'rich-insight-v2';

/** 事件里出现的 section 名（顺序即模型应当输出的顺序，也是 UI 渲染顺序）。 */
export const SECTION_ORDER = [
  'cityAdvantages',
  'interestMatch',
  'scheduleFit',
  'miniItinerary',
  'convenience',
  'travelerGains',
  'travelerAccepts',
] as const;

export type SectionName = (typeof SECTION_ORDER)[number];

/** 文本型区块（一段话）与列表型区块（若干条目）的区分，决定校验与增量渲染方式。 */
const TEXT_SECTIONS = new Set<SectionName>(['cityAdvantages', 'interestMatch', 'scheduleFit']);
const LIST_SECTIONS = new Set<SectionName>(['miniItinerary', 'travelerGains', 'travelerAccepts']);

export interface AiInsightV2 {
  schemaVersion: typeof INSIGHT_SCHEMA_VERSION;
  lang: 'zh' | 'en';
  cityAdvantages: string;
  interestMatch: string;
  scheduleFit: string;
  miniItinerary: string[];
  /** 便利度分数是确定性结果（StopoverEaseScore），模型不得改写。 */
  convenienceScore: number;
  convenienceReasons: string[];
  travelerGains: string[];
  travelerAccepts: string[];
  /** NOSANA=全部区块来自模型；HYBRID=部分区块由模板补齐；TEMPLATE=完全降级。 */
  source: 'NOSANA' | 'HYBRID' | 'TEMPLATE';
}

/** 单个 section 的规范化载荷（校验通过后才允许发给客户端）。 */
export type SectionPayload =
  | { section: 'cityAdvantages' | 'interestMatch' | 'scheduleFit'; text: string }
  | { section: 'miniItinerary' | 'travelerGains' | 'travelerAccepts'; items: string[] }
  | { section: 'convenience'; score: number; reasons: string[] };

// ---------------- 内容红线（与 rich-narrative.validator 同口径） ----------------

/** 金额/货币：金额是确定性事实，由 UI 展示，模型不得改写。 */
const MONEY_RE = /(\$|¥|€|£)|\d[\d,.]*\s*(SGD|USD|CNY|RMB|RM|THB|HKD|KRW|元|美元|美金|泰铢|港币|韩元)|(SGD|USD|CNY|RMB|RM|THB|HKD|KRW)\s*\d/i;
/** 技术归属：UI 不得出现供应商/模型/GPU/部署信息。 */
const TECH_RE = /nosana|ollama|qwen|vllm|gpu|deployment|endpoint|推理耗时|inference time|model name|token\/s/i;
/** 签证保证：资格结论只能由本地规则引擎给出，模型不得承诺入境。 */
const VISA_GUARANTEE_RE = /保证入境|一定可以入境|guaranteed entry|visa-free guarantee|will be admitted/i;
/** 隐藏思维链/自述过程：不得展示给用户。 */
const CHAIN_OF_THOUGHT_RE = /<\/?think>|<\/?reasoning>|作为(?:一个)?(?:AI|语言模型)|as an ai (?:language )?model|let me think|首先我(?:需要|要)分析/i;
/** 净体验窗口/停留天数/JoyScore/便利度分数只能在确定性 UI 出现一次，模型不得复述。 */
const REPEAT_RE =
  /停留\s*\d+\s*天|stay\s*\d+\s*days?|\d+(\.\d+)?\s*(小时|hours?)|usable hours|JoyScore|\d+\s*(?:\/|out of)\s*100|score\s*(?:of|is|:)\s*\d+|评分\s*\d+|\d+\s*分（?/i;

const CJK_RE = /[一-鿿]/;

/** 任一红线命中即判定该 section 不可用（调用方改用模板补齐该区块）。 */
export function violatesContentRules(text: string, lang: 'zh' | 'en'): string | null {
  if (MONEY_RE.test(text)) return 'money';
  if (TECH_RE.test(text)) return 'tech';
  if (VISA_GUARANTEE_RE.test(text)) return 'visa_guarantee';
  if (CHAIN_OF_THOUGHT_RE.test(text)) return 'chain_of_thought';
  if (REPEAT_RE.test(text)) return 'repeat_fact';
  if (lang === 'en' && CJK_RE.test(text)) return 'lang_mismatch';
  if (lang === 'zh' && !CJK_RE.test(text) && text.trim().length > 12) return 'lang_mismatch';
  return null;
}

/**
 * 校验模型给出的一行 NDJSON 对象。
 * `ctx` 用于把 convenience.score 强制改回确定性分数（模型不得自评便利度）。
 */
export function validateSection(
  raw: unknown,
  ctx: StopoverExperienceContext,
  lang: 'zh' | 'en',
): { ok: true; payload: SectionPayload } | { ok: false; reason: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, reason: 'not_object' };
  const obj = raw as Record<string, unknown>;
  const name = typeof obj.section === 'string' ? (obj.section.trim() as SectionName) : null;
  if (!name || !SECTION_ORDER.includes(name)) return { ok: false, reason: 'unknown_section' };

  /** 风险存在时绝不允许反向陈述（“无需重新托运”之类），宁可降级也不能误导。 */
  const negatesRisk = (t: string) => {
    if (!ctx.riskFlags.some((f) => f === 'SEPARATE_TICKETS' || f === 'RECHECK_BAGGAGE')) return false;
    return /no need|not required|no additional|no baggage|无需|不需要|不用重新|无忧/i.test(t);
  };

  if (TEXT_SECTIONS.has(name)) {
    const text = typeof obj.text === 'string' ? normalizeText(obj.text) : '';
    if (text.length < 8) return { ok: false, reason: 'text_too_short' };
    const bad = violatesContentRules(text, lang);
    if (bad) return { ok: false, reason: bad };
    if (negatesRisk(text)) return { ok: false, reason: 'negates_risk' };
    return { ok: true, payload: { section: name as 'cityAdvantages', text: text.slice(0, 420) } };
  }

  if (LIST_SECTIONS.has(name)) {
    const items = Array.isArray(obj.items)
      ? obj.items.map(coerceItem).filter((i): i is string => !!i && i.length >= 4)
      : [];
    if (items.length === 0) return { ok: false, reason: 'items_empty' };
    for (const item of items) {
      const bad = violatesContentRules(item, lang);
      if (bad) return { ok: false, reason: bad };
      if (negatesRisk(item)) return { ok: false, reason: 'negates_risk' };
    }
    return { ok: true, payload: { section: name as 'miniItinerary', items: items.slice(0, 4).map((i) => i.slice(0, 220)) } };
  }

  // convenience：只接受模型的 reasons，score 一律用确定性 StopoverEaseScore。
  const reasons = Array.isArray(obj.reasons)
    ? obj.reasons.map(coerceItem).filter((r): r is string => !!r && r.length >= 4)
    : [];
  if (reasons.length === 0) return { ok: false, reason: 'reasons_empty' };
  for (const reason of reasons) {
    const bad = violatesContentRules(reason, lang);
    if (bad) return { ok: false, reason: bad };
  }
  return {
    ok: true,
    payload: { section: 'convenience', score: ctx.ease.score, reasons: reasons.slice(0, 3).map((r) => r.slice(0, 220)) },
  };
}

/**
 * 列表条目归一化。
 * 1.5B 实测会偶发把 `items` 写成对象数组（如 `{"itemTitle":"...","details":"..."}`），
 * 这里把对象里的字符串值按顺序拼成一条——只重组已有内容，不补造任何事实。
 */
function coerceItem(raw: unknown): string | null {
  if (typeof raw === 'string') return normalizeText(raw);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const parts = Object.values(raw as Record<string, unknown>)
    .filter((v): v is string => typeof v === 'string')
    .map(normalizeText)
    .filter((v) => v.length > 0);
  return parts.length ? normalizeText(parts.join(' — ')) : null;
}

/** 去掉 Markdown 残留、零宽字符与多余空白（模型偶发输出 `- ` / `**`）。 */
function normalizeText(input: string): string {
  return input
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\*\*/g, '')
    .replace(/^[-*•\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------- 流式 NDJSON 装配 ----------------

/** 一次 feed 产生的增量事件（由服务层转成 SSE）。 */
export type StreamPiece =
  | { kind: 'section_start'; section: SectionName }
  | { kind: 'delta'; section: SectionName; text: string }
  | { kind: 'line'; raw: unknown }
  | { kind: 'malformed'; line: string };

/**
 * NDJSON 增量装配器。
 *
 * 两条职责：
 * 1. **按换行缓冲**：只有完整一行才 `JSON.parse` 并交给 [validateSection]（任务要求 7）；
 * 2. 在这一行还没结束时，从**已解析出的字符串字段**里挤出 delta 供 UI 增量显示 ——
 *    delta 取自 JSON 反转义后的 `text`/`items` 值，不是模型原始文本片段，
 *    因此不会把 `{"section":` 这类协议碎片或半截转义序列漏给客户端。
 *
 * delta 同样要过内容红线：一旦某个 section 的已确定正文出现金额/技术归属/思维链，
 * 该 section 立即被标记为「污染」并停止推增量（整行随后也会被 [validateSection] 拒绝，
 * 由模板补齐并在 `section_complete` 覆盖草稿），避免违规文本在 UI 上一闪而过。
 */
export class NdjsonAssembler {
  private buffer = '';
  private startedSections = new Set<SectionName>();
  private poisoned = new Set<SectionName>();
  /** 当前行已发出的 delta 长度，避免重复推送。 */
  private emittedLen = 0;
  private currentSection: SectionName | null = null;
  /** 未闭合的上一行（模型在一个 JSON 对象中间换了行）。 */
  private pending: string | null = null;
  /** 已续拼次数（单条记录上限 [MAX_LINE_JOINS]）。 */
  private joins = 0;

  constructor(private readonly lang: 'zh' | 'en' = 'en') {}

  feed(chunk: string): StreamPiece[] {
    const out: StreamPiece[] = [];
    this.buffer += chunk;

    let newlineAt: number;
    while ((newlineAt = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newlineAt);
      this.buffer = this.buffer.slice(newlineAt + 1);
      this.emitPartial(line, out); // 行尾最后一段 delta
      this.finishLine(line, out);
    }
    this.emitPartial(this.buffer, out);
    return out;
  }

  /** 上游结束但最后一行没有换行符时的收尾。 */
  finish(): StreamPiece[] {
    const out: StreamPiece[] = [];
    const tail = this.buffer.trim();
    this.buffer = '';
    if (tail.length > 0) {
      this.finishLine(tail, out);
    }
    // 还挂着未闭合的残片：它永远不会再闭合了，按非法行丢弃（不会发给客户端）。
    if (this.pending) {
      out.push({ kind: 'malformed', line: this.pending.slice(0, 200) });
      this.pending = null;
    }
    return out;
  }

  private finishLine(line: string, out: StreamPiece[]) {
    const trimmed = stripCodeFence(line);
    this.currentSection = null;
    this.emittedLen = 0;
    if (trimmed.length === 0) return;

    // 一行以 {"section" 开头就是一条新记录：无论之前挂着什么残片都先丢掉，
    // 否则一个坏行会把后面所有好行一起拼成非法 JSON（级联吞行）。
    const startsNewRecord = /^\{\s*"section"/.test(trimmed);
    let candidate = trimmed;
    if (this.pending && !startsNewRecord) {
      candidate = `${this.pending} ${trimmed}`;
    } else if (this.pending) {
      out.push({ kind: 'malformed', line: this.pending.slice(0, 200) });
      this.pending = null;
    }

    try {
      out.push({ kind: 'line', raw: JSON.parse(candidate) });
      this.pending = null;
      this.joins = 0;
      return;
    } catch {
      // 落下
    }
    // 只允许有限次续拼，避免模型一直不闭合时无限累积。
    if (isUnclosedJson(candidate) && this.joins < MAX_LINE_JOINS && candidate.length < MAX_PENDING_CHARS) {
      this.pending = candidate;
      this.joins += 1;
      return;
    }
    this.pending = null;
    this.joins = 0;
    out.push({ kind: 'malformed', line: candidate.slice(0, 200) });
  }

  /** 从未闭合的一行里读出 section 名与已确定的正文前缀。 */
  private emitPartial(partial: string, out: StreamPiece[]) {
    const line = stripCodeFence(partial);
    if (line.length === 0) return;
    const section = readSectionName(line);
    if (!section) return;
    if (this.currentSection !== section) {
      this.currentSection = section;
      this.emittedLen = 0;
      if (!this.startedSections.has(section)) {
        this.startedSections.add(section);
        out.push({ kind: 'section_start', section });
      }
    }
    const known = readPartialText(line);
    if (this.poisoned.has(section)) return;
    if (known.length <= this.emittedLen) return;
    const delta = known.slice(this.emittedLen);
    // 红线同时看「已确定正文」与「本次增量」：任一命中就把这个 section 标为污染，
    // 不再推增量（整行随后也会被 validateSection 拒绝，由模板在 section_complete 覆盖草稿）。
    if (violatesContentRules(known, this.lang) || violatesContentRules(delta, this.lang)) {
      this.poisoned.add(section);
      return;
    }
    this.emittedLen = known.length;
    out.push({ kind: 'delta', section, text: delta });
  }
}

/** 小模型偶发用 ```json 包裹整段输出。 */
function stripCodeFence(line: string): string {
  return line.replace(/^\s*```(?:json|ndjson)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

/** 一行拼接缓存上限：防止模型一直不闭合时无限累积。 */
const MAX_PENDING_CHARS = 4000;

/** 单条记录最多允许拼回几个续行。 */
const MAX_LINE_JOINS = 2;

/**
 * 引号外的花括号/方括号是否仍未闭合（即“这行还没写完”）。
 * 只用于判定能否拼下一行，真正的合法性仍由 JSON.parse 决定。
 */
function isUnclosedJson(line: string): boolean {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const ch of line) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') depth -= 1;
  }
  return depth > 0 || inString;
}

const SECTION_NAME_RE = /"section"\s*:\s*"([A-Za-z]+)"/;

// ---------------- guided 单对象流式装配 ----------------

/**
 * guided_json 请求的对象 key → section 映射。
 * 单对象 + 结构化解码比 NDJSON 在 1.5B 上稳得多（实测见 docs 与实施报告），
 * 而“逐区块渐进展示”由本装配器按 key 完成度实现，体验与 NDJSON 方案一致。
 */
export const GUIDED_KEY_TO_SECTION: Record<string, SectionName> = {
  cityAdvantages: 'cityAdvantages',
  interestMatch: 'interestMatch',
  scheduleFit: 'scheduleFit',
  miniItinerary: 'miniItinerary',
  convenienceReasons: 'convenience',
  travelerGains: 'travelerGains',
  travelerAccepts: 'travelerAccepts',
};

/**
 * 与上表一致的 JSON Schema（作为 `guided_json` 传给 vLLM）。
 *
 * 注意：**不要**在这里写 minLength/maxLength。字符计数约束会让结构化解码的
 * 逐 token 掩码代价暂增（实测同一部署：总耗时中位 7.7s → 28s，直接穿破 20s 预算）。
 * 长度统一由 [validateSection] 在后端裁剪与拒绝，不交给采样器。
 */
export function guidedInsightSchema() {
  const text = { type: 'string' };
  const list = (min: number, max: number) => ({
    type: 'array',
    items: { type: 'string' },
    minItems: min,
    maxItems: max,
  });
  return {
    type: 'object',
    properties: {
      cityAdvantages: text,
      interestMatch: text,
      scheduleFit: text,
      miniItinerary: list(2, 3),
      convenienceReasons: list(2, 3),
      travelerGains: list(2, 2),
      travelerAccepts: list(1, 2),
    },
    required: Object.keys(GUIDED_KEY_TO_SECTION),
    additionalProperties: false,
  };
}

/**
 * guided 单对象的增量装配器。
 *
 * 做法：每次 feed 后重扫累积缓冲（全文不过 1~2 KB），对每个已出现的 key 算出
 * “已确定的值”（字符串前缀 / 已闭合的数组元素），与已发送部分做差集后发 delta；
 * 值闭合时按 NDJSON 同形记录交给 [validateSection]（因此校验与降级逻辑完全复用）。
 * 同样有“污染”机制：已确定正文命中红线时停止推增量。
 */
export class ObjectStreamAssembler {
  private buffer = '';
  private started = new Set<SectionName>();
  private finalized = new Set<SectionName>();
  private poisoned = new Set<SectionName>();
  private emitted = new Map<SectionName, number>();

  constructor(private readonly lang: 'zh' | 'en' = 'en') {}

  feed(chunk: string): StreamPiece[] {
    this.buffer += chunk;
    const out: StreamPiece[] = [];

    // 按在缓冲里出现的位置排序，保证事件顺序与模型输出顺序一致。
    const found: Array<{ key: string; at: number }> = [];
    for (const key of Object.keys(GUIDED_KEY_TO_SECTION)) {
      const at = this.buffer.indexOf(`"${key}"`);
      if (at >= 0) found.push({ key, at });
    }
    found.sort((a, b) => a.at - b.at);

    for (const { key, at } of found) {
      const section = GUIDED_KEY_TO_SECTION[key];
      if (this.finalized.has(section)) continue;
      const read = readGuidedValue(this.buffer, at + key.length + 2);
      if (!read) continue;

      if (!this.started.has(section)) {
        this.started.add(section);
        out.push({ kind: 'section_start', section });
      }
      if (!this.poisoned.has(section)) {
        const shown = read.kind === 'string' ? read.text : read.items.join(' · ');
        const already = this.emitted.get(section) ?? 0;
        if (shown.length > already) {
          const delta = shown.slice(already);
          if (violatesContentRules(shown, this.lang) || violatesContentRules(delta, this.lang)) {
            this.poisoned.add(section);
          } else {
            this.emitted.set(section, shown.length);
            out.push({ kind: 'delta', section, text: delta });
          }
        }
      }
      if (read.closed) {
        this.finalized.add(section);
        out.push({ kind: 'line', raw: recordOf(section, read) });
      }
    }
    return out;
  }

  /** 上游结束：最后一个值可能因截断而未闭合，按非法丢弃（交由模板补齐）。 */
  finish(): StreamPiece[] {
    const out: StreamPiece[] = [];
    for (const section of this.started) {
      if (!this.finalized.has(section)) out.push({ kind: 'malformed', line: `unclosed:${section}` });
    }
    this.buffer = '';
    return out;
  }
}

type GuidedValue =
  | { kind: 'string'; text: string; closed: boolean }
  | { kind: 'array'; items: string[]; closed: boolean };

/** 从 `"key":` 之后读出已确定的值；还没开始写则返回 null。 */
function readGuidedValue(buffer: string, from: number): GuidedValue | null {
  let i = from;
  while (i < buffer.length && /[\s:]/.test(buffer[i])) i += 1;
  if (i >= buffer.length) return null;
  if (buffer[i] === '"') {
    const taken = takeStringPrefix(buffer.slice(i + 1));
    return { kind: 'string', text: unescapePrefix(taken.value), closed: taken.closed };
  }
  if (buffer[i] !== '[') return null;
  const rest = buffer.slice(i + 1);
  const items: string[] = [];
  let p = 0;
  let closed = false;
  while (p < rest.length) {
    // 数组结束：下一个非空白字符是 ]
    let q = p;
    while (q < rest.length && /[\s,]/.test(rest[q])) q += 1;
    if (q >= rest.length) break;
    if (rest[q] === ']') {
      closed = true;
      break;
    }
    if (rest[q] !== '"') break; // guided schema 下元素必为字符串
    const taken = takeStringPrefix(rest.slice(q + 1));
    if (!taken.closed) break; // 当前条目未写完，暂不展示
    items.push(unescapePrefix(taken.value));
    p = q + 1 + taken.consumed;
  }
  return { kind: 'array', items, closed };
}

/** 把 guided 值包成与 NDJSON 一致的记录，以便复用同一套校验。 */
function recordOf(section: SectionName, read: GuidedValue): Record<string, unknown> {
  if (read.kind === 'string') return { section, text: read.text };
  if (section === 'convenience') return { section, reasons: read.items };
  return { section, items: read.items };
}
export function readSectionName(line: string): SectionName | null {
  const m = SECTION_NAME_RE.exec(line);
  if (!m) return null;
  const name = m[1] as SectionName;
  return SECTION_ORDER.includes(name) ? name : null;
}

/**
 * 读出未闭合行里**已经确定**的正文：
 * - 文本型：`"text":"已经写到这里` → 返回已写部分；
 * - 列表型：只返回已闭合的条目，用「· 」连接，避免半截条目跳字。
 *
 * 末尾若停在反斜杠或不完整转义上，会退回到上一个安全位置。
 */
export function readPartialText(line: string): string {
  const textAt = /"text"\s*:\s*"/.exec(line);
  if (textAt) {
    const rest = line.slice(textAt.index + textAt[0].length);
    return unescapePrefix(takeStringPrefix(rest).value);
  }
  const listAt = /"(?:items|reasons)"\s*:\s*\[/.exec(line);
  if (listAt) {
    const rest = line.slice(listAt.index + listAt[0].length);
    const done: string[] = [];
    let i = 0;
    while (i < rest.length) {
      const quote = rest.indexOf('"', i);
      if (quote < 0) break;
      const taken = takeStringPrefix(rest.slice(quote + 1));
      if (!taken.closed) break; // 条目还没写完，先不显示
      done.push(unescapePrefix(taken.value));
      i = quote + 1 + taken.consumed;
    }
    return done.join(' · ');
  }
  return '';
}

/** 从 JSON 字符串体的起点读到闭合引号（或读到末尾），返回原始（仍带转义）内容。 */
function takeStringPrefix(rest: string): { value: string; closed: boolean; consumed: number } {
  let escaped = false;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') return { value: rest.slice(0, i), closed: true, consumed: i + 1 };
  }
  return { value: rest, closed: false, consumed: rest.length };
}

/** 反转义一个可能被截断的 JSON 字符串前缀：不完整的转义序列直接丢弃。 */
function unescapePrefix(raw: string): string {
  let safe = raw;
  // 结尾停在 `\` 或 `\u12` 这类不完整序列上时先截掉，避免 JSON.parse 抛错。
  safe = safe.replace(/\\(u[0-9a-fA-F]{0,3})?$/, '');
  try {
    return JSON.parse(`"${safe}"`) as string;
  } catch {
    return safe.replace(/\\n/g, ' ').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
}

// ---------------- 事实脱敏与缓存键 ----------------

/**
 * 发送给模型的匿名旅行事实（任务要求 17）。
 * 只有城市、时段、机场代码、便利度、城市资料、兴趣标签、风险码与资格结论；
 * **没有**姓名/邮箱/护照号/生日/证件/JWT，也不含金额与分钟数。
 *
 * 资料文本按请求语言裁剪：若同时送中英两套标题，小模型会把中文抄进英文正文，
 * 导致整批区块因语言不匹配被拒（实测：en 请求 7/7 区块全进模板降级）。
 */
export function buildInsightFacts(ctx: StopoverExperienceContext, lang: 'zh' | 'en' = 'en') {
  const zh = lang === 'zh';
  return {
    city: { cityId: ctx.city.cityId, name: zh ? ctx.city.nameZh : ctx.city.nameEn },
    schedule: {
      arrivalPeriod: ctx.schedule.arrivalPeriod,
      departurePeriod: ctx.schedule.departurePeriod,
      sameAirport: ctx.schedule.sameAirport,
      arrivalAirport: ctx.schedule.arrivalAirport,
      departureAirport: ctx.schedule.departureAirport,
      experienceWindowCode: ctx.schedule.experienceWindowCode,
      confidence: ctx.schedule.confidence,
    },
    ease: { score: ctx.ease.score, level: ctx.ease.level, positives: ctx.ease.positiveReasonCodes, cautions: ctx.ease.cautionReasonCodes },
    cityEvidence: ctx.cityEvidence.map((e) => ({
      evidenceKey: e.evidenceKey,
      title: zh ? e.title : e.titleEn,
      interestTags: e.interestTags,
    })),
    feasibleExperienceBlocks: ctx.feasibleExperienceBlocks.map((b) => ({
      evidenceKey: b.evidenceKey,
      title: zh ? b.title : b.titleEn,
      area: zh ? b.area : b.areaEn,
      slot: b.slot,
    })),
    matchedInterests: ctx.matchedInterests,
    // 风险码连可读释义一起送：实测 1.5B 会把 `SEPARATE_TICKETS` 自行理解成
    // 「景点需要单独买票」，给定义后就不会猜。
    risks: ctx.riskFlags.map((code) => ({ code, meaning: riskMeaning(code, lang) })),
    fareTradeoffBand: ctx.fareTradeoffBand,
    eligibilityDisplayStatus: ctx.eligibilityDisplayStatus,
  };
}

/** 风险码 → 一句话释义（只陈述已有事实，不新增任何结论）。 */
function riskMeaning(code: string, lang: 'zh' | 'en'): string {
  const zh = lang === 'zh';
  switch (code) {
    case 'SEPARATE_TICKETS':
      return zh ? '两段行程是两张独立机票，联程不受保障' : 'The trip is two separate flight tickets, so the connection is not protected';
    case 'RECHECK_BAGGAGE':
      return zh ? '行李需要在中转城市重新提取并托运' : 'Bags must be collected and re-checked in the stopover city';
    case 'RED_EYE_SEGMENTS':
      return zh ? '包含红眼航段' : 'The itinerary includes a red-eye segment';
    case 'ELIGIBILITY_NEEDS_REVIEW':
      return zh ? '入境资格仍需人工复核' : 'Entry eligibility still needs manual review';
    default:
      return code;
  }
}

/** factsHash：事实（含语言口径）变了就必须重新生成，保证缓存不会返回过时解读。 */
export function factsHashOf(ctx: StopoverExperienceContext, lang: 'zh' | 'en' = 'en'): string {
  return createHash('sha256').update(JSON.stringify(buildInsightFacts(ctx, lang))).digest('hex').slice(0, 16);
}

/** 缓存键：planId + language + promptVersion + factsHash（任务要求 21）。 */
export function insightCacheKey(planId: string, lang: 'zh' | 'en', promptVersion: string, factsHash: string): string {
  return `ai_insight_v2:${planId}:${lang}:${promptVersion}:${factsHash}`;
}

// ---------------- 模板降级（与 AI 结果同构） ----------------

/**
 * RichTemplateNarrator 的 8 区块投影：Nosana 超时/断流/非法输出时补齐，
 * 结构与 AI 结果完全一致，UI 不需要第二套渲染分支（任务要求 14）。
 */
export function buildTemplateInsight(ctx: StopoverExperienceContext, lang: 'zh' | 'en'): AiInsightV2 {
  const zh = lang === 'zh';
  const n = buildRichTemplateNarrative(ctx, lang);
  const advantage = n.cityAdvantages[0];
  const interestNames = ctx.matchedInterests.slice(0, 3).join(zh ? '、' : ', ');
  const sep = zh ? '：' : ' — ';
  return {
    schemaVersion: INSIGHT_SCHEMA_VERSION,
    lang,
    cityAdvantages: advantage ? `${advantage.title}${sep}${advantage.body}` : n.summary,
    interestMatch: interestNames
      ? zh
        ? `与你选择的${interestNames}偏好一致，落点集中在同一片区域，不用来回穿城。`
        : `Matches your ${interestNames} preferences, kept inside one district instead of crossing the city.`
      : zh
        ? '没有勾选兴趣标签时，按城市代表性内容与最短移动路径安排。'
        : 'With no interest tags selected, the plan follows the city highlights along the shortest route.',
    scheduleFit: n.summary,
    miniItinerary: n.miniPlan.map((m) => `${m.title} — ${m.description}`),
    convenienceScore: ctx.ease.score,
    convenienceReasons: [...n.easeNarrative.positives, ...n.easeNarrative.cautions].slice(0, 3),
    travelerGains: [n.tradeoff.gain, n.practicalTip].filter((s) => s && s.length > 0),
    travelerAccepts: [n.tradeoff.sacrifice],
    source: 'TEMPLATE',
  };
}

/**
 * 用已收到的 AI 区块 + 模板补齐，产出完整结果。
 * 缺失或被拒绝的区块用模板值填充，绝不返回半截内容（任务要求 15）。
 */
export function assembleInsight(
  accepted: Map<SectionName, SectionPayload>,
  ctx: StopoverExperienceContext,
  lang: 'zh' | 'en',
): AiInsightV2 {
  const template = buildTemplateInsight(ctx, lang);
  if (accepted.size === 0) return template;

  const text = (name: SectionName, fallback: string) => {
    const p = accepted.get(name);
    return p && 'text' in p ? p.text : fallback;
  };
  const list = (name: SectionName, fallback: string[]) => {
    const p = accepted.get(name);
    return p && 'items' in p ? p.items : fallback;
  };
  const convenience = accepted.get('convenience');
  // travelerAccepts 是风险披露，**一律用确定性模板**：实测 1.5B 会把
  // SEPARATE_TICKETS / RECHECK_BAGGAGE 写成“无需额外买票、无需重新托运”（极其危险的反向叙述），
  // 而风险与金额、签证、便利度分数同属不得由模型改写的确定性事实。
  const modelSections = SECTION_ORDER.filter((s) => s !== 'travelerAccepts');
  const aiCovered = modelSections.filter((s) => accepted.has(s)).length;
  return {
    schemaVersion: INSIGHT_SCHEMA_VERSION,
    lang,
    cityAdvantages: text('cityAdvantages', template.cityAdvantages),
    interestMatch: text('interestMatch', template.interestMatch),
    scheduleFit: text('scheduleFit', template.scheduleFit),
    miniItinerary: list('miniItinerary', template.miniItinerary),
    // 分数永远来自确定性引擎，即使模型给了别的值。
    convenienceScore: ctx.ease.score,
    convenienceReasons: convenience && 'reasons' in convenience ? convenience.reasons : template.convenienceReasons,
    travelerGains: list('travelerGains', template.travelerGains),
    travelerAccepts: template.travelerAccepts,
    source: aiCovered === modelSections.length ? 'NOSANA' : 'HYBRID',
  };
}

/** 哪些区块还没被模型正确给出（用于补发 section_complete，UI 不留空位）。 */
export function missingSections(accepted: Map<SectionName, SectionPayload>): SectionName[] {
  return SECTION_ORDER.filter((s) => !accepted.has(s));
}
