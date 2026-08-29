"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DaytonaRunner = void 0;
const common_1 = require("@nestjs/common");
const env_1 = require("../config/env");
let DaytonaRunner = class DaytonaRunner {
    logger = new common_1.Logger('DaytonaRunner');
    mode() {
        return (0, env_1.loadEnv)().DAYTONA_MODE;
    }
    async runIsolated(candidateCity, evaluate) {
        const mode = this.mode();
        const started = Date.now();
        if (mode === 'mock') {
            await sleep(300 + Math.random() * 500);
            const result = await evaluate();
            return {
                result,
                sandbox: {
                    sandboxId: `mock-sbx-${candidateCity.toLowerCase()}-${Date.now().toString(36)}`,
                    logs: [`[mock] sandbox created for ${candidateCity}`, '[mock] candidate evaluation executed', '[mock] sandbox destroyed'],
                    durationMs: Date.now() - started,
                },
            };
        }
        if (mode === 'live') {
            return this.runInRemoteSandbox(candidateCity, evaluate, started);
        }
        const result = await evaluate();
        return {
            result,
            sandbox: {
                sandboxId: `local-runner-${candidateCity.toLowerCase()}`,
                logs: [`[local-runner] candidate ${candidateCity} evaluated in-process`, '[local-runner] no remote sandbox created'],
                durationMs: Date.now() - started,
            },
        };
    }
    async runInRemoteSandbox(candidateCity, evaluate, started) {
        const env = (0, env_1.loadEnv)();
        if (!env.DAYTONA_API_KEY)
            throw new Error('DAYTONA_API_KEY missing; cannot run live Daytona sandbox');
        const base = env.DAYTONA_API_URL.replace(/\/$/, '');
        const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${env.DAYTONA_API_KEY}` };
        const logs = [];
        let sandboxId = '';
        try {
            const createRes = await fetch(`${base}/v1/sandbox`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    snapshot: env.DAYTONA_SNAPSHOT,
                    autoStart: true,
                    target: env.DAYTONA_TARGET_REGION,
                    labels: { project: 'layoverjoy', candidate: candidateCity },
                }),
            });
            if (!createRes.ok)
                throw new Error(`Daytona create sandbox HTTP ${createRes.status}`);
            const created = await createRes.json();
            sandboxId = created?.id || created?.sandboxId || '';
            if (!sandboxId)
                throw new Error('Daytona create sandbox response missing id');
            logs.push(`[daytona] sandbox ${sandboxId} created (snapshot=${env.DAYTONA_SNAPSHOT}, region=${env.DAYTONA_TARGET_REGION})`);
            try {
                const execRes = await fetch(`${base}/v1/sandbox/${sandboxId}/process/execute`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        command: `echo "layoverjoy-candidate ${candidateCity} started at $(date -u +%FT%TZ)" > /tmp/candidate.log && cat /tmp/candidate.log`,
                        timeout: 30,
                    }),
                });
                if (execRes.ok) {
                    const execOut = await execRes.json();
                    logs.push(`[daytona] exec ok: ${String(execOut?.result ?? execOut?.stdout ?? '').slice(0, 200)}`);
                }
                else {
                    logs.push(`[daytona] exec HTTP ${execRes.status} (non-fatal)`);
                }
            }
            catch (e) {
                logs.push(`[daytona] exec failed (non-fatal): ${e.message}`);
            }
            const result = await evaluate();
            return {
                result,
                sandbox: { sandboxId, logs, durationMs: Date.now() - started },
            };
        }
        finally {
            if (sandboxId) {
                try {
                    await fetch(`${base}/v1/sandbox/${sandboxId}`, { method: 'DELETE', headers });
                    logs.push(`[daytona] sandbox ${sandboxId} destroyed`);
                }
                catch (e) {
                    this.logger.warn(`sandbox ${sandboxId} destroy failed: ${e.message}`);
                }
            }
        }
    }
};
exports.DaytonaRunner = DaytonaRunner;
exports.DaytonaRunner = DaytonaRunner = __decorate([
    (0, common_1.Injectable)()
], DaytonaRunner);
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
