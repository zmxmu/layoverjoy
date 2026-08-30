/**
 * 流式 AI 推荐（Qwen2.5-1.5B）测试：
 * NDJSON 增量装配、逐区块校验、确定性分数覆盖、模板补齐、
 * 以及 SSE 事件序列（含超时/断流/非法输出/缓存命中/客户端取消）。
 *
 * 全程不联网：上游以假 generator 注入，因此可穷举流式边界。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

// 编排层会读取环境配置（流式开关/超时）；单测里只补必填项，不连数据库也不走真实推理。
process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:5432/test';
process.env.JWT_SECRET ??= 'test-jwt-secret-value-not-used-for-signing';
process.env.DATA_ENCRYPTION_KEY ??= '0'.repeat(64);
process.env.INFERENCE_PROVIDER ??= 'nosana';
process.env.NOSANA_STREAMING_ENABLED ??= 'true';

import { buildExperienceContext } from '../src/explanations/experience-context.builder';
import {
  NdjsonAssembler,
  ObjectStreamAssembler,
  SECTION_ORDER,
  assembleInsight,
  buildInsightFacts,
  buildTemplateInsight,
  factsHashOf,
  guidedInsightSchema,
  insightCacheKey,
  readPartialText,
  readSectionName,
  validateSection,
  violatesContentRules,
} from '../src/explanations/insight-sections';
import { AiInsightStreamService, INSIGHT_STAGES, buildInsightSystemPrompt } from '../src/explanations/ai-insight-stream.service';
import { NosanaStreamError, NosanaStreamService } from '../src/explanations/nosana-stream.service';

/** HKG → BKK → ZRH 主线 Demo fixture。 */
function bkkCtx(interests: string[] = ['food', 'oldtown']) {
  return buildExperienceContext({
    cityId: 'th-bangkok',
    cityNameZh: '曼谷',
    cityNameEn: 'Bangkok',
    timeZone: 'Asia/Bangkok',
    leg1: { origin: 'HKG', destination: 'BKK', departureAt: '2026-09-25T02:10:00Z', arrivalAt: '2026-09-25T05:00:00Z' },
    leg2: { origin: 'BKK', destination: 'ZRH', departureAt: '2026-09-28T05:30:00Z', arrivalAt: '2026-09-28T13:00:00Z' },
    riskFlags: ['SEPARATE_TICKETS', 'RECHECK_BAGGAGE'],
    interests,
    airfareDelta: 132,
    currency: 'SGD',
    eligibilityStatus: 'ELIGIBLE',
  });
}

const FULL_NDJSON = [
  '{"section":"cityAdvantages","text":"Bangkok turns this connection into a real city stop with dense street food and temple districts close together."}',
  '{"section":"interestMatch","text":"Your food and old town tags line up with the riverside and market blocks kept in one district."}',
  '{"section":"scheduleFit","text":"An early arrival and a morning departure leave the middle of the trip open for a full district block."}',
  '{"section":"miniItinerary","items":["Arrival day: settle near the river and keep it walkable","Full day: market and temple block in one area"]}',
  '{"section":"convenience","score":42,"reasons":["Same airport both ways","Airport rail link is direct"]}',
  '{"section":"travelerGains","items":["A real city stay instead of an airport wait","Two food districts without cross-town trips"]}',
  '{"section":"travelerAccepts","items":["Separate tickets mean re-checking bags","A wider airport buffer on departure day"]}',
].join('\n');

describe('NdjsonAssembler（按换行缓冲 + 已确定前缀增量）', () => {
  it('逐字符喂入也能得到完整的 7 行与顺序不乱的 section', () => {
    const a = new NdjsonAssembler();
    const lines: unknown[] = [];
    const starts: string[] = [];
    for (const ch of FULL_NDJSON + '\n') {
      for (const p of a.feed(ch)) {
        if (p.kind === 'line') lines.push(p.raw);
        if (p.kind === 'section_start') starts.push(p.section);
      }
    }
    expect(lines).toHaveLength(7);
    expect(starts).toEqual([...SECTION_ORDER]);
  });

  it('delta 只输出反转义后的正文，不泄漏协议碎片', () => {
    const a = new NdjsonAssembler();
    const deltas: string[] = [];
    for (const ch of '{"section":"cityAdvantages","text":"Bangkok is close"}\n') {
      for (const p of a.feed(ch)) if (p.kind === 'delta') deltas.push(p.text);
    }
    const joined = deltas.join('');
    expect(joined).toBe('Bangkok is close');
    expect(joined).not.toContain('"section"');
    expect(joined).not.toContain('{');
  });

  it('delta 拼接结果与最终解析出的 text 一致（不重复、不乱序）', () => {
    const a = new NdjsonAssembler();
    const perSection = new Map<string, string>();
    let final: any = null;
    for (const ch of '{"section":"scheduleFit","text":"Morning arrival, evening departure."}\n') {
      for (const p of a.feed(ch)) {
        if (p.kind === 'delta') perSection.set(p.section, (perSection.get(p.section) ?? '') + p.text);
        if (p.kind === 'line') final = p.raw;
      }
    }
    expect(perSection.get('scheduleFit')).toBe(final.text);
  });

  it('跨 chunk 的转义序列不会产生半截字符', () => {
    const a = new NdjsonAssembler('zh');
    const deltas: string[] = [];
    // \u4e2d 被拆散在两个 chunk 里
    for (const chunk of ['{"section":"interestMatch","text":"靠近\\u4e', '2d心区"}\n']) {
      for (const p of a.feed(chunk)) if (p.kind === 'delta') deltas.push(p.text);
    }
    expect(deltas.join('')).toBe('靠近中心区');
    // 半截的 \u4e 绝不能以原文形式泄露
    expect(deltas.join('')).not.toContain('\\u');
  });

  it('增量命中金额/技术红线时不得外发（降级前不能一闪而过）', () => {
    const money = new NdjsonAssembler('en');
    const moneyDeltas = money.feed('{"section":"cityAdvantages","text":"cost is 120 USD cheaper"}\n').filter((p) => p.kind === 'delta');
    expect(moneyDeltas).toHaveLength(0);

    const tech = new NdjsonAssembler('en');
    const techDeltas = tech.feed('{"section":"scheduleFit","text":"generated by Qwen on a Nosana GPU"}\n').filter((p) => p.kind === 'delta');
    expect(techDeltas).toHaveLength(0);

    // 干净前缀已推送后才出现违规词：后续增量停止，不会把金额推出去
    const late = new NdjsonAssembler('en');
    const seen: string[] = [];
    for (const chunk of ['{"section":"cityAdvantages","text":"A dense city stop worth leaving the airport for', ', about 120 SGD cheaper"}\n']) {
      for (const p of late.feed(chunk)) if (p.kind === 'delta') seen.push(p.text);
    }
    expect(seen.join('')).toBe('A dense city stop worth leaving the airport for');
    expect(seen.join('')).not.toMatch(/SGD|120/);
  });

  it('列表型区块只在条目闭合后才推增量', () => {
    const a = new NdjsonAssembler();
    const seen: string[] = [];
    for (const p of a.feed('{"section":"miniItinerary","items":["first item her')) {
      if (p.kind === 'delta') seen.push(p.text);
    }
    expect(seen.join('')).toBe(''); // 还没闭合 → 不显示
    for (const p of a.feed('e","second item"]}\n')) if (p.kind === 'delta') seen.push(p.text);
    expect(seen.join('')).toBe('first item here · second item');
  });

  it('```json 代码块包裹与末行缺换行都能收尾', () => {
    const a = new NdjsonAssembler();
    const lines: unknown[] = [];
    for (const p of a.feed('```json\n{"section":"travelerGains","items":["a real city stay"]}')) {
      if (p.kind === 'line') lines.push(p.raw);
    }
    for (const p of a.finish()) if (p.kind === 'line') lines.push(p.raw);
    expect(lines).toHaveLength(1);
  });

  it('非法 JSON 行在流结束时报 malformed 而不是抛异常', () => {
    const a = new NdjsonAssembler();
    // 未闭合的一行先挂起来等续行（模型可能在对象中间换行）
    expect(a.feed('{"section":"cityAdvantages","text":"oops\n').map((p) => p.kind)).not.toContain('malformed');
    expect(a.finish().map((p) => p.kind)).toContain('malformed');
  });
});

// ---------------- guided 单对象流式（当前默认路径） ----------------

const GUIDED_OBJECT = JSON.stringify({
  cityAdvantages: 'Bangkok turns this connection into a real city stop with food streets and temples close together.',
  interestMatch: 'Your food and old town tags line up with the riverside blocks kept in one district.',
  scheduleFit: 'An early arrival and a morning departure leave the middle of the trip open.',
  miniItinerary: ['Arrival day: settle near the river', 'Full day: market and temple block'],
  convenienceReasons: ['Same airport both ways', 'Airport rail link is direct'],
  travelerGains: ['A real city stay instead of an airport wait', 'Two food districts without cross-town trips'],
  travelerAccepts: ['Separate tickets mean re-checking bags'],
});

describe('ObjectStreamAssembler（guided 单对象逐 key 渐进）', () => {
  it('逐字符喂入也能得到 7 个区块，且顺序与输出一致', () => {
    const a = new ObjectStreamAssembler('en');
    const starts: string[] = [];
    const records: any[] = [];
    for (const ch of GUIDED_OBJECT) {
      for (const p of a.feed(ch)) {
        if (p.kind === 'section_start') starts.push(p.section);
        if (p.kind === 'line') records.push(p.raw);
      }
    }
    expect(starts).toEqual([...SECTION_ORDER]);
    expect(records).toHaveLength(7);
    expect(a.finish()).toHaveLength(0);
  });

  it('delta 拼接结果等于最终值，不重复不乱序', () => {
    const a = new ObjectStreamAssembler('en');
    const acc = new Map<string, string>();
    let firstRecord: any = null;
    for (const ch of GUIDED_OBJECT) {
      for (const p of a.feed(ch)) {
        if (p.kind === 'delta') acc.set(p.section, (acc.get(p.section) ?? '') + p.text);
        if (p.kind === 'line' && !firstRecord) firstRecord = p.raw;
      }
    }
    expect(acc.get('cityAdvantages')).toBe(firstRecord.text);
    // 列表区块的增量是已闭合条目的拼接
    expect(acc.get('miniItinerary')).toBe('Arrival day: settle near the river · Full day: market and temple block');
  });

  it('未写完的数组条目不推增量', () => {
    const a = new ObjectStreamAssembler('en');
    const deltas: string[] = [];
    for (const p of a.feed('{"miniItinerary":["Arrival day: settle near the riv')) {
      if (p.kind === 'delta') deltas.push(p.text);
    }
    expect(deltas.join('')).toBe('');
  });

  it('截断在中途时，未闭合的区块报 malformed（交由模板补齐）', () => {
    const a = new ObjectStreamAssembler('en');
    a.feed('{"cityAdvantages":"A dense city stop worth leaving the airport');
    const tail = a.finish();
    expect(tail.some((p) => p.kind === 'malformed')).toBe(true);
  });

  it('guided 记录经同一套校验：convenience 分数仍由确定性引擎给出', () => {
    const ctx = bkkCtx();
    const a = new ObjectStreamAssembler('en');
    const accepted = new Map<any, any>();
    for (const p of a.feed(GUIDED_OBJECT)) {
      if (p.kind === 'line') {
        const v = validateSection(p.raw, ctx, 'en');
        if (v.ok) accepted.set(v.payload.section, v.payload);
      }
    }
    expect(accepted.size).toBe(7);
    const conv = accepted.get('convenience');
    expect(conv.score).toBe(ctx.ease.score);
    expect(assembleInsight(accepted, ctx, 'en').source).toBe('NOSANA');
  });

  it('增量命中红线时同样不外发', () => {
    const a = new ObjectStreamAssembler('en');
    const deltas = a
      .feed('{"cityAdvantages":"this stop saves about 120 SGD versus a direct flight"')
      .filter((p) => p.kind === 'delta');
    expect(deltas).toHaveLength(0);
  });

  it('guided schema 不包含长度约束（会拖垮结构化解码速度）', () => {
    const schema = JSON.stringify(guidedInsightSchema());
    expect(schema).not.toContain('minLength');
    expect(schema).not.toContain('maxLength');
    expect(guidedInsightSchema().required).toEqual([
      'cityAdvantages',
      'interestMatch',
      'scheduleFit',
      'miniItinerary',
      'convenienceReasons',
      'travelerGains',
      'travelerAccepts',
    ]);
  });
});

describe('validateSection（内容红线 + 确定性分数）', () => {
  const ctx = bkkCtx();

  it('接受合法文本区块', () => {
    const v = validateSection(JSON.parse(FULL_NDJSON.split('\n')[0]), ctx, 'en');
    expect(v.ok).toBe(true);
  });

  it('convenience 的分数一律用确定性 StopoverEaseScore 覆盖模型自评', () => {
    const v = validateSection({ section: 'convenience', score: 99, reasons: ['Same airport both ways'] }, ctx, 'en');
    expect(v.ok).toBe(true);
    if (v.ok && v.payload.section === 'convenience') {
      expect(v.payload.score).toBe(ctx.ease.score);
      expect(v.payload.score).not.toBe(99);
    }
  });

  it.each([
    ['money', { section: 'cityAdvantages', text: 'Bangkok saves you about 120 SGD versus a direct flight today.' }],
    ['tech', { section: 'cityAdvantages', text: 'Generated by Qwen on a Nosana GPU deployment for this itinerary.' }],
    ['visa_guarantee', { section: 'scheduleFit', text: 'You are guaranteed entry with a Chinese passport on arrival.' }],
    ['chain_of_thought', { section: 'scheduleFit', text: '<think>first I should compare the arrival period here</think>' }],
    ['repeat_fact', { section: 'scheduleFit', text: 'This stay 3 days window gives a comfortable pace overall.' }],
  ])('拒绝违规区块：%s', (reason, raw) => {
    const v = validateSection(raw, ctx, 'en');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe(reason);
  });

  it('拒绝反向陈述风险的内容（存在两张机票/重新托运时）', () => {
    // 1.5B 实测会把 SEPARATE_TICKETS 写成“No need for additional ticket purchases”
    for (const bad of [
      { section: 'travelerAccepts', items: ['No need for additional ticket purchases', 'No baggage recheck required'] },
      { section: 'scheduleFit', text: '无需重新托运行李，联程无忧。' },
    ]) {
      const v = validateSection(bad, ctx, bad.section === 'scheduleFit' ? 'zh' : 'en');
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.reason).toBe('negates_risk');
    }
  });

  it('无风险时不误伤正常的否定句', () => {
    const noRisk = buildExperienceContext({
      cityId: 'th-bangkok',
      cityNameZh: '曼谷',
      cityNameEn: 'Bangkok',
      timeZone: 'Asia/Bangkok',
      leg1: { origin: 'HKG', destination: 'BKK', departureAt: '2026-09-25T02:10:00Z', arrivalAt: '2026-09-25T05:00:00Z' },
      leg2: { origin: 'BKK', destination: 'ZRH', departureAt: '2026-09-28T05:30:00Z', arrivalAt: '2026-09-28T13:00:00Z' },
      riskFlags: [],
      interests: ['food'],
      airfareDelta: 0,
      currency: 'SGD',
      eligibilityStatus: 'ELIGIBLE',
    });
    const v = validateSection({ section: 'travelerAccepts', items: ['No baggage recheck is needed on this routing'] }, noRisk, 'en');
    expect(v.ok).toBe(true);
  });

  it('拒绝未知 section、空列表与过短文本', () => {
    expect(validateSection({ section: 'weather', text: 'sunny all week long here' }, ctx, 'en').ok).toBe(false);
    expect(validateSection({ section: 'miniItinerary', items: [] }, ctx, 'en').ok).toBe(false);
    expect(validateSection({ section: 'cityAdvantages', text: 'short' }, ctx, 'en').ok).toBe(false);
    expect(validateSection(null, ctx, 'en').ok).toBe(false);
    expect(validateSection('{"section":"cityAdvantages"}', ctx, 'en').ok).toBe(false);
  });

  it('语言不匹配被拒绝（en 请求出现中文）', () => {
    const v = validateSection({ section: 'cityAdvantages', text: '曼谷把这次中转变成一段真正的城市停留。' }, ctx, 'en');
    expect(v.ok).toBe(false);
  });

  it('violatesContentRules 对干净文本返回 null', () => {
    expect(violatesContentRules('Bangkok keeps the walk short between districts.', 'en')).toBeNull();
  });
});

describe('模板降级与结构补齐（任务要求 14/15）', () => {
  const ctx = bkkCtx();

  it('模板结果包含全部 8 个字段且分数来自确定性引擎', () => {
    const t = buildTemplateInsight(ctx, 'en');
    expect(t.cityAdvantages.length).toBeGreaterThan(8);
    expect(t.interestMatch.length).toBeGreaterThan(8);
    expect(t.scheduleFit.length).toBeGreaterThan(8);
    expect(t.miniItinerary.length).toBeGreaterThan(0);
    expect(t.convenienceScore).toBe(ctx.ease.score);
    expect(t.convenienceReasons.length).toBeGreaterThan(0);
    expect(t.travelerGains.length).toBeGreaterThan(0);
    expect(t.travelerAccepts.length).toBeGreaterThan(0);
    expect(t.source).toBe('TEMPLATE');
  });

  it('travelerAccepts 一律用确定性模板，不采用模型版本（风险披露不交给模型）', () => {
    const accepted = new Map<any, any>([
      ['travelerAccepts', { section: 'travelerAccepts', items: ['A model written cost line'] }],
    ]);
    const merged = assembleInsight(accepted, ctx, 'en');
    expect(merged.travelerAccepts).not.toContain('A model written cost line');
    expect(merged.travelerAccepts).toEqual(buildTemplateInsight(ctx, 'en').travelerAccepts);
  });

  it('只收到部分区块时其余用模板补齐，标记 HYBRID', () => {
    const accepted = new Map<any, any>([['cityAdvantages', { section: 'cityAdvantages', text: 'A dense city stop worth leaving the airport for.' }]]);
    const merged = assembleInsight(accepted, ctx, 'en');
    expect(merged.source).toBe('HYBRID');
    expect(merged.cityAdvantages).toContain('dense city stop');
    expect(merged.travelerAccepts.length).toBeGreaterThan(0);
  });

  it('6 个模型区块全部到齐时标记 NOSANA（travelerAccepts 不计入）', () => {
    const accepted = new Map<any, any>();
    for (const line of FULL_NDJSON.split('\n')) {
      const v = validateSection(JSON.parse(line), ctx, 'en');
      if (v.ok) accepted.set(v.payload.section, v.payload);
    }
    // travelerAccepts 在本 fixture 里会因 negates_risk 之外的原因被接受，但不影响结果取模板
    expect(accepted.size).toBeGreaterThanOrEqual(6)
    expect(assembleInsight(accepted, ctx, 'en').source).toBe('NOSANA');
  });
});

describe('PII 与缓存键（任务要求 17/21）', () => {
  const ctx = bkkCtx();

  it('发给模型的事实里没有任何 PII 字段', () => {
    const facts = JSON.stringify(buildInsightFacts(ctx));
    for (const forbidden of ['passport', 'passportNo', 'email', '@', 'birth', 'dateOfBirth', 'jwt', 'Bearer', 'token', 'secret', 'firstName', 'lastName']) {
      expect(facts.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('事实里也不含金额与分钟数（金额由确定性 UI 展示）', () => {
    const facts = JSON.stringify(buildInsightFacts(ctx));
    expect(facts).not.toContain('airfare');
    expect(facts).not.toContain('grossStopoverMinutes');
    expect(facts).not.toContain('usableExperienceMinutes');
  });

  it('缓存键 = planId + language + promptVersion + factsHash，且事实变化即失效', () => {
    const h1 = factsHashOf(ctx);
    const h2 = factsHashOf(bkkCtx(['nightlife']));
    expect(h1).not.toBe(h2);
    expect(insightCacheKey('plan_1', 'en', 'v2', h1)).toBe(`ai_insight_v2:plan_1:en:v2:${h1}`);
    expect(insightCacheKey('plan_1', 'zh', 'v2', h1)).not.toBe(insightCacheKey('plan_1', 'en', 'v2', h1));
  });

  it('system prompt 明确禁止思维链、金额与重新裁决签证', () => {
    const en = buildInsightSystemPrompt('en');
    expect(en).toContain('NDJSON');
    expect(en).toContain('never re-judge policy');
    expect(en).toContain('never output reasoning steps');
    expect(buildInsightSystemPrompt('zh')).toContain('不得输出思考过程');
  });
});

// ---------------- SSE 事件序列 ----------------

class FakeRedis {
  store = new Map<string, string>();
  async get(k: string) {
    return this.store.get(k) ?? null;
  }
  async set(k: string, v: string) {
    this.store.set(k, v);
  }
}

/** 上游替身：按给定 chunk 序列产出，或在指定位置抛错。 */
function fakeUpstream(chunks: string[], failWith?: NosanaStreamError) {
  return {
    streamChat: async function* (_m: unknown, signal: AbortSignal) {
      for (const c of chunks) {
        if (signal.aborted) throw new NosanaStreamError('UPSTREAM_ABORTED');
        yield { text: c, atMs: 10 };
      }
      if (failWith) throw failWith;
    },
  } as any;
}

async function collect(gen: AsyncGenerator<any>) {
  const out: any[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe('AiInsightStreamService 事件序列', () => {
  const ctx = bkkCtx();

  // 默认路径是 guided（单对象）；每个用例前显式复位，避免用例间互相污染。
  beforeEach(() => {
    NosanaStreamService.guidedSupported = true;
  });

  it('正常流（guided）：status → section_start/delta/section_complete → done(NOSANA)', async () => {
    const redis = new FakeRedis();
    const svc = new AiInsightStreamService(fakeUpstream([GUIDED_OBJECT]), redis as any);
    const events = await collect(svc.stream('plan_ok', ctx, 'en', new AbortController().signal));

    expect(events[0]).toEqual({ event: 'status', data: { stage: 'CHECKING_VISA', message: INSIGHT_STAGES.CHECKING_VISA } });
    const stages = events.filter((e) => e.event === 'status').map((e) => e.data.stage);
    expect(stages).toEqual(['CHECKING_VISA', 'COMPARING_COST', 'BUILDING_PLAN', 'FINALIZING']);

    const completed = events.filter((e) => e.event === 'section_complete').map((e) => e.data.section);
    expect(completed).toEqual([...SECTION_ORDER]);

    const done = events.at(-1);
    expect(done.event).toBe('done');
    expect(done.data.source).toBe('NOSANA');
    expect(done.data.schemaVersion).toBe('rich-insight-v2');
    expect(done.data.insight.convenienceScore).toBe(ctx.ease.score);
    // 每个 section 只完成一次，UI 不会重复渲染
    expect(new Set(completed).size).toBe(completed.length);
  });

  it('guided 不可用时自动回退 NDJSON，事件序列完全一致', async () => {
    NosanaStreamService.guidedSupported = false;
    const svc = new AiInsightStreamService(fakeUpstream([FULL_NDJSON + '\n']), new FakeRedis() as any);
    const events = await collect(svc.stream('plan_ndjson', ctx, 'en', new AbortController().signal));
    expect(events.filter((e) => e.event === 'section_complete').map((e) => e.data.section)).toEqual([...SECTION_ORDER]);
    expect(events.at(-1).data.source).toBe('NOSANA');
  });

  it('首 token 超时：无正文时整体走模板，仍以 done 收尾（不给错误终态）', async () => {
    const svc = new AiInsightStreamService(fakeUpstream([], new NosanaStreamError('FIRST_TOKEN_TIMEOUT')), new FakeRedis() as any);
    const events = await collect(svc.stream('plan_timeout', ctx, 'en', new AbortController().signal));
    const done = events.at(-1);
    expect(done.event).toBe('done');
    expect(done.data.source).toBe('TEMPLATE');
    expect(events.filter((e) => e.event === 'section_complete')).toHaveLength(7);
  });

  it('中途断流：已收到的区块保留，其余模板补齐（HYBRID），不留半截句子', async () => {
    // guided 对象写到 miniItinerary 第一条中间就断了
    const cut = GUIDED_OBJECT.slice(0, GUIDED_OBJECT.indexOf('"miniItinerary"') + 40);
    const svc = new AiInsightStreamService(fakeUpstream([cut], new NosanaStreamError('NETWORK_ERROR')), new FakeRedis() as any);
    const events = await collect(svc.stream('plan_cut', ctx, 'en', new AbortController().signal));
    const done = events.at(-1);
    expect(done.event).toBe('done');
    expect(done.data.source).toBe('HYBRID');
    expect(done.data.insight.miniItinerary.length).toBeGreaterThan(0);
    // 半截的那条绝不能进最终结果
    expect(done.data.insight.miniItinerary.join(' ')).not.toContain('Arrival day: settle near the riv');
    expect(events.filter((e) => e.event === 'section_complete')).toHaveLength(7);
  });

  it('非法输出（NDJSON 回退路径）：全部行被拒 → 模板结果，且不把损坏 JSON 发给客户端', async () => {
    NosanaStreamService.guidedSupported = false;
    const junk = 'not json at all\n{"section":\n{"section":"cityAdvantages","text":"cost is 120 USD cheaper"}\n';
    const svc = new AiInsightStreamService(fakeUpstream([junk]), new FakeRedis() as any);
    const events = await collect(svc.stream('plan_junk', ctx, 'en', new AbortController().signal));
    expect(events.at(-1).data.source).toBe('TEMPLATE');
    const payloads = JSON.stringify(events);
    expect(payloads).not.toContain('not json at all');
    expect(payloads).not.toContain('120 USD');
  });

  it('缓存命中：第二次不再调用上游，done.cached=true', async () => {
    const redis = new FakeRedis();
    const upstream = fakeUpstream([GUIDED_OBJECT]);
    const spy = vi.spyOn(upstream, 'streamChat');
    const svc = new AiInsightStreamService(upstream, redis as any);

    await collect(svc.stream('plan_cache', ctx, 'en', new AbortController().signal));
    expect(spy).toHaveBeenCalledTimes(1);

    const second = await collect(svc.stream('plan_cache', ctx, 'en', new AbortController().signal));
    expect(spy).toHaveBeenCalledTimes(1); // 没有第二次推理
    expect(second.at(-1).data.cached).toBe(true);
    expect(second.filter((e) => e.event === 'section_complete')).toHaveLength(7);
  });

  it('语言不同视为不同缓存条目', async () => {
    const redis = new FakeRedis();
    const upstream = fakeUpstream([GUIDED_OBJECT]);
    const spy = vi.spyOn(upstream, 'streamChat');
    const svc = new AiInsightStreamService(upstream, redis as any);
    await collect(svc.stream('plan_lang', ctx, 'en', new AbortController().signal));
    await collect(svc.stream('plan_lang', ctx, 'zh', new AbortController().signal));
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('客户端取消：不再补模板、不写缓存，直接结束', async () => {
    const redis = new FakeRedis();
    const controller = new AbortController();
    const svc = new AiInsightStreamService(
      {
        streamChat: async function* () {
          controller.abort(); // 模拟页面退出
          throw new NosanaStreamError('UPSTREAM_ABORTED');
        },
      } as any,
      redis as any,
    );
    const events = await collect(svc.stream('plan_abort', ctx, 'en', controller.signal));
    expect(events.every((e) => e.event !== 'done')).toBe(true);
    expect(redis.store.size).toBe(0);
  });

  it('HKG→BKK→ZRH 主线：净体验窗口只出现一次，且不含金额/技术信息', async () => {
    const svc = new AiInsightStreamService(fakeUpstream([GUIDED_OBJECT]), new FakeRedis() as any);
    const events = await collect(svc.stream('plan_demo', ctx, 'en', new AbortController().signal));
    const insight = events.at(-1).data.insight;
    const all = [insight.cityAdvantages, insight.interestMatch, insight.scheduleFit, ...insight.miniItinerary, ...insight.convenienceReasons, ...insight.travelerGains, ...insight.travelerAccepts].join('\n');
    expect(all).not.toMatch(/SGD|USD|\$/);
    expect(all).not.toMatch(/nosana|qwen|gpu|deployment/i);
    // 停留天数/可用小时/JoyScore 只在确定性 UI 出现，AI 文案里不得复述
    expect(all).not.toMatch(/JoyScore|usable hours|stay \d+ days?/i);
  });
});
