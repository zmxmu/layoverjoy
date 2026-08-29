import { Daytona } from '@daytonaio/sdk';
const d = new Daytona({ apiKey: process.env.DAYTONA_API_KEY, serverUrl: process.env.DAYTONA_API_URL });

// 1) list snapshots
try {
  const page = await d.snapshot.list({ page: 1, limit: 50 });
  console.log('=== snapshots ===');
  for (const s of page.items) console.log(`  ${s.name} | img=${s.imageName} | state=${s.state} | class=${s.sandboxClass ?? '-'}`);
} catch (e) { console.log('snapshot list err:', e?.message); }

// 2) create sandbox from default snapshot and test shell+docker
try {
  console.log('=== creating default sandbox ===');
  const sb = await d.create({}, { timeout: 300 });
  console.log('sandbox id:', sb.id);
  const tests = [
    'echo SHELL_OK',
    'cat /etc/os-release 2>/dev/null | head -1',
    'which docker || echo NO_DOCKER',
    'which node || echo NO_NODE',
  ];
  for (const t of tests) {
    const r = await sb.process.executeCommand(t, undefined, {}, 30);
    console.log(`$ ${t}\n   exit=${r.exitCode} out=${(r.result||'').trim()}`);
  }
  await d.stop(sb).catch(()=>{});
  await d.delete(sb).catch(()=>{});
} catch (e) { console.log('default sandbox err:', e?.message); }
