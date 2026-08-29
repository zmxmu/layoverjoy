import { Daytona } from '@daytonaio/sdk';
const d = new Daytona({ apiKey: process.env.DAYTONA_API_KEY, serverUrl: process.env.DAYTONA_API_URL });
async function run(sb, cmd, t=90){ const r = await sb.process.executeCommand(cmd, undefined, {}, t); console.log(`$ ${cmd}\n   exit=${r.exitCode} out=${(r.result||'').trim().split('\n').slice(0,8).join(' | ')}`); return r; }
const sb = await d.create({}, { timeout: 300 });
console.log('sandbox', sb.id);
await run(sb, 'sudo -n whoami 2>&1');
await run(sb, 'sudo -n apt-get update 2>&1 | tail -3', 180);
await run(sb, 'sudo -n apt-get install -y --no-install-recommends postgresql redis-server 2>&1 | tail -5', 600);
await d.stop(sb).catch(()=>{}); await d.delete(sb).catch(()=>{});
console.log('cleaned');
