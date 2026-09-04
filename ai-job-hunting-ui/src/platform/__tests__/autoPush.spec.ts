import {beforeEach, describe, expect, it, vi} from "vitest";

// mock UserStore：返回可动态配置的 preference
const mocks = vi.hoisted(() => ({
    preference: {} as any,
}));

vi.mock("../../stores", () => ({
    UserStore: () => ({user: {preference: mocks.preference}}),
}));

import {AutoPushScheduler} from "../autoPush";
import {TampermonkeyApi} from "../utils";

const TAB_ROTATION_COUNT_KEY = "autoPushTabRotationCount";

describe("AutoPushScheduler.refreshJobPool（跨页面共享标签轮换）", () => {
    let scheduler: any;
    let clicked: string[];

    // 模拟页面上可点击的标签（推荐 → a.synthesis，其余 → a.expect-item）
    const makeDocument = (tabs: string[]) => {
        (globalThis as any).document = {
            querySelector: (sel: string) => {
                if (sel === "a.synthesis") {
                    return tabs.includes("推荐") ? {click: () => clicked.push("推荐")} : null;
                }
                return null;
            },
            querySelectorAll: (sel: string) => {
                if (sel === "a.expect-item") {
                    return tabs
                        .filter(t => t !== "推荐")
                        .map(name => ({textContent: name, click: () => clicked.push(name)}));
                }
                return [];
            },
        };
    };

    const newScheduler = () =>
        new AutoPushScheduler((() => Promise.resolve()) as any, () => false) as any;

    beforeEach(() => {
        mocks.preference = {};
        clicked = [];
        (globalThis as any).window.location.reload = vi.fn();
        scheduler = newScheduler();
    });

    it("未开启自动切换标签 → 整页刷新，不点标签", async () => {
        mocks.preference = {autoPushE: true, autoSwitchTabE: false, autoSwitchTabNames: ["推荐", "前端"]};
        makeDocument(["推荐", "前端"]);
        await scheduler.refreshJobPool();
        expect(clicked).toEqual([]);
        expect((globalThis as any).window.location.reload).toHaveBeenCalledTimes(1);
    });

    it("仅一个标签 → 整页刷新，不点标签", async () => {
        mocks.preference = {autoPushE: true, autoSwitchTabE: true, autoSwitchTabNames: ["推荐"]};
        makeDocument(["推荐"]);
        await scheduler.refreshJobPool();
        expect(clicked).toEqual([]);
        expect((globalThis as any).window.location.reload).toHaveBeenCalledTimes(1);
    });

    it("两个标签：两次刷新交替点击不同标签（共享指针推进）", async () => {
        mocks.preference = {autoPushE: true, autoSwitchTabE: true, autoSwitchTabNames: ["推荐", "前端开发工程师(北京)"]};
        makeDocument(["推荐", "前端开发工程师(北京)"]);
        // 首次刷新 rot=0 → 点【推荐】；再次刷新 rot=1 → 点【前端开发工程师(北京)】
        await scheduler.refreshJobPool();
        await scheduler.refreshJobPool();
        expect(clicked).toEqual(["推荐", "前端开发工程师(北京)"]);
        expect((globalThis as any).window.location.reload).not.toHaveBeenCalled();
        // 共享指针已推进到 2
        expect(TampermonkeyApi.GmGetValue(TAB_ROTATION_COUNT_KEY, 0)).toBe(2);
    });

    it("指针已推进满一轮（rot=2，idx=0 且 rot>0）→ 整页刷新换全新池，不再点标签", async () => {
        mocks.preference = {autoPushE: true, autoSwitchTabE: true, autoSwitchTabNames: ["推荐", "前端开发工程师(北京)"]};
        makeDocument(["推荐", "前端开发工程师(北京)"]);
        // 预置共享指针已点过一轮（2 个标签）
        TampermonkeyApi.GmSetValue(TAB_ROTATION_COUNT_KEY, 2);
        await scheduler.refreshJobPool();
        expect(clicked).toEqual([]);
        expect((globalThis as any).window.location.reload).toHaveBeenCalledTimes(1);
    });

    it("目标标签在页面上不存在 → 点击失败，整页刷新兜底", async () => {
        mocks.preference = {autoPushE: true, autoSwitchTabE: true, autoSwitchTabNames: ["不存在的标签"]};
        makeDocument([]); // 页面无任何标签
        await scheduler.refreshJobPool();
        expect(clicked).toEqual([]);
        expect((globalThis as any).window.location.reload).toHaveBeenCalledTimes(1);
    });

    it("多页面串行：共享指针单调递增，各页面拿到不同 idx", async () => {
        mocks.preference = {autoPushE: true, autoSwitchTabE: true, autoSwitchTabNames: ["推荐", "前端开发工程师(北京)"]};
        makeDocument(["推荐", "前端开发工程师(北京)"]);
        // 模拟两个页面各自的调度器实例（同一 GM 存储）
        const schedulerB = newScheduler();
        await scheduler.refreshJobPool();  // 页面A：推荐
        await schedulerB.refreshJobPool(); // 页面B：前端
        await scheduler.refreshJobPool();  // 页面A：整页刷新（一轮点完）
        expect(clicked).toEqual(["推荐", "前端开发工程师(北京)"]);
        expect((globalThis as any).window.location.reload).toHaveBeenCalledTimes(1);
        expect(TampermonkeyApi.GmGetValue(TAB_ROTATION_COUNT_KEY, 0)).toBe(3);
    });
});
