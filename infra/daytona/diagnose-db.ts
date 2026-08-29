/** 远程诊断：dbpush 日志、PG 状态、表数量。 */
import { Daytona } from '@daytonaio/sdk';

const d = new Daytona({ apiKey: process.env.DAYTONA_API_KEY!, apiUrl: process.env.DAYTONA_API_URL ?? 'https://app.daytona.io/api' });

async function main() {
  const s: any = await d.get(process.env.DAYTONA_SANDBOX_ID!);
  const cmds = [
    'tail -30 /tmp/dbpush.log',
    'sudo -u postgres pg_isready; echo rc=$?',
    'sudo -u postgres psql -tAc "select count(*) from information_schema.tables where table_schema=\'public\'"',
    'ls -la /workspace/layoverjoy/backend/.env | head -1',
  ];
  for (const c of cmds) {
    const r = await s.process.executeCommand(c, undefined, {}, 60);
    console.log('---', c.slice(0, 60));
    console.log(r.exitCode, r.result);
  }
}
main().catch((e) => console.error(e?.message ?? e));
