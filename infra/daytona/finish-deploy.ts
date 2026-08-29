/** 部署续跑：引擎与 db push 已完成后，执行表校验 → seed → 启动 api/worker → 健康检查 → Preview URL。 */
import { Daytona } from '@daytonaio/sdk';

const BACKEND = '/workspace/layoverjoy/backend';
const ENGINES = '/workspace/layoverjoy/engines';

async function main() {
  const daytona = new Daytona({
    apiKey: process.env.DAYTONA_API_KEY!,
    apiUrl: process.env.DAYTONA_API_URL ?? 'https://app.daytona.io/api',
  });
  const sandbox: any = await daytona.get(process.env.DAYTONA_SANDBOX_ID!);
  const exec = async (cmd: string, cwd: string | undefined, timeout = 300) => {
    const r = await sandbox.process.executeCommand(cmd, cwd, {}, timeout);
    if (r.exitCode !== 0) throw new Error(`命令失败(${r.exitCode})：${cmd}\n${r.result ?? ''}`);
    return r.result ?? '';
  };

  // 1) 表校验（current_schema() 避免任何引号）
  const cnt = await exec(
    `N=$(sudo -u postgres psql -d layoverjoy -tAc "select count(*) from pg_catalog.pg_tables where schemaname=current_schema()"); echo TABLE_COUNT=$N; [ "$N" -gt 0 ] && echo TABLES_OK`,
    undefined, 60,
  );
  console.log(cnt.trim());

  // 1.5) 运行时引擎：PrismaClient 只按固定文件名在 .prisma/client 目录查找，拷贝到位并校验（硬失败）
  await exec(
    `cp ${ENGINES}/libquery_engine.so.node node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node && ` +
      'ls node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node && echo ENGINE_COPIED',
    BACKEND, 60,
  );

  // 2) 种子数据（失败时输出日志尾部便于诊断）
  try {
    console.log(await exec('set -a; . ./.env; set +a; node dist/seed.js >>/tmp/seed.log 2>&1 && echo SEED_OK', BACKEND, 300));
  } catch (e) {
    const log = await sandbox.process.executeCommand('tail -n 30 /tmp/seed.log', BACKEND, {}, 30);
    throw new Error(`seed 失败。/tmp/seed.log 末尾：\n${log.result ?? ''}`);
  }

  // 3) 清理旧进程并启动 api / worker
  await exec("pkill -f 'node dist/' || true", BACKEND, 30);
  await exec(
    `export PRISMA_QUERY_ENGINE_LIBRARY=${ENGINES}/libquery_engine.so.node; ` +
      'nohup ./start.sh api >/tmp/api.log 2>&1 & sleep 1; echo API_STARTED',
    BACKEND, 60,
  );
  await exec(
    `export PRISMA_QUERY_ENGINE_LIBRARY=${ENGINES}/libquery_engine.so.node; ` +
      'nohup ./start.sh worker >/tmp/worker.log 2>&1 & sleep 1; echo WORKER_STARTED',
    BACKEND, 60,
  );

  // 4) 健康检查
  let healthy = false;
  for (let i = 0; i < 30; i++) {
    const r = await sandbox.process.executeCommand(
      'wget -qO- http://127.0.0.1:8080/v1/health 2>/dev/null || curl -fs http://127.0.0.1:8080/v1/health 2>/dev/null || true',
      undefined, {}, 30,
    );
    if ((r.result ?? '').includes('"status"')) { healthy = true; console.log('HEALTH:', (r.result ?? '').trim()); break; }
    await new Promise((s) => setTimeout(s, 5000));
  }
  if (!healthy) {
    const log = await sandbox.process.executeCommand('tail -n 40 /tmp/api.log', undefined, {}, 30);
    throw new Error(`API 未在 150 秒内就绪。/tmp/api.log 末尾：\n${log.result ?? ''}`);
  }

  // 5) Preview URL
  const preview = await sandbox.getPreviewLink(8080);
  console.log('\n✅ 部署成功！');
  console.log(`   Sandbox ID: ${sandbox.id}`);
  console.log(`   Preview URL（Android 的 API Base）: ${preview.url}`);
  if (preview.token) {
    console.log('   若为私有预览，需请求头 X-Daytona-Preview-Token（演示时在开发设置配置，勿写入 APK）。');
  }
}
main().catch((e) => { console.error('❌ 续跑失败：', e?.message ?? e); process.exit(1); });
