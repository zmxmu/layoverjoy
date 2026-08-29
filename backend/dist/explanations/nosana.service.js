"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NosanaService = void 0;
const common_1 = require("@nestjs/common");
const env_1 = require("../config/env");
let NosanaService = class NosanaService {
    logger = new common_1.Logger('NosanaService');
    templateExplanation(req) {
        const days = req.usableHours / 24;
        const deltaText = req.airfareDelta > 0
            ? `相比直飞多花约 ${req.airfareDelta} ${req.currency}`
            : req.airfareDelta < 0
                ? `相比直飞节省约 ${Math.abs(req.airfareDelta)} ${req.currency}`
                : '与直飞价格相当';
        return {
            provider: 'TEMPLATE',
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
    async explain(req) {
        const env = (0, env_1.loadEnv)();
        if (env.INFERENCE_PROVIDER !== 'nosana' || !env.NOSANA_API_KEY || !env.NOSANA_OPENAI_BASE_URL) {
            return this.templateExplanation(req);
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), env.NOSANA_TIMEOUT_MS);
        try {
            const systemPrompt = [
                '你是 LayoverJoy 的旅行体验解说员。只解释已给出的结构化方案，不生成新的航班、价格、签证结论或订单状态。',
                '输出必须是合法 JSON：{"summary": string, "highlights": string[], "tips": string[]}',
                '语言：简体中文；summary 不超过 80 字；highlights 2-3 条；tips 1-3 条。',
            ].join('\n');
            const userPrompt = JSON.stringify({
                city: req.cityNameZh,
                stayDays: req.stayDays,
                usableHours: req.usableHours,
                airfareDelta: req.airfareDelta,
                currency: req.currency,
                joyScore: req.joyScore,
                joyScoreBreakdown: req.joyScoreBreakdown,
                riskFlags: req.riskFlags,
                interests: req.interests,
            });
            const res = await fetch(`${env.NOSANA_OPENAI_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${env.NOSANA_API_KEY}`,
                },
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
                this.logger.warn(`Nosana HTTP ${res.status}; falling back to template explanation`);
                return this.templateExplanation(req);
            }
            const data = await res.json();
            const content = data?.choices?.[0]?.message?.content ?? '';
            const parsed = JSON.parse(content);
            if (typeof parsed.summary !== 'string' || !parsed.summary)
                throw new Error('invalid explanation payload');
            return {
                provider: 'NOSANA',
                modelId: data?.model || env.NOSANA_MODEL,
                summary: parsed.summary,
                highlights: Array.isArray(parsed.highlights) ? parsed.highlights.slice(0, 4) : [],
                tips: Array.isArray(parsed.tips) ? parsed.tips.slice(0, 4) : [],
            };
        }
        catch (e) {
            this.logger.warn(`Nosana call failed (${e.message}); falling back to template explanation`);
            return this.templateExplanation(req);
        }
        finally {
            clearTimeout(timer);
        }
    }
};
exports.NosanaService = NosanaService;
exports.NosanaService = NosanaService = __decorate([
    (0, common_1.Injectable)()
], NosanaService);
