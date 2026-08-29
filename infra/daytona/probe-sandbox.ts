/** 探针：检查指定 Sandbox 的快照信息与 shell 可用性，并列出账户可用快照。 */
import { Daytona } from '@daytonaio/sdk';

const apiKey = process.env.DAYTONA_API_KEY;
if (!apiKey) throw new Error('DAYTONA_API_KEY 未设置');
const daytona = new Daytona({ apiKey, apiUrl: process.env.DAYTONA_API_URL ?? 'https://app.daytona.io/api' });

const id = process.argv[2];
if (id) {
  const s: any = await daytona.get(id);
  console.log('=== sandbox ===');
  console.log(JSON.stringify({
    id: s.id, name: s.name, state: s.state,
    snapshot: s.snapshot, image: s.image, baseSnapshot: s.baseSnapshotName,
    snapshotId: s.snapshotId,
  }, null, 2));
  try {
    const r = await s.process.executeCommand('id; ls -la /usr/bin/zsh /bin/bash /bin/sh 2>&1; cat /etc/os-release | head -2', undefined, {}, 30);
    console.log('exec exit=', r.exitCode, '\n', r.result);
  } catch (e: any) {
    console.log('exec error:', e?.message ?? e);
  }
}

console.log('=== snapshots ===');
const snaps: any = await daytona.snapshot.list({ page: 0, limit: 100 });
for (const sn of snaps.items ?? snaps ?? []) {
  console.log('-', sn.name, '|', sn.state ?? '', '|', sn.id ?? '');
}
