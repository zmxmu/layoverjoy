/** 一次性验证：沙箱内引擎文件在位情况 + 离线 db push 真实输出。 */
import { Daytona } from '@daytonaio/sdk';

const BACKEND = '/workspace/layoverjoy/backend';
const ENGINES = '/workspace/layoverjoy/engines';
const ENV = `PRISMA_QUERY_ENGINE_LIBRARY=${ENGINES}/libquery_engine.so.node PRISMA_SCHEMA_ENGINE_BINARY=${ENGINES}/schema-engine`;

async function main() {
  const daytona = new Daytona({
    apiKey: process.env.DAYTONA_API_KEY!,
    apiUrl: process.env.DAYTONA_API_URL ?? 'https://app.daytona.io/api',
  });
  const sandbox: any = await daytona.get(process.env.DAYTONA_SANDBOX_ID!);
  const cmds = [
    `ls -la ${ENGINES}`,
    `ls node_modules/.prisma/client/ 2>/dev/null | head -10`,
    `set -a; . ./.env; set +a; ${ENV} timeout 120 npx prisma db push --skip-generate >/tmp/dbpush2.log 2>&1; echo rc=$?; tail -25 /tmp/dbpush2.log`,
    `sudo -u postgres psql -tAc "select count(*) from information_schema.tables where table_schema='public'"`,
  ];
  for (const c of cmds) {
    console.log(`--- ${c.slice(0, 90)}`);
    try {
      const r = await sandbox.process.executeCommand(c, BACKEND, {}, 300);
      console.log(r.result ?? '(no output)');
    } catch (e: any) {
      console.log('ERR:', e?.message ?? e);
    }
  }
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
