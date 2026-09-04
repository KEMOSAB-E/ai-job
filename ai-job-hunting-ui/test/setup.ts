// vitest setup：在加载被测模块前 stub 浏览器/全局对象。
import {beforeEach} from "vitest";
import {__resetGMStore} from "./mocks/tampermonkey";

// window 及定时器：LogRecorder/AutoPushScheduler 依赖 window
// setTimeout 同步执行回调，让 reloadPage 的 5s 延迟在测试里立即生效
(globalThis as any).window = {
    setInterval: () => 1,
    clearInterval: () => {
    },
    setTimeout: (fn: Function) => {
        fn();
        return 0;
    },
    clearTimeout: () => {
    },
    location: {
        pathname: "/web/geek/jobs",
        search: "?jobType=1901",
        reload: () => {
        },
    },
};

(globalThis as any).location = (globalThis as any).window.location;

// navigator.locks：直接串行执行回调（同步语义），方便断言
// Node 22+ 的 navigator 是只读 getter，需用 defineProperty 覆盖
Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
        locks: {
            request: async (_name: string, callback: () => void | Promise<void>) => {
                await callback();
            },
        },
    },
});

// document：供 resolveTabNames / clickTabByName 查询标签，默认无任何标签
(globalThis as any).document = {
    querySelector: () => null,
    querySelectorAll: () => [],
};

// 每个用例前重置 GM 内存存储，避免用例间相互污染
beforeEach(() => {
    __resetGMStore();
});
