import {beforeEach, describe, expect, it} from "vitest";
import {LogRecorder} from "../record";
import {GM_getValue, GM_setValue} from "../../../test/mocks/tampermonkey";

const LOGS_KEY = "logs_data";

// 清空模块级静态日志，避免用例间累积
function resetStaticLogs() {
    (LogRecorder as any).logs = [];
}

describe("LogRecorder（页面来源/日期/合并写）", () => {
    beforeEach(() => {
        resetStaticLogs();
    });

    it("addLog 条目带页面前缀、date、page 与唯一 id", () => {
        const lr = new LogRecorder("t");
        lr.info("点击标签【推荐】刷新职位池");

        const logs = lr.getLogs(1, 10) as any[];
        expect(logs.length).toBe(1);
        expect(logs[0].message).toBe("[jobs?jobType=1901] 点击标签【推荐】刷新职位池");
        expect(logs[0].page).toBe("jobs?jobType=1901");
        expect(logs[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(logs[0].timestamp).toMatch(/^\d{1,2}:\d{2}:\d{2}/);
        expect(logs[0].id).toBeTruthy();

        // 同一页面内不同条目的 id 唯一
        lr.warn("另一条日志");
        const logs2 = lr.getLogs(1, 10) as any[];
        expect(logs2[0].id).not.toBe(logs2[1].id);
    });

    it("persistLogs 合并写：保留 GM 中已有的其他页面日志，不互相覆盖", () => {
        // 预置其他页面写入的历史日志（旧格式，无 id/page/date）
        GM_setValue(LOGS_KEY, [{level: "info", message: "其他页面的历史日志", timestamp: "09:00:00"}]);

        const lr = new LogRecorder("t"); // 构造时会把 GM 中已有日志读入内存
        lr.info("本地新日志");
        (lr as any).persistLogs();

        const stored = GM_getValue(LOGS_KEY, []) as any[];
        const messages = stored.map(l => l.message);
        expect(messages).toContain("其他页面的历史日志");
        expect(messages).toContain("[jobs?jobType=1901] 本地新日志");
    });

    it("同 id 重复 persist 不产生重复条目", () => {
        const lr = new LogRecorder("t");
        lr.info("同一条日志");
        (lr as any).persistLogs();
        (lr as any).persistLogs();
        (lr as any).persistLogs();

        const stored = GM_getValue(LOGS_KEY, []) as any[];
        expect(stored.filter(l => l.message.includes("同一条日志")).length).toBe(1);
    });

    it("clearLogs 清空 GM 与内存", () => {
        const lr = new LogRecorder("t");
        lr.info("要清空的日志");
        (lr as any).persistLogs();
        expect(GM_getValue(LOGS_KEY, []).length).toBe(1);

        lr.clearLogs();
        expect(lr.getLogCount()).toBe(0);
        expect(GM_getValue(LOGS_KEY, [])).toEqual([]);
    });
});
