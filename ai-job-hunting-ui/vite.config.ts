import {defineConfig} from 'vite';
import vue from '@vitejs/plugin-vue';
import Markdown from 'vite-plugin-md';
import monkey from "vite-plugin-monkey";
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import {ElementPlusResolver} from 'unplugin-vue-components/resolvers';
import {execSync} from 'node:child_process';

let matchUrlList: string[] = [
    'https://www.zhipin.com/web/geek/*',
    'https://www.zhipin.com/overseas/*'
];

// 版本号：默认用 git 提交数生成单调递增版本（0.0.<提交数>-beta），保证本地构建永不低于旧版本被覆盖；
// 可通过环境变量 USERSCRIPT_VERSION 手动指定（如发布时想自定义版本号）。
function getVersion(): string {
    if (process.env.USERSCRIPT_VERSION) {
        return process.env.USERSCRIPT_VERSION;
    }
    try {
        const count = execSync('git rev-list --count HEAD').toString().trim();
        return `0.0.${count}-beta`;
    } catch {
        return '0.0.0-beta';
    }
}

// 发布时才写入 updateURL/downloadURL（PUBLISH=1 pnpm build）；默认本地构建不写，避免被线上自动覆盖。
const isPublish = process.env.PUBLISH === '1';

// https://vitejs.dev/config/
// https://github.com/lisonge/vite-plugin-monkey
export default defineConfig(({mode}) => {
    const isProduction = mode === 'production';

    const plugins = [
        vue({
            include: [/\.vue$/, /\.md$/], // Support .vue and .md files
        }),
        Markdown(),
        AutoImport({
            resolvers: [ElementPlusResolver()],
        }),
        Components({
            resolvers: [ElementPlusResolver()],
        }),
        monkey({
            entry: 'src/main.ts',
            userscript: {
                name: "AI工作猎手-让ai帮您找工作！",
                author: "maple.",
                version: getVersion(),
                license: 'Apache License 2.0',
                icon: 'https://gitee.com/yangfeng20/ai-job/raw/master/file/icon.png',
                description: "找工作，用AI工作猎手！让AI帮您找工作！ai坐席：【DeepSeek+ChatGpt】赋能，ai助理作为您的求职者分身24小时 * 7在线找工作，并结合您的简历信息定制化回复。批量投递，自动发送简历，交换联系方式。hr拒绝挽留。高意向邮件通知，让您不错过每一份工作机会。BOSS直聘",
                namespace: 'https://github.com/yangfeng20',
                connect: ["docdownload.zhipin.com"],
                ...(isPublish ? {
                    updateURL: "https://gitee.com/yangfeng20/ai-job/raw/master/ai-job-hunting.user.js",
                    downloadURL: "https://gitee.com/yangfeng20/ai-job/raw/master/ai-job-hunting.user.js",
                } : {}),
                match: matchUrlList,
            },
            build: {
                // 内联 systemjs，避免运行时从 jsdelivr CDN 拉取（国内常被墙导致面板不渲染）
                systemjs: 'inline',
            },
        })
    ];

    return {
        plugins,
        resolve: {
            extensions: ['.js', '.ts', '.vue', '.json', '.css'],
            alias: {
                'vue': 'vue/dist/vue.esm-bundler.js'
            }
        },
    };
});