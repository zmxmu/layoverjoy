import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { isMaskedSecret, loadEnv } from '../config/env';
import { StopoverExperienceContext, PROMPT_VERSION } from './experience-context.builder';
import { RichStopoverNarrative, validateRichNarrative } from './rich-narrative.validator';
import { buildRichTemplateNarrative } from './rich-template-narrator';

export interface RichExplanationResult {
  narrative: RichStopoverNarrative;
  provider: 'NOSANA' | 'TEMPLATE';
  debugMeta: {
    requestId: string;
    provider: string;
    modelId: string | null;
    latencyMs: number;
    deploymentIdTail: string | null;
    fallbackReason: string | null;
    promptVersion: string;
  };
}

export type ExplanationFallbackReason =
  | 'PROVIDER_DISABLED'
  | 'NOT_CONFIGURED'
  | 'TIMEOUT'
  | 'HTTP_ERROR'
  | 'PARSE_ERROR'
  | 'VALIDATION_ERROR'
  | 'NETWORK_ERROR';

/** 输出中禁止出现的货币/金额表述（金额由 UI 确定性展示，模型不得改写）。 */
const MENTION_MONEY = /\$|USD|SGD|dollar|美元|美金|欧元|€|¥|元/;

export interface ExplanationRequest {
  cityNameZh: string;
  cityNameEn?: string;
  /** 输出语言：zh 简体 / en English；缺省 zh。 */
  lang?: 'zh' | 'en';
  stayDays: number;
  usableHours: number;
  airfareDelta: number;
  currency: string;
  joyScore: number;
  joyScoreBreakdown: unknown;
  riskFlags: string[];
  interests: string[];
}

export interface ExplanationResult {
  provider: 'NOSANA' | 'TEMPLATE';
  modelId?: string;
  /** 部署 ID 后 8 位（不含完整 ID，供 UI/证据展示）。 */
  deploymentIdTail?: string;
  latencyMs?: number;
  generatedAt?: string;
  /** 生成时使用的语言，供缓存按语言失效。 */
  lang?: 'zh' | 'en';
  /** TEMPLATE 时的降级原因分类，诚实展示而非伪装成 Nosana。 */
  fallbackReason?: ExplanationFallbackReason;
  summary: string;
  highlights: string[];
  tips: string[];
}

/**
 * Nosana 解释服务（09 文档 §6）：
 * Nosana 只生成解释和体验建议，不生成航班、价格、签证结论或订单状态。
 * 调用失败必须降级为本地模板解释，并在结果中标记 provider=TEMPLATE 及原因。
 *
 * 鉴权说明：部署内是 Ollama OpenAI-compatible endpoint，推理本身不校验 Bearer；
 * NOSANA_API_KEY 属于管理面凭据，仅在非空且未脱敏时随请求携带，不作为推理前置条件。
 */
@Injectable()
export class NosanaService {
  private readonly logger = new Logger('NosanaService');

  /** 最近一次推理状态（供 /integrations 健康面板，不依赖"环境变量非空"）。 */
  static lastInferenceSucceededAt: string | null = null;
  static lastErrorCategory: string | null = null;

  /** 模板降级解释：不调用任何外部服务；按请求语言输出。 */
  templateExplanation(req: ExplanationRequest, reason?: ExplanationFallbackReason): ExplanationResult {
    const lang = req.lang ?? 'zh';
    const days = req.usableHours / 24;
    if (lang === 'en') {
      const city = req.cityNameEn?.trim() || req.cityNameZh;
      const deltaText =
        req.airfareDelta > 0
          ? `costs about ${req.airfareDelta} ${req.currency} more than a direct flight`
          : req.airfareDelta < 0
            ? `saves about ${Math.abs(req.airfareDelta)} ${req.currency} versus a direct flight`
            : 'is priced on par with a direct flight';
      return {
        provider: 'TEMPLATE',
        fallbackReason: reason,
        lang,
        generatedAt: new Date().toISOString(),
        summary: `A ${req.stayDays}-day stopover in ${city} gives you roughly ${days.toFixed(1)} usable days and ${deltaText}.`,
        highlights: [
          `${req.stayDays} days turn a connection into a real mini-trip`,
          `JoyScore ${req.joyScore}: price, playtime, comfort and risk combined`,
        ],
        tips: [
          'Two separate tickets: allow ample connection time and re-check bags',
          'Re-check official entry rules before booking',
        ],
      };
    }
    const deltaText =
      req.airfareDelta > 0
        ? `相比直飞多花约 ${req.airfareDelta} ${req.currency}`
        : req.airfareDelta < 0
          ? `相比直飞节省约 ${Math.abs(req.airfareDelta)} ${req.currency}`
          : '与直飞价格相当';
    return {
      provider: 'TEMPLATE',
      fallbackReason: reason,
      lang,
      generatedAt: new Date().toISOString(),
      summary: `在${req.cityNameZh}停留 ${req.stayDays} 天，大约有 ${days.toFixed(1)} 天有效游玩时间，${deltaText}。`,
      highlights: [
        `${req.stayDays} 天停留让转机变成一段真正的短途旅行`,
        `JoyScore ${req.joyScore} 分：综合价格、游玩时间、舒适度与风险`,
      ],
      tips: [
        '两张独立机票：请为转机预留充足时间，行李需要重新托运',
        '预订前请再次查看官方入境规则来源',
      ],
    };
  }

  /** 调用 Nosana OpenAI-compatible Chat Completion（非流式、JSON 输出）。 */
  async explain(req: ExplanationRequest): Promise<ExplanationResult> {
    const env = loadEnv();
    if (env.INFERENCE_PROVIDER !== 'nosana') {
      return this.templateExplanation(req, 'PROVIDER_DISABLED');
    }
    if (!env.NOSANA_OPENAI_BASE_URL) {
      NosanaService.lastErrorCategory = 'NOT_CONFIGURED';
      return this.templateExplanation(req, 'NOT_CONFIGURED');
    }
    // 管理 Key 脱敏/缺失时不带 Authorization（Ollama 端不校验），而不是直接降级。
    const apiKey = isMaskedSecret(env.NOSANA_API_KEY) ? '' : env.NOSANA_API_KEY;
    const deploymentTail = env.NOSANA_DEPLOYMENT_ID ? env.NOSANA_DEPLOYMENT_ID.slice(-8) : undefined;

    const startedAt = Date.now();
    const deadline = startedAt + env.NOSANA_TIMEOUT_MS;
    const lang = req.lang ?? 'zh';
    // 金额/货币是确定性事实（详情页 JoyCard 已展示）；3B 模型曾把 SGD 改写成 $/USD，
    // 故将其完全移出 AI 职责，并用输出校验兜底（见 MENTION_MONEY 校验）。
    const userPrompt = JSON.stringify({
      city: lang === 'en' ? (req.cityNameEn?.trim() || req.cityNameZh) : req.cityNameZh,
      stayDays: req.stayDays,
      usableHours: req.usableHours,
      joyScore: req.joyScore,
      riskFlags: req.riskFlags,
    });
    const buildSystemPrompt = (strict: boolean) =>
      lang === 'en'
        ? [
            'You are the LayoverJoy travel experience narrator. Only narrate the travel experience (time, comfort, risks, activities); never invent or recompute flights, prices, visa conclusions or order status.',
            'NEVER mention prices, costs, savings, amounts or any currency code/symbol — the app displays them elsewhere.',
            'Output MUST be valid JSON: {"summary": string, "highlights": string[], "tips": string[]}',
            'Language: English only (never mix other languages); summary within 30 words; highlights exactly 1; tips exactly 1.',
            ...(strict ? ['STRICT REMINDER: your previous output was rejected for containing a price/amount/currency; remove all of them.'] : []),
          ].join('\n')
        : [
            '你是 LayoverJoy 的旅行体验解说员。只解说旅行体验（时间、舒适度、风险、玩法），不生成新的航班、价格、签证结论或订单状态。',
            '严禁提及任何价格、费用、节省金额或货币代码/符号——界面其他位置已展示。',
            '输出必须是合法 JSON：{"summary": string, "highlights": string[], "tips": string[]}',
            '语言：简体中文；summary 不超过 45 字；highlights 1 条；tips 1 条。',
            ...(strict ? ['严格提醒：上一次输出因包含价格/金额/货币被拒绝，必须全部移除。'] : []),
          ].join('\n');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    // 接口风格自适应：Ollama 原生 /api/chat 优先（可对 qwen3 系关思考，实测 10 倍提速）；
    // 部署若为 vLLM 等非 Ollama 栈（原生接口 404/405）自动改用 OpenAI 兼容 /v1/chat/completions。
    let style: 'native' | 'openai' = 'native';
    let strict = false;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const budgetMs = deadline - Date.now();
      if (budgetMs < 5000) break;
      const systemPrompt = buildSystemPrompt(strict);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), budgetMs);
      try {
        const rootBase = env.NOSANA_OPENAI_BASE_URL.replace(/\/v1\/?$/, '').replace(/\/$/, '');
        const url = style === 'native' ? `${rootBase}/api/chat` : `${rootBase}/v1/chat/completions`;
        const body =
          style === 'native'
            ? {
                model: env.NOSANA_MODEL,
                stream: false,
                ...(env.NOSANA_MODEL.startsWith('qwen3') ? { think: false } : {}),
                format: 'json',
                messages: [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: userPrompt },
                ],
              }
            : {
                model: env.NOSANA_MODEL,
                stream: false,
                response_format: { type: 'json_object' },
                messages: [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: userPrompt },
                ],
              };
        const res = await fetch(url, { method: 'POST', signal: controller.signal, headers, body: JSON.stringify(body) });
        if (!res.ok) {
          if (style === 'native' && (res.status === 404 || res.status === 405)) {
            style = 'openai';
            continue;
          }
          NosanaService.lastErrorCategory = `HTTP_${res.status}`;
          this.logger.warn(`Nosana HTTP ${res.status}; falling back to template explanation`);
          return this.templateExplanation(req, 'HTTP_ERROR');
        }
        const data: any = await res.json();
        const content: string =
          style === 'native' ? (data?.message?.content ?? '') : (data?.choices?.[0]?.message?.content ?? '');
        const parsed = JSON.parse(content);
        if (typeof parsed.summary !== 'string' || !parsed.summary) throw new Error('invalid explanation payload');
        // 输出校验（09 文档约定）：命中货币/金额表述即判失败，重试一次再降级模板。
        const texts: unknown[] = [
          parsed.summary,
          ...(Array.isArray(parsed.highlights) ? parsed.highlights : []),
          ...(Array.isArray(parsed.tips) ? parsed.tips : []),
        ];
        if (texts.some((t) => typeof t === 'string' && MENTION_MONEY.test(t))) {
          throw new Error('validation: output mentions money');
        }
        NosanaService.lastInferenceSucceededAt = new Date().toISOString();
        NosanaService.lastErrorCategory = null;
        return {
          provider: 'NOSANA',
          modelId: data?.model || env.NOSANA_MODEL,
          deploymentIdTail: deploymentTail,
          latencyMs: Date.now() - startedAt,
          generatedAt: new Date().toISOString(),
          lang,
          summary: parsed.summary,
          highlights: Array.isArray(parsed.highlights) ? parsed.highlights.slice(0, 4) : [],
          tips: Array.isArray(parsed.tips) ? parsed.tips.slice(0, 4) : [],
        };
      } catch (e) {
        const aborted = (e as Error).name === 'AbortError';
        const msg = (e as Error).message ?? '';
        const reason: ExplanationFallbackReason = aborted
          ? 'TIMEOUT'
          : msg.startsWith('validation')
            ? 'VALIDATION_ERROR'
            : e instanceof SyntaxError || msg.includes('invalid explanation payload')
              ? 'PARSE_ERROR'
              : 'NETWORK_ERROR';
        NosanaService.lastErrorCategory = reason;
        if (reason === 'VALIDATION_ERROR' && attempt === 1) strict = true;
        if (aborted || attempt === 2) {
          this.logger.warn(`Nosana call failed (${(e as Error).message}); falling back to template explanation`);
          return this.templateExplanation(req, reason);
        }
        this.logger.warn(`Nosana attempt ${attempt} failed (${(e as Error).message}); retrying once`);
      } finally {
        clearTimeout(timer);
      }
    }
    return this.templateExplanation(req, 'TIMEOUT');
  }

  // ---------- v2 丰富解读（14 号方案） ----------

  private static inflight = new Map<string, Promise<RichExplanationResult>>();

  /** single-flight：同一 cacheKey 并发请求只推理一次。 */
  async explainRich(cacheKey: string, ctx: StopoverExperienceContext, lang: 'zh' | 'en'): Promise<RichExplanationResult> {
    const existing = NosanaService.inflight.get(cacheKey);
    if (existing) return existing;
    const p = this.computeRich(ctx, lang).finally(() => NosanaService.inflight.delete(cacheKey));
    NosanaService.inflight.set(cacheKey, p);
    return p;
  }

  private async computeRich(ctx: StopoverExperienceContext, lang: 'zh' | 'en'): Promise<RichExplanationResult> {
    const env = loadEnv();
    const startedAt = Date.now();
    const requestId = `exp_${randomUUID().replace(/-/g, '')}`;
    const meta = (provider: string, fallbackReason: string | null) => ({
      requestId,
      provider,
      modelId: env.NOSANA_MODEL,
      latencyMs: Date.now() - startedAt,
      deploymentIdTail: env.NOSANA_DEPLOYMENT_ID ? env.NOSANA_DEPLOYMENT_ID.slice(-8) : null,
      fallbackReason,
      promptVersion: PROMPT_VERSION,
    });
    if (env.INFERENCE_PROVIDER === 'nosana' && env.NOSANA_OPENAI_BASE_URL) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const content = await this.chatRich(ctx, lang, attempt === 2, env);
          const v = validateRichNarrative(JSON.parse(content), ctx, lang);
          if (v.ok) {
            this.logger.log(
              `event=stopover_explanation_completed requestTail=${requestId.slice(-8)} provider=NOSANA latencyMs=${Date.now() - startedAt} fallback=none promptVersion=${PROMPT_VERSION}`,
            );
            return { narrative: v.narrative, provider: 'NOSANA', debugMeta: meta('NOSANA', null) };
          }
          this.logger.warn(`event=stopover_explanation_rejected requestTail=${requestId.slice(-8)} attempt=${attempt} errors=${v.errors.slice(0, 3).join(';')}`);
        } catch (e) {
          this.logger.warn(`event=stopover_explanation_failed requestTail=${requestId.slice(-8)} attempt=${attempt} category=${(e as Error).name}`);
        }
      }
      return { narrative: buildRichTemplateNarrative(ctx, lang), provider: 'TEMPLATE', debugMeta: meta('TEMPLATE', 'VALIDATION_OR_NETWORK') };
    }
    return { narrative: buildRichTemplateNarrative(ctx, lang), provider: 'TEMPLATE', debugMeta: meta('TEMPLATE', 'PROVIDER_DISABLED') };
  }

  /** v2 system prompt（中英语义一致，14 号方案 §10.1）。 */
  private richSystemPrompt(lang: 'zh' | 'en', strict: boolean): string {
    const zh = lang === 'zh';
    const lines = zh
      ? [
          '你是 LayoverJoy 的中转体验编辑，不是航班、价格或签证决策器。',
          '基于输入中已提供的确定性事实回答：为什么这座城市适合这次中转；当前起落时间形成怎样的体验节奏；哪些城市优势匹配用户兴趣；转机是否便利以及主要代价；如何在给定时间块内安排不过度赶路的小行程。',
          '强制规则：只能使用输入的 cityEvidence 和 feasibleExperienceBlocks，不得新增景点、交通时间、营业时间或城市事实；不得计算或修改航班、价格、JoyScore、StopoverEaseScore、签证结论和订单状态；不得重复总停留天数、可用体验小时或 JoyScore 定义；不得出现模型名、供应商、GPU、Deployment 或推理耗时；不得使用空泛套话；每条城市优势和小行程必须返回有效 evidenceKeys；事实不足时减少输出项，不得补写常识；输出合法 JSON 且符合 RichStopoverNarrative schema；简体中文自然、具体、克制。',
        ]
      : [
          'You are the LayoverJoy stopover experience editor, not a flight, price or visa decision maker.',
          'Using only the deterministic facts provided, answer: why this city fits this stopover; what rhythm the arrival/departure times create; which city advantages match the traveler interests; how easy the transfer is and its main costs; and a small itinerary inside the given time blocks.',
          'Hard rules: use only cityEvidence and feasibleExperienceBlocks from the input; never add sights, transport times, opening hours or city facts; never compute or alter flights, prices, JoyScore, StopoverEaseScore, visa conclusions or order status; never repeat total stay days, usable hours or JoyScore definitions; never mention model names, providers, GPU, deployments or latency; avoid generic cliches; every advantage and mini-plan block must carry valid evidenceKeys; when facts are thin, output fewer items instead of inventing; output valid JSON matching RichStopoverNarrative; English must be natural, specific and restrained.',
        ];
    if (strict) lines.push(zh ? '严格提醒：上一次输出因违反规则被拒绝，必须修正 evidenceKeys 并移除违禁内容。' : 'STRICT REMINDER: your previous output was rejected; fix evidenceKeys and remove prohibited content.');
    return lines.join('\n');
  }

  /** 脱敏上下文：不含分钟数/金额/PII/Secret；兴趣真实进入 prompt。 */
  private sanitizeContextForPrompt(ctx: StopoverExperienceContext) {
    return {
      city: ctx.city,
      schedule: {
        arrivalPeriod: ctx.schedule.arrivalPeriod,
        departurePeriod: ctx.schedule.departurePeriod,
        sameAirport: ctx.schedule.sameAirport,
        arrivalAirport: ctx.schedule.arrivalAirport,
        departureAirport: ctx.schedule.departureAirport,
        experienceWindowCode: ctx.schedule.experienceWindowCode,
        experienceWindowLabelZh: ctx.schedule.experienceWindowLabelZh,
        experienceWindowLabelEn: ctx.schedule.experienceWindowLabelEn,
        confidence: ctx.schedule.confidence,
      },
      ease: ctx.ease,
      cityEvidence: ctx.cityEvidence,
      feasibleExperienceBlocks: ctx.feasibleExperienceBlocks,
      matchedInterests: ctx.matchedInterests,
      riskFlags: ctx.riskFlags,
      fareTradeoffBand: ctx.fareTradeoffBand,
      eligibilityDisplayStatus: ctx.eligibilityDisplayStatus,
    };
  }

  private async chatRich(ctx: StopoverExperienceContext, lang: 'zh' | 'en', strict: boolean, env: ReturnType<typeof loadEnv>): Promise<string> {
    const apiKey = isMaskedSecret(env.NOSANA_API_KEY) ? '' : env.NOSANA_API_KEY;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const messages = [
      { role: 'system', content: this.richSystemPrompt(lang, strict) },
      { role: 'user', content: JSON.stringify(this.sanitizeContextForPrompt(ctx)) },
    ];
    const rootBase = env.NOSANA_OPENAI_BASE_URL.replace(/\/v1\/?$/, '').replace(/\/$/, '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.NOSANA_TIMEOUT_MS);
    try {
      // 原生 /api/chat 优先，404/405 回退 OpenAI 兼容
      let res = await fetch(`${rootBase}/api/chat`, {
        method: 'POST',
        signal: controller.signal,
        headers,
        body: JSON.stringify({ model: env.NOSANA_MODEL, stream: false, ...(env.NOSANA_MODEL.startsWith('qwen3') ? { think: false } : {}), format: 'json', messages }),
      });
      if (res.status === 404 || res.status === 405) {
        res = await fetch(`${rootBase}/v1/chat/completions`, {
          method: 'POST',
          signal: controller.signal,
          headers,
          body: JSON.stringify({ model: env.NOSANA_MODEL, stream: false, response_format: { type: 'json_object' }, messages }),
        });
      }
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      const data: any = await res.json();
      const content = data?.message?.content ?? data?.choices?.[0]?.message?.content ?? '';
      if (!content) throw new Error('EMPTY_CONTENT');
      return content;
    } finally {
      clearTimeout(timer);
    }
  }
}
