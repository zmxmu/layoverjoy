/** 清理同名坏沙箱，保留已验证可用的 8d6aeed3。 */
import { Daytona } from '@daytonaio/sdk';

const KEEP = '8d6aeed3-d78e-4aea-a0c9-88b5bc4415f5';
const NAME = 'layoverjoy-demo';

const d = new Daytona({ apiKey: process.env.DAYTONA_API_KEY!, apiUrl: process.env.DAYTONA_API_URL ?? 'https://app.daytona.io/api' });

async function main() {
  const targets: any[] = [];
  for await (const s of d.list() as any) {
    console.log('-', s.id, s.name, s.state, s.snapshot ?? '');
    if (s.name === NAME && s.id !== KEEP) targets.push(s);
  }
  for (const s of targets) {
    console.log('deleting', s.id);
    await (d as any).delete(s.id, { force: true });
  }
  console.log('cleanup done, kept', KEEP);
}

main().catch((e) => { console.error('❌', e?.message ?? e); process.exit(1); });
