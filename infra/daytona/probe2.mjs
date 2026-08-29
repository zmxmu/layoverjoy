import { Daytona } from '@daytonaio/sdk';
const d = new Daytona({ apiKey: process.env.DAYTONA_API_KEY, serverUrl: process.env.DAYTONA_API_URL });
async function run(sb, cmd, t=60){ const r = await sb.process.executeCommand(cmd, undefined, {}, t); console.log(`$ ${cmd}\n   exit=${r.exitCode} out=${(r.result||'').trim().split('\n').slice(0,6).join(' | ')}`); return r; }
const sb = await d.create({}, { timeout: 300 });
console.log('sandbox', sb.id);
await run(sb, 'whoami; id -u');
await run(sb, 'which apt-get && apt-get --version | head -1');
await run(sb, 'which curl wget git');
console.log('--- try apt-get update (fast) ---');
await run(sb, 'apt-get update -o Dir::Etc::sourcelist=/dev/null 2>&1 | tail -2 || apt-get update 2>&1 | tail -3', 120);
await d.stop(sb).catch(()=>{}); await d.delete(sb).catch(()=>{});
console.log('cleaned');
