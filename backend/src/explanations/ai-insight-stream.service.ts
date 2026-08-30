import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { loadEnv } from '../config/env';
import { RedisService } from '../redis.service';
import { PROMPT_VERSION, StopoverExperienceContext } from './experience-context.builder';
import {
  AiInsightV2,
  INSIGHT_SCHEMA_VERSION,
  NdjsonAssembler,
  ObjectStreamAssembler,
  SECTION_ORDER,
  SectionName,
  SectionPayload,
  assembleInsight,
  buildInsightFacts,
  buildTemplateInsight,
  factsHashOf,
  guidedInsightSchema,
  insightCacheKey,
  missingSections,
  validateSection,
} from './insight-sections';
import { NosanaStreamError, NosanaStreamService } from './nosana-stream.service';

/** 产品化分析阶段：只暴露这四个状态，绝不外泄模型思维链（任务要求 5）。 */
export const INSIGHT_STAGES = {
  CHECKING_VISA: 'Checking visa eligibility...',
  COMPARING_COST: 'Comparing flight timing and total cost...',
  BUILDING_PLAN: 'Building your stopover plan...',
  FINALIZING: 'Finalizing the recommendation...',
} as const;

export type InsightStage = keyof typeof INSIGHT_STAGES;

/** 发送给客户端的 SSE 事件（Android 只允许解析这些类型）。 */
export type InsightEvent =
  | { event: 'status'; data: { stage: InsightStage; message: string } }
  | { event: 'section_start'; data: { section: SectionName } }
  | { event: 'delta'; data: { section: SectionName; text: string } }
  | { event: 'section_complete'; data: { section: SectionName; payload: SectionPayload } }
  | { event: 'done'; data: { source: AiInsightV2['source']; schemaVersion: string; insight: AiInsightV2; cached: boolean } }
  | { event: 'error'; data: { code: string; recoverable: boolean } };

const CACHE_TTL_SECONDS = 6 * 60 * 60;

/**
 * 流式 AI 推荐编排（流式实施任务 §4/§5/§8）。
 *
 * 数据流：Nosana vLLM SSE → NDJSON 按行缓冲 → 逐 section 校验 → 规范 SSE 事件 → Android。
 * 任何一步失败都以 RichTemplateNarrator 补齐同结构结果后正常 `done`，不给前端错误终态，
 * 因此 UI 不会出现无限 Loading / 空卡片 / 半截 JSON。
 */
@Injectable()
export class AiInsightStreamService {
  private readonly logger = new Logger('AiInsightStream');

  constructor(
    private readonly upstream: NosanaStreamService,
    private readonly redis: RedisService,
  ) {}

  /** 缓存命中时直接返回完整结果，不再调用 Nosana（任务要求 22）。 */
  async readCache(planId: string, ctx: StopoverExperienceContext, lang: 'zh' | 'en'): Promise<AiInsightV2 | null> {
    const key = insightCacheKey(planId, lang, PROMPT_VERSION, factsHashOf(ctx, lang));
    const raw = await this.redis.get(key).catch(() => null);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as AiInsightV2;
      return parsed?.schemaVersion === INSIGHT_SCHEMA_VERSION ? parsed : null;
    } catch {
      return null;
    }
  }

  private async writeCache(planId: string, ctx: StopoverExperienceContext, lang: 'zh' | 'en', insight: AiInsightV2) {
    const key = insightCacheKey(planId, lang, PROMPT_VERSION, factsHashOf(ctx, lang));
    await this.redis.set(key, JSON.stringify(insight), CACHE_TTL_SECONDS).catch(() => undefined);
  }

  /**
   * 生成事件流。`signal` 来自 HTTP 连接：客户端断开即取消上游。
   */
  async *stream(
    planId: string,
    ctx: StopoverExperienceContext,
    lang: 'zh' | 'en',
    signal: AbortSignal,
  ): AsyncGenerator<InsightEvent, void, void> {
    const env = loadEnv();
    const requestId = `ins_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const startedAt = Date.now();

    // 1) 连接即回第一个 status（目标 <100ms，不等任何 I/O）。
    yield status('CHECKING_VISA');

    // 2) 缓存命中：同一 planId+language+promptVersion+factsHash 不重复推理。
    const cached = await this.readCache(planId, ctx, lang);
    if (cached) {
      this.logger.log(`event=ai_insight_cache_hit request=${requestId} plan=${planId.slice(-8)} lang=${lang}`);
      for (const section of SECTION_ORDER) {
        yield { event: 'section_start', data: { section } };
        yield { event: 'section_complete', data: { section, payload: payloadOf(section, cached) } };
      }
      yield { event: 'done', data: { source: cached.source, schemaVersion: INSIGHT_SCHEMA_VERSION, insight: cached, cached: true } };
      return;
    }

    yield status('COMPARING_COST');

    const accepted = new Map<SectionName, SectionPayload>();
    let firstTokenMs: number | null = null;
    let rejected = 0;
    let failure: string | null = null;

    if (env.NOSANA_STREAMING_ENABLED && env.INFERENCE_PROVIDER === 'nosana') {
      const useGuided = NosanaStreamService.guidedSupported;
      // guided 模式：单对象 + 结构化解码（实测 Schema 有效率近 100%）；
      // 不支持时降为 NDJSON 自由生成，两条路径事件序列完全一致。
      const assembler = useGuided ? new ObjectStreamAssembler(lang) : new NdjsonAssembler(lang);
      try {
        const messages = [
          { role: 'system' as const, content: buildInsightSystemPrompt(lang, useGuided) },
          { role: 'user' as const, content: buildInsightUserPrompt(ctx, lang, useGuided) },
        ];
        for await (const chunk of this.upstream.streamChat(messages, signal, {
          guidedJson: useGuided ? guidedInsightSchema() : undefined,
        })) {
          if (firstTokenMs === null) {
            firstTokenMs = chunk.atMs;
            yield status('BUILDING_PLAN');
          }
          for (const piece of assembler.feed(chunk.text)) {
            const ev = this.consume(piece, ctx, lang, accepted, () => (rejected += 1));
            if (ev) yield ev;
          }
        }
        for (const piece of assembler.finish()) {
          const ev = this.consume(piece, ctx, lang, accepted, () => (rejected += 1));
          if (ev) yield ev;
        }
      } catch (e) {
        failure = e instanceof NosanaStreamError ? e.failure : 'NETWORK_ERROR';
        // 客户端主动离开页面：不需要补模板，直接结束（连接已断，写事件也没人收）。
        if (failure === 'UPSTREAM_ABORTED' && signal.aborted) {
          this.logger.log(`event=ai_insight_client_aborted request=${requestId} plan=${planId.slice(-8)}`);
          return;
        }
        this.logger.warn(`event=ai_insight_upstream_failed request=${requestId} failure=${failure} accepted=${accepted.size}`);
      }
    } else {
      failure = 'STREAMING_DISABLED';
    }

    if (signal.aborted) return;

    // 3) 结构补全：缺失/被拒绝的区块用模板补齐，保证 8 个区块都有内容。
    yield status('FINALIZING');
    const pending = missingSections(accepted);
    const insight = assembleInsight(accepted, ctx, lang);
    if (pending.length > 0 && !env.NOSANA_FALLBACK_ENABLED) {
      yield { event: 'error', data: { code: 'AI_STREAM_UNAVAILABLE', recoverable: true } };
      return;
    }
    for (const section of pending) {
      yield { event: 'section_start', data: { section } };
      yield { event: 'section_complete', data: { section, payload: payloadOf(section, insight) } };
    }

    await this.writeCache(planId, ctx, lang, insight);
    this.logger.log(
      `event=ai_insight_completed request=${requestId} plan=${planId.slice(-8)} lang=${lang} source=${insight.source} ` +
        `firstTokenMs=${firstTokenMs ?? -1} totalMs=${Date.now() - startedAt} aiSections=${accepted.size} rejected=${rejected} failure=${failure ?? 'none'}`,
    );
    yield { event: 'done', data: { source: insight.source, schemaVersion: INSIGHT_SCHEMA_VERSION, insight, cached: false } };
  }

  /** 把装配器的一个增量片段转成 SSE 事件（非法行只计数并丢弃，绝不透传）。 */
  private consume(
    piece: ReturnType<NdjsonAssembler["feed"]>[number],
    ctx: StopoverExperienceContext,
    lang: 'zh' | 'en',
    accepted: Map<SectionName, SectionPayload>,
    onReject: () => void,
  ): InsightEvent | null {
    if (piece.kind === 'section_start') {
      return accepted.has(piece.section) ? null : { event: 'section_start', data: { section: piece.section } };
    }
    if (piece.kind === 'delta') {
      // 同一 section 已定稿后不再推增量，避免重复或乱序。
      return accepted.has(piece.section) ? null : { event: 'delta', data: { section: piece.section, text: piece.text } };
    }
    if (piece.kind === 'malformed') {
      onReject();
      this.logger.warn(`event=ai_insight_line_rejected reason=malformed_json len=${piece.line.length}`);
      return null;
    }
    const v = validateSection(piece.raw, ctx, lang);
    if (!v.ok) {
      onReject();
      this.logger.warn(`event=ai_insight_line_rejected reason=${v.reason}`);
      return null;
    }
    if (accepted.has(v.payload.section)) return null; // 每个 section 只接受第一次
    accepted.set(v.payload.section, v.payload);
    return { event: 'section_complete', data: { section: v.payload.section, payload: v.payload } };
  }

  /** 非流式回滚/缓存路径共用：一次性拿到完整结果（不产生 SSE）。 */
  async generateBlocking(planId: string, ctx: StopoverExperienceContext, lang: 'zh' | 'en'): Promise<AiInsightV2> {
    const cached = await this.readCache(planId, ctx, lang);
    if (cached) return cached;
    const controller = new AbortController();
    const accepted = new Map<SectionName, SectionPayload>();
    for await (const ev of this.stream(planId, ctx, lang, controller.signal)) {
      if (ev.event === 'done') return ev.data.insight;
      if (ev.event === 'section_complete') accepted.set(ev.data.section, ev.data.payload);
    }
    return assembleInsight(accepted, ctx, lang);
  }

  /** 模板结果（Nosana 完全不可用时的同结构兜底）。 */
  templateInsight(ctx: StopoverExperienceContext, lang: 'zh' | 'en'): AiInsightV2 {
    return buildTemplateInsight(ctx, lang);
  }
}

function status(stage: InsightStage): InsightEvent {
  return { event: 'status', data: { stage, message: INSIGHT_STAGES[stage] } };
}

/** 从完整结果里取出某个 section 的规范载荷（缓存命中与模板补齐共用）。 */
function payloadOf(section: SectionName, insight: AiInsightV2): SectionPayload {
  switch (section) {
    case 'cityAdvantages':
      return { section, text: insight.cityAdvantages };
    case 'interestMatch':
      return { section, text: insight.interestMatch };
    case 'scheduleFit':
      return { section, text: insight.scheduleFit };
    case 'miniItinerary':
      return { section, items: insight.miniItinerary };
    case 'convenience':
      return { section, score: insight.convenienceScore, reasons: insight.convenienceReasons };
    case 'travelerGains':
      return { section, items: insight.travelerGains };
    case 'travelerAccepts':
      return { section, items: insight.travelerAccepts };
  }
}

/**
 * System prompt（任务 §5/§6）。
 *
 * 两种口径：
 * - `guided=true`：单个 JSON 对象，字段名即 section（结构由 vLLM guided 解码保证）；
 * - `guided=false`：逐区块 NDJSON（文档 §5 的原始方案，作为回退）。
 *
 * 两者的事实边界与红线完全相同：不编造、不提金额、不重新裁决签证、不输出思维链。
 */
export function buildInsightSystemPrompt(lang: 'zh' | 'en', guided = false): string {
  const zh = lang === 'zh';
  const ndjsonShape = [
    '{"section":"cityAdvantages","text":"..."}',
    '{"section":"interestMatch","text":"..."}',
    '{"section":"scheduleFit","text":"..."}',
    '{"section":"miniItinerary","items":["...","..."]}',
    '{"section":"convenience","score":88,"reasons":["...","..."]}',
    '{"section":"travelerGains","items":["...","..."]}',
    '{"section":"travelerAccepts","items":["...","..."]}',
  ].join('\n');

  const rulesZh =
    '强制规则：只能使用输入里的 cityEvidence 与 feasibleExperienceBlocks，不得新增景点、交通时长、营业时间或任何城市事实；' +
    '不得提及金额、票价、货币或节省；不得复述停留天数、可用小时数、JoyScore 或便利度分数；' +
    '签证与入境结论由本地规则引擎给出，你只能解释 eligibilityDisplayStatus，不得自行判断政策也不得承诺一定可以入境；' +
    '不得输出思考过程、自我说明、模型名、供应商、GPU 或部署信息；事实不足时减少条目而不是编造。';
  const rulesEn =
    'Hard rules: use only cityEvidence and feasibleExperienceBlocks from the input; never invent sights, transit durations, opening hours or city facts; ' +
    'never mention amounts, fares, currency or savings; never restate stay days, usable hours, JoyScore or the convenience score; ' +
    'visa and entry conclusions come from the local rule engine — you may only explain eligibilityDisplayStatus, never re-judge policy and never promise admission; ' +
    'never output reasoning steps, self-description, model names, vendors, GPU or deployment details; when facts are thin, write fewer items instead of inventing.';

  if (guided) {
    return zh
      ? [
          '你是 LayoverJoy 的中转体验编辑，不是航班、价格或签证决策器。',
          '输出一个 JSON 对象，字段含义：',
          'cityAdvantages：这座城市为什么值得这次停留；interestMatch：与旅客兴趣标签的匹配点；scheduleFit：起降时段形成的节奏是否合理；' +
            'miniItinerary：2-3 条可执行安排；convenienceReasons：2-3 条转机便利度依据；travelerGains：旅客获得什么；travelerAccepts：旅客必须接受的客观代价。',
          rulesZh,
          '语言：全部简体中文，具体、克制、有决策价值。',
        ].join('\n')
      : [
          'You are the LayoverJoy stopover experience editor, not a flight, price or visa decision maker.',
          'Output one JSON object. Field meanings:',
          'cityAdvantages: why this city is worth the stop; interestMatch: how it ties to the traveler interest tags; scheduleFit: whether the arrival and departure periods create a workable rhythm; ' +
            'miniItinerary: 2-3 executable blocks; convenienceReasons: 2-3 grounds for the transfer ease; travelerGains: what the traveler gets; travelerAccepts: the objective costs they must accept.',
          rulesEn,
          'Language: English only, concrete and decision-useful, no marketing filler.',
        ].join('\n');
  }

  return zh
    ? [
        '你是 LayoverJoy 的中转体验编辑，不是航班、价格或签证决策器。',
        '输出格式：每行一个独立且完整的 JSON 对象（NDJSON），共 7 行，顺序固定如下，行内不得换行，不要包裹代码块，不要输出任何解释性文字：',
        ndjsonShape,
        'items 与 reasons 必须是纯字符串数组（不得嵌套对象），每条 2-3 项；不要把示例里的省略号当成内容输出。',
        rulesZh,
        '语言：全部简体中文。',
      ].join('\n')
    : [
        'You are the LayoverJoy stopover experience editor, not a flight, price or visa decision maker.',
        'Output format: one complete standalone JSON object per line (NDJSON), 7 lines in this exact order, no line breaks inside a line, no code fences, no prose:',
        ndjsonShape,
        'items and reasons must be arrays of plain strings (never nested objects), 2-3 entries each; never emit the literal ellipsis placeholders from the shape above.',
        rulesEn,
        'Language: English only.',
      ].join('\n');
}

/**
 * User prompt：事实在前，**指令锤在最后**。
 * 1.5B 实测对“裸 JSON 结尾”的 user 消息容易直接回读事实，因此必须在末尾重申任务。
 */
export function buildInsightUserPrompt(ctx: StopoverExperienceContext, lang: 'zh' | 'en', guided = false): string {
  const zh = lang === 'zh';
  const facts = JSON.stringify(buildInsightFacts(ctx, lang));
  const head = zh ? '确定性事实（只读，不要回读或复制这段 JSON）：' : 'DETERMINISTIC FACTS (read-only, do not echo or copy this JSON):';
  const tail = guided
    ? zh
      ? '现在根据以上事实输出那个 JSON 对象，只写结论，不要重复事实字段名。'
      : 'Now write that JSON object for this city. Write conclusions only; do not repeat the fact field names.'
    : zh
      ? '现在输出 7 行 NDJSON，第一行以 {"section":"cityAdvantages" 开头。'
      : 'Now output the 7 NDJSON lines. Start immediately with {"section":"cityAdvantages".';
  return `${head}\n${facts}\n\n${tail}`;
}
