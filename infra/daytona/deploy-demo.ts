/**
 * LayoverJoy Demo 部署脚本 —— 原生进程方案（Daytona Sandbox 直接运行，08 文档 §5/§7）。
 *
 * 结论：Daytona 默认 Snapshot（Debian）自带可执行 shell 与 Node，但不带 Docker；
 * 而直接用 `docker:*-dind` 镜像创建 Sandbox 无法注入 Daytona Agent（fork/exec /bin/sh 失败），
 * 因此放弃 Docker-in-Docker，改为在 Sandbox 内以原生进程方式运行 PostgreSQL + Redis + NestJS。
 *
 * 流程：
 *   1. 读取本机 .secrets/layoverjoy.env（唯一密钥来源，绝不外传日志）
 *   2. 创建/复用 demo Sandbox（默认 Snapshot：Debian + Node，支持 passwordless sudo）
 *   3. apt 安装 postgresql/redis/build 依赖，启动数据库与缓存并建库建角色
 *   4. 上传后端源码（排除 .git/.secrets/构建产物）
 *   5. npm ci + prisma generate + build；注入 .env 并 db push + seed
 *   6. 以 nohup 启动 api 与 monitor-worker，轮询 /v1/health
 *   7. 输出 8080 的 Preview URL（唯一公开端口；PG/Redis 仅本机回环）
 *
 * 用法：cd project/infra/daytona && npm install && npm run deploy:demo
 */
import { Daytona } from '@daytonaio/sdk';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '../..');            // project/
const repoRoot = resolve(projectRoot, '..');            // 仓库根
const secretsPath = resolve(repoRoot, '.secrets/layoverjoy.env');
const WORKDIR = '/workspace/layoverjoy';
// 早期命令（目录尚未创建）不指定 cwd：cwd 目录不存在会导致 Agent 起 shell 失败（报 fork/exec 类错误）
const DEFAULT_CWD: string | undefined = undefined;
const BACKEND = `${WORKDIR}/backend`;
const SANDBOX_NAME = 'layoverjoy-demo';
const DB_USER = 'layoverjoy';
const DB_PASS = process.env.DEMO_DB_PASSWORD || 'layoverjoy_demo_only';
const DB_NAME = 'layoverjoy';
const DATABASE_URL = `postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}?schema=public`;
const REDIS_URL = 'redis://127.0.0.1:6379';

// Prisma 引擎离线方案：Sandbox 到 binaries.prisma.sh 持续不可达（连二进制本体都下载失败），
// 改为本地下载（本地可达）→ 上传 Sandbox → 用 PRISMA_*_ENGINE_BINARY 指向。
// commit/路径取自后端 node_modules 中 @prisma/engines 实际使用的版本。
const ENGINE_COMMIT = '605197351a3c8bdd595af2d2a9bc3025bca48ea2';
const ENGINE_BASE = `https://binaries.prisma.sh/all_commits/${ENGINE_COMMIT}/debian-openssl-3.0.x`;
const ENGINES_LOCAL = resolve(here, 'engines');
const ENGINES_REMOTE = `${WORKDIR}/engines`;
const QUERY_ENGINE_REMOTE = `${ENGINES_REMOTE}/libquery_engine.so.node`;
const SCHEMA_ENGINE_REMOTE = `${ENGINES_REMOTE}/schema-engine`;
// 引擎覆盖环境变量：Prisma 5.22 中查询引擎（library 型 .so.node）对应 PRISMA_QUERY_ENGINE_LIBRARY，
// schema-engine 对应 PRISMA_SCHEMA_ENGINE_BINARY（从 prisma/build/index.js 源码确认的映射）。
const ENGINE_ENV = `PRISMA_QUERY_ENGINE_LIBRARY=${QUERY_ENGINE_REMOTE} PRISMA_SCHEMA_ENGINE_BINARY=${SCHEMA_ENGINE_REMOTE}`;

/** 本地下载并缓存 Prisma 引擎（.gz 下载后本地解压再上传，避免沙箱内联网）。 */
async function ensureLocalEngines(): Promise<{ query: string; schema: string }> {
  mkdirSync(ENGINES_LOCAL, { recursive: true });
  const targets: Array<[string, string]> = [
    ['libquery_engine.so.node.gz', 'libquery_engine.so.node'],
    ['schema-engine.gz', 'schema-engine'],
  ];
  for (const [remote, local] of targets) {
    const dst = resolve(ENGINES_LOCAL, local);
    if (existsSync(dst) && statSync(dst).size > 1_000_000) continue;
    console.log(`  下载引擎 ${remote} …`);
    let lastErr: any = null;
    for (let i = 1; i <= 3; i++) {
      try {
        const buf = Buffer.from(await (await fetch(`${ENGINE_BASE}/${remote}`)).arrayBuffer());
        writeFileSync(dst, gunzipSync(buf));
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        await new Promise((s) => setTimeout(s, 3000));
      }
    }
    if (lastErr) throw new Error(`引擎下载失败：${remote}（${lastErr.message ?? lastErr}）`);
  }
  return {
    query: resolve(ENGINES_LOCAL, 'libquery_engine.so.node'),
    schema: resolve(ENGINES_LOCAL, 'schema-engine'),
  };
}

function loadSecrets(): Record<string, string> {
  if (!existsSync(secretsPath)) {
    throw new Error(`缺少密钥文件：${secretsPath}（参考 qoder-input/.env.example）`);
  }
  const env: Record<string, string> = {};
  for (const line of readFileSync(secretsPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    // 排除 DAYTONA_*：不把部署侧基础设施密钥注入到应用运行时
    if (m && !m[1].startsWith('DAYTONA_')) env[m[1]] = m[2].trim();
  }
  return env;
}

async function execOnce(sandbox: any, cmd: string, cwd: string | undefined, timeout: number) {
  return sandbox.process.executeCommand(cmd, cwd, {}, timeout);
}

/** 带瞬时失败重试的命令执行（Agent 刚启动/平台抖动时会出现 fork/exec /usr/bin/zsh 报错）。 */
async function run(sandbox: any, cmd: string, timeout = 300, cwd: string | undefined = DEFAULT_CWD): Promise<string> {
  let lastErr: any = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    let r: any = null;
    try {
      r = await execOnce(sandbox, cmd, cwd, timeout);
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message ?? e);
      if (attempt < 5 && /fork\/exec|not ready|unavailable|ECONN|timeout/i.test(msg)) {
        console.log(`  ⚠️ 命令瞬时失败，重试 ${attempt}/5：${msg.slice(0, 100)}`);
        await new Promise((s) => setTimeout(s, 5000));
        continue;
      }
      throw e;
    }
    if (r.exitCode !== 0) {
      const out = r.result ?? '';
      // exitCode -1 且 shell 缺失类报错 → Agent 尚未就绪，重试
      if (attempt < 5 && r.exitCode === -1 && /fork\/exec|no such file/i.test(out)) {
        console.log(`  ⚠️ Agent 未就绪（${out.slice(0, 80)}），重试 ${attempt}/5…`);
        await new Promise((s) => setTimeout(s, 5000));
        continue;
      }
      throw new Error(`命令失败(${r.exitCode})：${cmd}\n${out}`);
    }
    return r.result ?? '';
  }
  throw new Error(`命令重试 5 次仍失败：${cmd}\n${lastErr?.message ?? ''}`);
}

/** SDK 的 uploadFile 只支持单文件（目录会报 EISDIR），这里递归上传。 */
async function uploadDir(sandbox: any, localDir: string, remoteDir: string) {
  await run(sandbox, `mkdir -p ${remoteDir}`, 60);
  for (const entry of readdirSync(localDir)) {
    const localPath = resolve(localDir, entry);
    const remotePath = `${remoteDir}/${entry}`;
    if (statSync(localPath).isDirectory()) {
      await uploadDir(sandbox, localPath, remotePath);
    } else {
      await sandbox.fs.uploadFile(localPath, remotePath);
    }
  }
}

async function main() {
  const secrets = loadSecrets();
  const apiKey = process.env.DAYTONA_API_KEY;
  const apiUrl = process.env.DAYTONA_API_URL ?? 'https://app.daytona.io/api';
  const reuseId = process.env.DAYTONA_SANDBOX_ID;
  if (!apiKey) throw new Error('DAYTONA_API_KEY 未设置（请从 .secrets/layoverjoy.env 导出）');

  const daytona = new Daytona({ apiKey, apiUrl });

  // 1) 获取或创建 demo Sandbox（默认 Snapshot：Debian + Node，passwordless sudo）
  let sandbox: any;
  if (reuseId) {
    console.log(`[1/7] 复用已有 Sandbox ${reuseId}`);
    sandbox = await daytona.get(reuseId);
    // 已处于 started 时不再调用 start（避免平台重启导致 Agent 短暂不可用）
    if ((sandbox as any).state !== 'started') {
      await daytona.start(sandbox).catch(() => console.log('  （Sandbox 已在运行）'));
    }
  } else {
    console.log(`[1/7] 创建 demo Sandbox（${SANDBOX_NAME}，默认 Snapshot）`);
    // 先找同名已停止的，避免重复创建
    let found: any = null;
    try {
      for await (const s of daytona.list()) {
        if ((s as any).name === SANDBOX_NAME) { found = s; break; }
      }
    } catch { /* ignore */ }
    if (found) {
      console.log(`  复用同名 Sandbox ${found.id}`);
      sandbox = found;
      if ((sandbox as any).state !== 'started') {
        await daytona.start(sandbox).catch(() => {});
      }
    } else {
      sandbox = await daytona.create(
        { name: SANDBOX_NAME, autoStopInterval: 240 },
        { timeout: 600 },
      );
    }
  }
  console.log(`  Sandbox: ${sandbox.id}`);

  // 1.5) 等待 Sandbox Agent 就绪（刚创建/刚启动时 exec shell 可能尚未可用）
  let ready = false;
  for (let i = 0; i < 20; i++) {
    const r = await execOnce(sandbox, 'echo ready', undefined, 30).catch(() => null);
    const out = r?.result ?? '';
    if (r && r.exitCode === 0 && out.includes('ready')) { ready = true; break; }
    console.log(`  等待 Agent 就绪 (${i + 1}/20)… ${String(out).slice(0, 60)}`);
    await new Promise((s) => setTimeout(s, 5000));
  }
  if (!ready) throw new Error('Sandbox Agent 未在 100 秒内就绪，请删除该 Sandbox 后重试');

  // 2) 系统依赖：PostgreSQL、Redis、构建工具（argon2 原生模块）
  console.log('[2/7] 安装系统依赖（postgresql/redis/build-essential）…');
  await run(sandbox, 'sudo mkdir -p ' + WORKDIR + ' && sudo chown -R $(id -u):$(id -g) ' + WORKDIR, 60);
  await run(
    sandbox,
    'sudo apt-get update -y >/tmp/apt.log 2>&1 && ' +
      'sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ' +
      'postgresql redis-server build-essential python3 ca-certificates >>/tmp/apt.log 2>&1 && echo APT_OK',
    900,
  );

  // Node 版本保障（>=20）
  const nodeVer = (await run(sandbox, 'node -v || echo v0.0.0', 60)).trim();
  console.log(`  当前 Node: ${nodeVer}`);
  const major = parseInt(nodeVer.replace(/^v/, '').split('.')[0] || '0', 10);
  if (major < 20) {
    console.log('  升级 Node 至 20.x …');
    await run(sandbox, 'sudo apt-get install -y nodejs npm >>/tmp/apt.log 2>&1 && node -v', 600);
  }

  // 3) 启动 Redis 与 PostgreSQL，建角色与库（幂等）
  console.log('[3/7] 启动 Redis 与 PostgreSQL 并初始化数据库…');
  await run(sandbox, 'redis-cli ping >/dev/null 2>&1 || sudo redis-server --daemonize yes --port 6379', 120);
  await run(sandbox, 'for i in $(seq 1 20); do redis-cli ping >/dev/null 2>&1 && echo REDIS_OK && break; sleep 1; done', 60);
  await run(sandbox, 'sudo service postgresql start >/dev/null 2>&1 || true', 120);
  await run(sandbox, 'for i in $(seq 1 30); do sudo -u postgres pg_isready >/dev/null 2>&1 && echo PG_OK && break; sleep 1; done', 90);
  await run(
    sandbox,
    `sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 || ` +
      `sudo -u postgres psql -c "CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}'"`,
    60,
  );
  await run(
    sandbox,
    `sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 || ` +
      `sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}"`,
    60,
  );

  // 4) 上传后端源码
  console.log('[4/7] 上传后端源码…');
  await run(sandbox, `mkdir -p ${BACKEND}`, 60);
  const uploads: Array<[string, string]> = [
    [resolve(projectRoot, 'backend/package.json'), `${BACKEND}/package.json`],
    [resolve(projectRoot, 'backend/package-lock.json'), `${BACKEND}/package-lock.json`],
    [resolve(projectRoot, 'backend/tsconfig.json'), `${BACKEND}/tsconfig.json`],
    [resolve(projectRoot, 'backend/nest-cli.json'), `${BACKEND}/nest-cli.json`],
  ];
  for (const [src, dst] of uploads) {
    if (!existsSync(src)) throw new Error(`缺少文件：${src}`);
    await sandbox.fs.uploadFile(src, dst);
  }
  await uploadDir(sandbox, resolve(projectRoot, 'backend/src'), `${BACKEND}/src`);
  await uploadDir(sandbox, resolve(projectRoot, 'backend/prisma'), `${BACKEND}/prisma`);

  // 5) 构建：先上传本地下载的 Prisma 引擎，再 npm ci + prisma generate + build；注入 .env
  console.log('[5/7] 上传 Prisma 引擎 → npm ci → prisma generate → build…');
  const engines = await ensureLocalEngines();
  await run(sandbox, `mkdir -p ${ENGINES_REMOTE}`, 60);
  await sandbox.fs.uploadFile(engines.query, QUERY_ENGINE_REMOTE);
  await sandbox.fs.uploadFile(engines.schema, SCHEMA_ENGINE_REMOTE);
  await run(sandbox, `chmod +x ${SCHEMA_ENGINE_REMOTE}`, 30);
  await run(sandbox, 'npm ci --no-audit --no-fund >>/tmp/npm.log 2>&1 && echo NPM_OK', 1500, BACKEND);
  // 引擎已离线就位：用 PRISMA_QUERY_ENGINE_LIBRARY/PRISMA_SCHEMA_ENGINE_BINARY 指向，prisma 全程不再访问 binaries.prisma.sh
  await run(sandbox, `for i in 1 2 3; do ${ENGINE_ENV} npx prisma generate --no-hints >>/tmp/npm.log 2>&1 && echo GEN_OK && break; sleep 5; done`, 1500, BACKEND);
  await run(sandbox, 'npm run build >>/tmp/npm.log 2>&1 && echo BUILD_OK', 900, BACKEND);
  // 硬性校验：查询引擎必须存在于 client 输出目录；重试后仍缺失则硬失败（防止静默通过）
  await run(
    sandbox,
    'if ls node_modules/.prisma/client/libquery_engine* >/dev/null 2>&1; then echo ENGINE_OK; else ' +
      `for i in 1 2 3; do ${ENGINE_ENV} npx prisma generate --no-hints >>/tmp/npm.log 2>&1 && ` +
      'ls node_modules/.prisma/client/libquery_engine* >/dev/null 2>&1 && echo ENGINE_OK && break; sleep 5; done; fi; ' +
      'ls node_modules/.prisma/client/libquery_engine* >/dev/null 2>&1 || exit 1',
    1500,
    BACKEND,
  );
  // 运行时 PrismaClient 只按固定文件名在 .prisma/client 目录查找（不读覆盖环境变量），显式拷贝兜底：
  await run(
    sandbox,
    `cp ${QUERY_ENGINE_REMOTE} node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node && echo ENGINE_COPIED`,
    60,
    BACKEND,
  );

  // 运行时 .env（密钥 + 覆盖项；后置覆盖生效）
  const envLines = [
    ...Object.entries(secrets).map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`),
    `DATABASE_URL="${DATABASE_URL}"`,
    `REDIS_URL="${REDIS_URL}"`,
    'NODE_ENV="production"',
    'RUNTIME_TARGET="daytona"',
    'PORT="8080"',
  ].join('\n');
  await sandbox.fs.uploadFile(Buffer.from(envContentSafe(envLines)), `${BACKEND}/.env`);

  // 启动脚本：载入 .env 后运行指定入口（api/worker）
  const startSh =
    '#!/bin/bash\nset -e\ncd ' + BACKEND + '\nset -a; . ./.env; set +a\n' +
    `export PRISMA_QUERY_ENGINE_LIBRARY=${QUERY_ENGINE_REMOTE}\n` +
    'exec node dist/${1:-main}.js\n';
  await sandbox.fs.uploadFile(Buffer.from(startSh), `${BACKEND}/start.sh`);
  await run(sandbox, 'chmod +x start.sh', 30, BACKEND);

  // 6) 同步 schema + 种子，启动 api 与 worker
  console.log('[6/7] prisma db push + seed，启动 api 与 worker…');
  await run(sandbox, `set -a; . ./.env; set +a; PUSH_OK=; for i in 1 2 3; do ${ENGINE_ENV} npx prisma db push --skip-generate >>/tmp/dbpush.log 2>&1 && PUSH_OK=1 && echo PUSH_OK && break; sleep 5; done; [ -n "$PUSH_OK" ] || exit 1`, 1500, BACKEND);
  // 硬性校验：目标库必须有表（-d 指定；current_schema() 避免引号被 executeCommand 外层剥掉）
  await run(
    sandbox,
    `N=$(sudo -u postgres psql -d ${DB_NAME} -tAc "select count(*) from pg_catalog.pg_tables where schemaname=current_schema()"); echo TABLE_COUNT=$N; [ "$N" -gt 0 ] && echo TABLES_OK`,
    60,
  );
  await run(sandbox, 'set -a; . ./.env; set +a; node dist/seed.js >>/tmp/seed.log 2>&1 && echo SEED_OK', 300, BACKEND);
  await run(sandbox, 'nohup ./start.sh api >/tmp/api.log 2>&1 & sleep 1; echo API_STARTED', 60, BACKEND);
  await run(sandbox, 'nohup ./start.sh worker >/tmp/worker.log 2>&1 & sleep 1; echo WORKER_STARTED', 60, BACKEND);

  // 7) 等待健康并输出 Preview URL
  console.log('[7/7] 等待 /v1/health 就绪…');
  let healthy = false;
  for (let i = 0; i < 30; i++) {
    const r = await sandbox.process.executeCommand(
      'wget -qO- http://127.0.0.1:8080/v1/health 2>/dev/null || curl -fs http://127.0.0.1:8080/v1/health 2>/dev/null || true',
      DEFAULT_CWD, {}, 30,
    );
    if ((r.result ?? '').includes('"status"')) { healthy = true; break; }
    await new Promise((s) => setTimeout(s, 5000));
  }
  if (!healthy) {
    const log = await sandbox.process.executeCommand('tail -n 40 /tmp/api.log', DEFAULT_CWD, {}, 30);
    throw new Error(`API 未在 150 秒内就绪。/tmp/api.log 末尾：\n${log.result ?? ''}`);
  }

  const preview = await sandbox.getPreviewLink(8080);
  console.log('\n✅ 部署成功！');
  console.log(`   Sandbox ID: ${sandbox.id}`);
  console.log(`   Preview URL（Android 的 API Base）: ${preview.url}`);
  if (preview.token) {
    console.log('   若为私有预览，需请求头 X-Daytona-Preview-Token（演示时于开发设置配置，勿写入 APK）。');
  }
  console.log('   仅开放 8080；PostgreSQL/Redis 仅监听 Sandbox 回环地址。');
}

function envContentSafe(s: string): string {
  return s;
}

main().catch((e) => {
  console.error('❌ 部署失败：', e?.message ?? e);
  process.exit(1);
});
