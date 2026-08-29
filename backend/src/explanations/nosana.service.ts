import { Injectable, Logger } from '@nestjs/common';
import { isMaskedSecret, loadEnv } from '../config/env';

export type ExplanationFallbackReason =
  | 'PROVIDER_DISABLED'
  | 'NOT_CONFIGURED'
  | 'TIMEOUT'
  | 'HTTP_ERROR'
  | 'PARSE_ERROR'
  | 'NETWORK_ERROR';

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
    const systemPrompt =
      lang === 'en'
        ? [
            'You are the LayoverJoy travel experience narrator. Only explain the structured plan provided; never invent flights, prices, visa conclusions or order status.',
            'Output MUST be valid JSON: {"summary": string, "highlights": string[], "tips": string[]}',
            'Language: English; summary within 60 words; highlights 2-3; tips 1-3.',
          ].join('\n')
        : [
            '你是 LayoverJoy 的旅行体验解说员。只解释已给出的结构化方案，不生成新的航班、价格、签证结论或订单状态。',
            '输出必须是合法 JSON：{"summary": string, "highlights": string[], "tips": string[]}',
            '语言：简体中文；summary 不超过 80 字；highlights 2-3 条；tips 1-3 条。',
          ].join('\n');
    const userPrompt = JSON.stringify({
      city: lang === 'en' ? (req.cityNameEn?.trim() || req.cityNameZh) : req.cityNameZh,
      stayDays: req.stayDays,
      usableHours: req.usableHours,
      airfareDelta: req.airfareDelta,
      currency: req.currency,
      joyScore: req.joyScore,
      joyScoreBreakdown: req.joyScoreBreakdown,
      riskFlags: req.riskFlags,
      interests: req.interests,
    });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    // 09 文档约定：推理失败最多重试一次（仅解析/网络类错误重试；超时与 HTTP 错误直接降级），再失败降级模板。
    for (let attempt = 1; attempt <= 2; attempt++) {
      const budgetMs = deadline - Date.now();
      if (budgetMs < 5000) break;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), budgetMs);
      try {
        const res = await fetch(`${env.NOSANA_OPENAI_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          signal: controller.signal,
          headers,
          body: JSON.stringify({
            model: env.NOSANA_MODEL,
            stream: false,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
          }),
        });
        if (!res.ok) {
          NosanaService.lastErrorCategory = `HTTP_${res.status}`;
          this.logger.warn(`Nosana HTTP ${res.status}; falling back to template explanation`);
          return this.templateExplanation(req, 'HTTP_ERROR');
        }
        const data: any = await res.json();
        const content: string = data?.choices?.[0]?.message?.content ?? '';
        const parsed = JSON.parse(content);
        if (typeof parsed.summary !== 'string' || !parsed.summary) throw new Error('invalid explanation payload');
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
        const reason: ExplanationFallbackReason = aborted
          ? 'TIMEOUT'
          : e instanceof SyntaxError
            ? 'PARSE_ERROR'
            : 'NETWORK_ERROR';
        NosanaService.lastErrorCategory = reason;
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
}
