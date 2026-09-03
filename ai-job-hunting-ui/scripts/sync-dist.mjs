// 构建后同步脚本：把 dist 自包含产物复制到仓库根目录，保证「发布 = 构建」，消除版本漂移。
import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// 仓库根目录（ai-job/），脚本位于 ai-job-hunting-ui/scripts/
const root = resolve(__dirname, '..', '..');
const distFile = resolve(__dirname, '..', 'dist', 'ai-job-hunting.user.js');
const bundleFile = resolve(root, 'ai-job-hunting.bundle.user.js');

copyFileSync(distFile, bundleFile);
console.log(`[sync-dist] ${distFile} -> ${bundleFile}`);
