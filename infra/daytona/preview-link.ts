/** 打印 8080 端口的 Preview URL 与私有预览 token（供 curl 验证）。 */
import { Daytona } from '@daytonaio/sdk';

async function main() {
  const d = new Daytona({
    apiKey: process.env.DAYTONA_API_KEY!,
    apiUrl: process.env.DAYTONA_API_URL ?? 'https://app.daytona.io/api',
  });
  const s: any = await d.get(process.env.DAYTONA_SANDBOX_ID!);
  const p = await s.getPreviewLink(8080);
  console.log(JSON.stringify(p, null, 2));
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
