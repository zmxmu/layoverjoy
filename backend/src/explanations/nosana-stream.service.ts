import { Injectable, Logger } from '@nestjs/common';
import { isMaskedSecret, loadEnv } from '../config/env';

/** 上游流式过程中的原始文本增量（尚未解析成 section）。 */
export interface UpstreamChunk {
  text: string;
  /** 该 chunk 到达时距请求开始的毫秒数，用于记录首 token 延迟。 */
  atMs: number;
}

export type StreamFailure =
  | 'NOT_CONFIGURED'
  | 'PROVIDER_DISABLED'
  | 'MODEL_UNAVAILABLE'
  | 'HTTP_ERROR'
  | 'FIRST_TOKEN_TIMEOUT'
  | 'TOTAL_TIMEOUT'
  | 'UPSTREAM_ABORTED'
  | 'NETWORK_ERROR';

export class NosanaStreamError extends Error {
  constructor(
    readonly failure: StreamFailure,
    message?: string,
  ) {
    super(message ?? failure);
    this.name = 'NosanaStreamError';
  }
}

export interface ModelsProbe {
  httpStatus: number;
  modelIds: string[];
  /** 实际用于 Chat Completions 的 model 值。 */
  servedModel: string | null;
  latencyMs: number;
  raw: string;
}

/**
 * Nosana vLLM OpenAI-compatible 流式客户端（流式实施任务 §4.3）。
 *
 * 三条硬约束：
 * 1. Chat Completions 的 `model` 取自 `/v1/models` 的**实际返回 id**（不是 Hugging Face 仓库名）；
 * 2. 首 token 超时与总超时分别计时，任一超时都立刻 abort 上游、释放 GPU；
 * 3. 调用方（HTTP 断开）传入的 AbortSignal 必须能级联取消上游请求。
 */
@Injectable()
export class NosanaStreamService {
  private readonly logger = new Logger('NosanaStream');

  /** /v1/models 结果缓存：避免每次生成都多一次 RTT。 */
  private static modelCache: { id: string; at: number } | null = null;
  private static readonly MODEL_TTL_MS = 5 * 60 * 1000;

  /** 最近一次流式推理的观测值（供 /integrations 面板与验收报告）。 */
  static lastStream: {
    at: string;
    servedModel: string | null;
    firstTokenMs: number | null;
    totalMs: number | null;
    outcome: string;
  } | null = null;

  /** 部署是否支持 guided_json（首次 400/422 后不再重试，避免每次多一轮 RTT）。 */
  static guidedSupported = true;

  /** 本次请求实际是否用了结构化解码（调用方据此选择装配器）。 */
  usedGuided = false;

  /** 流式基址：优先流式专用 endpoint，其次旧 3B（回滚路径）。返回不带 /v1 的 root。 */
  rootBase(): string | null {
    const env = loadEnv();
    const raw = env.NOSANA_STREAM_BASE_URL || env.NOSANA_OPENAI_BASE_URL;
    if (!raw) return null;
    return raw.replace(/\/v1\/?$/, '').replace(/\/$/, '');
  }

  private headers(): Record<string, string> {
    const env = loadEnv();
    const apiKey = isMaskedSecret(env.NOSANA_API_KEY) ? '' : env.NOSANA_API_KEY;
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) h.Authorization = `Bearer ${apiKey}`;
    return h;
  }

  /** GET /v1/models：返回实际模型 id 列表与 HTTP 状态（诊断接口也用它）。 */
  async probeModels(timeoutMs = 8000): Promise<ModelsProbe> {
    const root = this.rootBase();
    if (!root) return { httpStatus: 0, modelIds: [], servedModel: null, latencyMs: 0, raw: 'NOT_CONFIGURED' };
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${root}/v1/models`, { headers: this.headers(), signal: controller.signal });
      const raw = await res.text();
      let ids: string[] = [];
      if (res.ok) {
        try {
          const parsed = JSON.parse(raw);
          ids = Array.isArray(parsed?.data)
            ? parsed.data.map((d: any) => (typeof d?.id === 'string' ? d.id : null)).filter((x: unknown): x is string => !!x)
            : [];
        } catch {
          ids = [];
        }
      }
      return {
        httpStatus: res.status,
        modelIds: ids,
        servedModel: ids[0] ?? null,
        latencyMs: Date.now() - startedAt,
        // 503 时上游返回的是 HTML 占位页，只留摘要避免污染日志。
        raw: raw.slice(0, 300),
      };
    } catch (e) {
      return { httpStatus: 0, modelIds: [], servedModel: null, latencyMs: Date.now() - startedAt, raw: (e as Error).message };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 解析请求要用的 model 值：/v1/models 的实际 id 优先，探测失败退回 NOSANA_SERVED_MODEL。
   * 绝不使用 NOSANA_HF_MODEL（Hugging Face 仓库名只用于诊断日志）。
   */
  async resolveServedModel(): Promise<string> {
    const env = loadEnv();
    const cached = NosanaStreamService.modelCache;
    if (cached && Date.now() - cached.at < NosanaStreamService.MODEL_TTL_MS) return cached.id;
    const probe = await this.probeModels();
    if (probe.servedModel) {
      NosanaStreamService.modelCache = { id: probe.servedModel, at: Date.now() };
      if (probe.servedModel !== env.NOSANA_SERVED_MODEL) {
        this.logger.log(`event=served_model_resolved actual=${probe.servedModel} configured=${env.NOSANA_SERVED_MODEL}`);
      }
      return probe.servedModel;
    }
    this.logger.warn(`event=served_model_probe_failed status=${probe.httpStatus} falling_back=${env.NOSANA_SERVED_MODEL}`);
    return env.NOSANA_SERVED_MODEL;
  }

  /** 供健康面板：清掉 model 缓存（换部署后不必重启进程）。 */
  static resetModelCache() {
    NosanaStreamService.modelCache = null;
  }

  /** 单次 Chat Completions 请求（流式）；guided 非空时带上 vLLM 结构化解码参数。 */
  private post(
    root: string,
    servedModel: string,
    messages: Array<{ role: 'system' | 'user'; content: string }>,
    guided: unknown,
    signal: AbortSignal,
  ) {
    const env = loadEnv();
    return fetch(`${root}/v1/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      signal,
      body: JSON.stringify({
        model: servedModel,
        stream: true,
        temperature: env.NOSANA_TEMPERATURE,
        top_p: env.NOSANA_TOP_P,
        max_tokens: env.NOSANA_MAX_TOKENS,
        messages,
        ...(guided ? { guided_json: guided } : {}),
      }),
    });
  }

  /**
   * 流式对话。以 async generator 逐块产出**已解码的正文增量**，
   * 调用方负责结构装配；本层只处理 SSE 传输层（data: 行、空行、[DONE]、UTF-8 分片）。
   *
   * `guidedJson` 非空时优先用 vLLM 结构化解码（Schema 有效率近 100%）；
   * 若部署不支持（HTTP 400/422）则自动重试一次自由生成，由调用方改用 NDJSON 装配。
   */
  async *streamChat(
    messages: Array<{ role: 'system' | 'user'; content: string }>,
    externalSignal: AbortSignal,
    opts: { guidedJson?: unknown } = {},
  ): AsyncGenerator<UpstreamChunk, void, void> {
    const env = loadEnv();
    if (env.INFERENCE_PROVIDER !== 'nosana' || !env.NOSANA_STREAMING_ENABLED) {
      throw new NosanaStreamError('PROVIDER_DISABLED');
    }
    const root = this.rootBase();
    if (!root) throw new NosanaStreamError('NOT_CONFIGURED');

    const servedModel = await this.resolveServedModel();
    const startedAt = Date.now();
    const controller = new AbortController();
    // 客户端断开 → 级联 abort 上游，立即释放 GPU（任务要求 11）。
    const onExternalAbort = () => controller.abort();
    if (externalSignal.aborted) throw new NosanaStreamError('UPSTREAM_ABORTED');
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });

    let firstTokenMs: number | null = null;
    let outcome: string = 'ok';
    const firstTokenTimer = setTimeout(() => {
      if (firstTokenMs === null) {
        outcome = 'FIRST_TOKEN_TIMEOUT';
        controller.abort();
      }
    }, env.NOSANA_FIRST_TOKEN_TIMEOUT_MS);
    const totalTimer = setTimeout(() => {
      if (outcome === 'ok') outcome = 'TOTAL_TIMEOUT';
      controller.abort();
    }, env.NOSANA_TOTAL_TIMEOUT_MS);

    try {
      let guided = opts.guidedJson;
      let res = await this.post(root, servedModel, messages, guided, controller.signal);
      // 旧版 vLLM / 未启用 outlines 时会直接报 400/422：降级为自由生成（调用方会改用 NDJSON 装配）。
      if (guided && (res.status === 400 || res.status === 422)) {
        this.logger.warn(`event=guided_json_unsupported status=${res.status} retrying_freeform=true`);
        guided = undefined;
        NosanaStreamService.guidedSupported = false;
        res = await this.post(root, servedModel, messages, undefined, controller.signal);
      }
      if (!res.ok || !res.body) {
        outcome = `HTTP_${res.status}`;
        throw new NosanaStreamError('HTTP_ERROR', `HTTP_${res.status}`);
      }
      this.usedGuided = !!guided;

      // TextDecoder(stream:true) 负责跨 chunk 的 UTF-8 分片；SSE 帧以空行分隔。
      const decoder = new TextDecoder('utf-8');
      let sseBuffer = '';
      for await (const bytes of res.body as any as AsyncIterable<Uint8Array>) {
        sseBuffer += decoder.decode(bytes, { stream: true });
        let nl: number;
        while ((nl = sseBuffer.indexOf('\n')) >= 0) {
          const rawLine = sseBuffer.slice(0, nl).replace(/\r$/, '');
          sseBuffer = sseBuffer.slice(nl + 1);
          if (rawLine.length === 0 || rawLine.startsWith(':')) continue; // 空行/心跳注释
          if (!rawLine.startsWith('data:')) continue; // event:/id: 等字段忽略
          const data = rawLine.slice(5).trim();
          if (data === '[DONE]') {
            outcome = 'ok';
            return;
          }
          let text = '';
          try {
            const parsed = JSON.parse(data);
            text = parsed?.choices?.[0]?.delta?.content ?? parsed?.choices?.[0]?.text ?? '';
          } catch {
            continue; // 不完整/非法帧直接跳过，等下一帧
          }
          if (!text) continue;
          if (firstTokenMs === null) {
            firstTokenMs = Date.now() - startedAt;
            clearTimeout(firstTokenTimer);
          }
          yield { text, atMs: Date.now() - startedAt };
        }
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError' || controller.signal.aborted) {
        if (outcome === 'FIRST_TOKEN_TIMEOUT') throw new NosanaStreamError('FIRST_TOKEN_TIMEOUT');
        if (outcome === 'TOTAL_TIMEOUT') throw new NosanaStreamError('TOTAL_TIMEOUT');
        throw new NosanaStreamError('UPSTREAM_ABORTED');
      }
      if (e instanceof NosanaStreamError) throw e;
      outcome = 'NETWORK_ERROR';
      throw new NosanaStreamError('NETWORK_ERROR', (e as Error).message);
    } finally {
      clearTimeout(firstTokenTimer);
      clearTimeout(totalTimer);
      externalSignal.removeEventListener('abort', onExternalAbort);
      // generator 被提前 return（客户端断开）时也会走到这里，确保上游被取消。
      controller.abort();
      NosanaStreamService.lastStream = {
        at: new Date().toISOString(),
        servedModel,
        firstTokenMs,
        totalMs: Date.now() - startedAt,
        outcome,
      };
      this.logger.log(
        `event=nosana_stream_finished model=${servedModel} firstTokenMs=${firstTokenMs ?? -1} totalMs=${Date.now() - startedAt} outcome=${outcome}`,
      );
    }
  }
}
