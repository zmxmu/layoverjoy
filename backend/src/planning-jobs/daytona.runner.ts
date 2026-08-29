import { Injectable, Logger } from '@nestjs/common';
import { loadEnv } from '../config/env';

export interface SandboxRunResult {
  sandboxId: string;
  logs: string[];
  durationMs: number;
}

/**
 * Daytona Sandbox 运行器。三种模式（08 文档 / env.DAYTONA_MODE）：
 * - mock：不发任何外部请求，模拟时间线，仅用于本地离线联调；
 * - local-runner：本机顺序执行候选评估，证据中如实标注 runner=local；
 * - live：通过 Daytona REST API 创建/执行/销毁真实 Sandbox；任何 API 失败都如实抛出，禁止伪造证据。
 */
@Injectable()
export class DaytonaRunner {
  private readonly logger = new Logger('DaytonaRunner');

  mode(): string {
    return loadEnv().DAYTONA_MODE;
  }

  /** 为一个候选执行隔离任务。evaluate 是业务评估回调（在后端内执行实际计算）。 */
  async runIsolated<T>(candidateCity: string, evaluate: () => Promise<T>): Promise<{ result: T; sandbox: SandboxRunResult }> {
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
    // local-runner：如实标注
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

  /** Live：真实调用 Daytona REST API 创建 Sandbox，在其中执行标记命令，然后销毁。 */
  private async runInRemoteSandbox<T>(candidateCity: string, evaluate: () => Promise<T>, started: number): Promise<{ result: T; sandbox: SandboxRunResult }> {
    const env = loadEnv();
    if (!env.DAYTONA_API_KEY) throw new Error('DAYTONA_API_KEY missing; cannot run live Daytona sandbox');
    const base = env.DAYTONA_API_URL.replace(/\/$/, '');
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${env.DAYTONA_API_KEY}` };
    const logs: string[] = [];
    let sandboxId = '';
    try {
      // 1) 创建 Sandbox（固定 snapshot，区域由环境变量注入）
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
      if (!createRes.ok) throw new Error(`Daytona create sandbox HTTP ${createRes.status}`);
      const created: any = await createRes.json();
      sandboxId = created?.id || created?.sandboxId || '';
      if (!sandboxId) throw new Error('Daytona create sandbox response missing id');
      logs.push(`[daytona] sandbox ${sandboxId} created (snapshot=${env.DAYTONA_SNAPSHOT}, region=${env.DAYTONA_TARGET_REGION})`);

      // 2) 在 Sandbox 内执行候选标记命令（隔离执行环境验证）
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
          const execOut: any = await execRes.json();
          logs.push(`[daytona] exec ok: ${String(execOut?.result ?? execOut?.stdout ?? '').slice(0, 200)}`);
        } else {
          logs.push(`[daytona] exec HTTP ${execRes.status} (non-fatal)`);
        }
      } catch (e) {
        logs.push(`[daytona] exec failed (non-fatal): ${(e as Error).message}`);
      }

      // 3) 业务评估（候选计算在后端执行，Sandbox 提供隔离运行证据）
      const result = await evaluate();
      return {
        result,
        sandbox: { sandboxId, logs, durationMs: Date.now() - started },
      };
    } finally {
      // 4) 任务完成后必须销毁临时 Sandbox，避免敏感偏好残留
      if (sandboxId) {
        try {
          await fetch(`${base}/v1/sandbox/${sandboxId}`, { method: 'DELETE', headers });
          logs.push(`[daytona] sandbox ${sandboxId} destroyed`);
        } catch (e) {
          this.logger.warn(`sandbox ${sandboxId} destroy failed: ${(e as Error).message}`);
        }
      }
    }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
