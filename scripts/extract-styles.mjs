import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

async function findRoot(start) {
  let current = start;
  for (;;) {
    try {
      await access(path.join(current, 'design/prototype.html'));
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) throw new Error('Cannot find design/prototype.html from current directory');
      current = parent;
    }
  }
}

const root = await findRoot(process.cwd());
const prototypePath = path.join(root, 'design/prototype.html');
const outDir = path.join(root, 'packages/ui/styles');
const html = await readFile(prototypePath, 'utf8');
const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);

if (!styleMatch) {
  throw new Error('No <style> block found in design/prototype.html');
}

const style = styleMatch[1].trim();
const rootBlocks = [...style.matchAll(/:root\{[\s\S]*?\n\}/g)].map((m) => m[0]);
if (rootBlocks.length < 2) {
  throw new Error('Expected base and V3 :root blocks in prototype style');
}

const tokens = `${rootBlocks.join('\n')}\n`;
const tokenSet = new Set(rootBlocks);
const sections = style.split(/(?=\/\* ========== )/g);
const baseNames = ['设计令牌', '舞台与说明'];
const consoleNames = ['V3 追加:B 端桌面后台'];
const skipNames = ['V3 追加:双端舞台与切换器'];

function titleOf(section) {
  return section.match(/^\/\* ========== ([\s\S]*?) ========== \*\//)?.[1]?.trim() ?? '';
}

function stripRootBlocks(section) {
  let next = section;
  for (const block of tokenSet) {
    next = next.replace(block, '').trim();
  }
  return next ? `${next}\n` : '';
}

let base = '';
let mobile = '';
let consoleCss = '';

for (const section of sections) {
  const title = titleOf(section);
  if (skipNames.includes(title)) continue;
  const withoutTokens = stripRootBlocks(section);
  if (!withoutTokens) continue;
  if (baseNames.includes(title)) base += `${withoutTokens}\n`;
  else if (consoleNames.includes(title)) consoleCss += `${withoutTokens}\n`;
  else mobile += `${withoutTokens}\n`;
}

const expectedTokens = `:root{
  --ink:#16302B;            /* 松墨 */
  --ink-2:#41534E;
  --ink-3:#7A8A85;
  --paper:#F2F5F3;          /* 屏内底色 */
  --card:#FFFFFF;
  --line:#E4EAE7;
  --brand:#0E7E6B;          /* 临床青绿 */
  --brand-deep:#0A5A4C;
  --brand-soft:#E2F1EC;
  --ok:#19A77E;             /* 达标 */
  --ok-soft:#E4F5EE;
  --hi:#E8833A;             /* 偏高 */
  --hi-soft:#FCEFE3;
  --danger:#D6453D;         /* 低血糖 / 显著偏高 */
  --danger-soft:#FBE9E7;
  --lo:#4A7DDB;             /* 偏低 */
  --lo-soft:#E9F0FC;
  --desk:#0F2420;           /* 桌面背景 */
  --r-card:18px;
  --shadow-card:0 1px 2px rgba(22,48,43,.05),0 6px 18px rgba(22,48,43,.05);
  --font:-apple-system,BlinkMacSystemFont,"PingFang SC","MiSans","HarmonyOS Sans SC","Noto Sans SC","Microsoft YaHei",sans-serif;
}
:root{
  --m-glucose:#0E7E6B; --m-glucose-soft:#E2F1EC;
  --m-bp:#3E63C9;      --m-bp-soft:#E8EDFA;
  --m-lipid:#C77B33;   --m-lipid-soft:#FAF0E3;
  --m-uric:#7A5BBF;    --m-uric-soft:#F0EAFA;
}
`;

if (tokens !== expectedTokens) {
  throw new Error('Extracted tokens do not match GOAL.md expected :root blocks');
}

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'tokens.css'), tokens);
await writeFile(path.join(outDir, 'base.css'), base);
await writeFile(path.join(outDir, 'mobile.css'), mobile);
await writeFile(path.join(outDir, 'console.css'), consoleCss);

console.log(`Extracted ${style.length} CSS bytes into packages/ui/styles`);
