import { Injectable, Logger } from '@nestjs/common';
import { Daytona } from '@daytona/sdk';
import { isMaskedSecret, loadEnv } from '../config/env';

const EVALUATOR_VERSION = 'layoverjoy-candidate-evaluator-v1';

export interface SanitizedFlightLeg {
  providerOfferId: string;
  totalPrice: number;
  currency: string;
  departureAt: string;
  arrivalAt: string;
}

/** Only de-identified, already-fetched business data may enter a candidate Sandbox. */
export interface CandidateSandboxInput {
  candidateCity: string;
  eligibility: string;
  ruleIds: string[];
  leg1: SanitizedFlightLeg | null;
  leg2: SanitizedFlightLeg | null;
  riskFlags: string[];
}

export interface CandidateEvaluationResult {
  candidateCity: string;
  eligibility: string;
  ruleIds: string[];
  flightOfferIds: string[];
  totalCost: number | null;
  currency: string | null;
  usableHours: number | null;
  riskFlags: string[];
  evidenceTimestamp: string;
  evaluatorVersion: string;
}

export interface SandboxRunResult {
  sandboxId: string;
  logs: string[];
  durationMs: number;
  executionMode: 'mock' | 'local-runner' | 'daytona';
  cleanupStatus: 'not-applicable' | 'not-created' | 'deleted' | 'delete-failed';
  networkPolicy: 'not-applicable' | 'daytona-tier-policy+block-all';
  evaluatorVersion: string;
}

export class SandboxExecutionError extends Error {
  constructor(message: string, readonly sandbox: SandboxRunResult) {
    super(message);
    this.name = 'SandboxExecutionError';
  }
}

/**
 * Daytona candidate runner:
 * - mock/local-runner execute the same deterministic evaluator in-process;
 * - live creates an ephemeral Daytona Sandbox and executes the evaluator there;
 * - external APIs are deliberately called by the trusted backend before this step.
 */
@Injectable()
export class DaytonaRunner {
  private readonly logger = new Logger('DaytonaRunner');

  mode(): string {
    return loadEnv().DAYTONA_MODE;
  }

  async runIsolated(
    candidateCity: string,
    input: CandidateSandboxInput,
  ): Promise<{ result: CandidateEvaluationResult; sandbox: SandboxRunResult }> {
    assertDeidentified(input);
    const mode = this.mode();
    const started = Date.now();

    if (mode === 'mock') {
      await sleep(250 + Math.random() * 250);
      return {
        result: evaluateCandidate(input),
        sandbox: {
          sandboxId: `mock-sbx-${slug(candidateCity)}-${Date.now().toString(36)}`,
          logs: ['[mock] no remote sandbox created', `[mock] ${EVALUATOR_VERSION} executed in-process`],
          durationMs: Date.now() - started,
          executionMode: 'mock',
          cleanupStatus: 'not-applicable',
          networkPolicy: 'not-applicable',
          evaluatorVersion: EVALUATOR_VERSION,
        },
      };
    }

    if (mode === 'live') {
      return this.runInRemoteSandbox(candidateCity, input, started);
    }

    return {
      result: evaluateCandidate(input),
      sandbox: {
        sandboxId: `local-runner-${slug(candidateCity)}`,
        logs: ['[local-runner] no remote sandbox created', `[local-runner] ${EVALUATOR_VERSION} executed in-process`],
        durationMs: Date.now() - started,
        executionMode: 'local-runner',
        cleanupStatus: 'not-applicable',
        networkPolicy: 'not-applicable',
        evaluatorVersion: EVALUATOR_VERSION,
      },
    };
  }

  private async runInRemoteSandbox(
    candidateCity: string,
    input: CandidateSandboxInput,
    started: number,
  ): Promise<{ result: CandidateEvaluationResult; sandbox: SandboxRunResult }> {
    const env = loadEnv();
    if (isMaskedSecret(env.DAYTONA_API_KEY)) {
      throw new Error('DAYTONA_API_KEY missing or masked; cannot run live Daytona sandbox');
    }

    const daytona = new Daytona({
      apiKey: env.DAYTONA_API_KEY,
      apiUrl: env.DAYTONA_API_URL,
      target: env.DAYTONA_TARGET_REGION,
    });
    const logs: string[] = [];
    let sandbox: any = null;
    let result: CandidateEvaluationResult | null = null;
    let runError: Error | null = null;
    let cleanupStatus: SandboxRunResult['cleanupStatus'] = 'not-created';

    try {
      const createParams: Record<string, unknown> = {
        name: `layoverjoy-${slug(candidateCity)}-${Date.now().toString(36)}`.slice(0, 63),
        language: 'typescript',
        labels: { project: 'layoverjoy', workload: 'candidate-evaluation', candidate: slug(candidateCity) },
        ephemeral: true,
        autoStopInterval: 5,
        ttlMinutes: env.DAYTONA_SANDBOX_TTL_MINUTES,
        networkBlockAll: true,
      };
      if (env.DAYTONA_SNAPSHOT) createParams.snapshot = env.DAYTONA_SNAPSHOT;

      sandbox = await daytona.create(createParams as any, { timeout: env.DAYTONA_CREATE_TIMEOUT_SECONDS });
      logs.push(`[daytona] sandbox ${sandbox.id} created`);
      logs.push('[daytona] input contains route/price/rule IDs only; no PII or provider secrets');
      logs.push('[daytona] network policy: organization tier restrictions + networkBlockAll');

      const evaluatorScript = [
        `const evaluateCandidate = ${evaluateCandidate.toString()};`,
        'const input = JSON.parse(process.env.LAYOVERJOY_CANDIDATE_INPUT);',
        'process.stdout.write(JSON.stringify(evaluateCandidate(input)));',
      ].join('\n');
      const execution = await sandbox.process.executeCommand(
        'node -e "$LAYOVERJOY_EVALUATOR_JS"',
        undefined,
        {
          LAYOVERJOY_EVALUATOR_JS: evaluatorScript,
          LAYOVERJOY_CANDIDATE_INPUT: JSON.stringify(input),
        },
        env.DAYTONA_EXEC_TIMEOUT_SECONDS,
      );
      if (execution.exitCode !== 0) {
        throw new Error(`Daytona evaluator exited with code ${execution.exitCode}`);
      }
      result = parseEvaluationResult(execution.result);
      logs.push(`[daytona] ${EVALUATOR_VERSION} completed inside sandbox`);
    } catch (error) {
      runError = error instanceof Error ? error : new Error(String(error));
      logs.push(`[daytona] execution failed: ${safeError(runError.message)}`);
    } finally {
      if (sandbox) {
        try {
          await daytona.delete(sandbox, 60, true);
          cleanupStatus = 'deleted';
          logs.push(`[daytona] sandbox ${sandbox.id} deleted`);
        } catch (error) {
          cleanupStatus = 'delete-failed';
          const message = error instanceof Error ? error.message : String(error);
          logs.push(`[daytona] cleanup failed: ${safeError(message)}`);
          this.logger.warn(`sandbox ${sandbox.id} cleanup failed: ${safeError(message)}`);
        }
      }
    }

    const evidence: SandboxRunResult = {
      sandboxId: sandbox?.id ?? '',
      logs,
      durationMs: Date.now() - started,
      executionMode: 'daytona',
      cleanupStatus,
      networkPolicy: 'daytona-tier-policy+block-all',
      evaluatorVersion: EVALUATOR_VERSION,
    };
    if (runError || !result) {
      throw new SandboxExecutionError(runError?.message ?? 'Daytona evaluator returned no result', evidence);
    }
    return { result, sandbox: evidence };
  }
}

/** Pure and dependency-free so its source can execute in an offline Sandbox. */
function evaluateCandidate(input: CandidateSandboxInput): CandidateEvaluationResult {
  const base = {
    candidateCity: input.candidateCity,
    ruleIds: input.ruleIds,
    evidenceTimestamp: new Date().toISOString(),
    evaluatorVersion: 'layoverjoy-candidate-evaluator-v1',
  };
  if (input.eligibility !== 'ELIGIBLE') {
    return {
      ...base,
      eligibility: input.eligibility,
      flightOfferIds: [],
      totalCost: null,
      currency: null,
      usableHours: null,
      riskFlags: input.riskFlags,
    };
  }
  if (!input.leg1 || !input.leg2) {
    return {
      ...base,
      eligibility: 'NO_INVENTORY',
      flightOfferIds: [],
      totalCost: null,
      currency: null,
      usableHours: null,
      riskFlags: Array.from(new Set([...input.riskFlags, 'NO_ATLAS_INVENTORY'])),
    };
  }
  if (input.leg1.currency !== input.leg2.currency) {
    return {
      ...base,
      eligibility: 'NEEDS_REPRICE',
      flightOfferIds: [input.leg1.providerOfferId, input.leg2.providerOfferId],
      totalCost: null,
      currency: null,
      usableHours: null,
      riskFlags: Array.from(new Set([...input.riskFlags, 'CURRENCY_MISMATCH'])),
    };
  }
  const arrival = Date.parse(input.leg1.arrivalAt);
  const onward = Date.parse(input.leg2.departureAt);
  const usableHours = Number.isFinite(arrival) && Number.isFinite(onward)
    ? Math.max(0, (onward - arrival) / 3_600_000 - 6)
    : 0;
  return {
    ...base,
    eligibility: 'ELIGIBLE',
    flightOfferIds: [input.leg1.providerOfferId, input.leg2.providerOfferId],
    totalCost: Math.round((input.leg1.totalPrice + input.leg2.totalPrice) * 100) / 100,
    currency: input.leg1.currency,
    usableHours: Math.round(usableHours * 10) / 10,
    riskFlags: Array.from(new Set(input.riskFlags)),
  };
}

function parseEvaluationResult(raw: string): CandidateEvaluationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    throw new Error('Daytona evaluator returned invalid JSON');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('Daytona evaluator returned an invalid object');
  const value = parsed as CandidateEvaluationResult;
  if (!value.candidateCity || !value.eligibility || value.evaluatorVersion !== EVALUATOR_VERSION) {
    throw new Error('Daytona evaluator result failed contract validation');
  }
  return value;
}

function assertDeidentified(input: CandidateSandboxInput) {
  const serialized = JSON.stringify(input);
  if (/passportNumber|documentNumber|fullName|givenName|familyName|email|secret|apiKey/i.test(serialized)) {
    throw new Error('Candidate Sandbox input contains a forbidden identity or secret field');
  }
}

function safeError(message: string): string {
  return message.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').slice(0, 300);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'candidate';
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
