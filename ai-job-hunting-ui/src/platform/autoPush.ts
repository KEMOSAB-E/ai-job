import {TampermonkeyApi, Tools} from "./utils";
import {UserStore} from "../stores";
import {LogRecorder} from "../logging/record";

const logRecorder = new LogRecorder("autoPush");

// 时间窗（工作日）
const TIME_WINDOWS: { start: [number, number], end: [number, number] }[] = [
    {start: [10, 0], end: [11, 30]},
    {start: [14, 0], end: [17, 0]},
];

// 批间冷却范围（毫秒）：15 - 30 分钟
const COOLDOWN_MIN_MS = 15 * 60 * 1000;
const COOLDOWN_MAX_MS = 30 * 60 * 1000;

// 进入时间窗后的首个随机抖动（毫秒）：0 - 10 分钟，避免整点同时投递
const WINDOW_JITTER_MAX_MS = 10 * 60 * 1000;

function isWorkday(date: Date): boolean {
    const day = date.getDay();
    return day >= 1 && day <= 5; // 周一到周五
}

function minutesOfDay(date: Date): number {
    return date.getHours() * 60 + date.getMinutes();
}

function isInWindow(date: Date): boolean {
    const m = minutesOfDay(date);
    return TIME_WINDOWS.some(w => m >= w.start[0] * 60 + w.start[1] && m < w.end[0] * 60 + w.end[1]);
}

function isAfterLastWindow(date: Date): boolean {
    const last = TIME_WINDOWS[TIME_WINDOWS.length - 1];
    return minutesOfDay(date) >= last.end[0] * 60 + last.end[1];
}

/**
 * 自动定时投递调度器。
 * 核心逻辑：工作日 + 时间窗内 + 未达今日目标 + 非投递中 → 触发一批投递（批上限 = 剩余缺口），
 * 批间冷却 15-30 分钟随机；窗口结束后若未达标则上报缺口。
 */
export class AutoPushScheduler {
    private timer: number | null = null;
    private pushing = false;
    private lastBatchAt = 0;
    private cooldownMs = 0;
    private jitterApplied = false;

    private readonly startBatch: (gap: number) => Promise<void>;
    private readonly isPushing: () => boolean;

    constructor(startBatch: (gap: number) => Promise<void>, isPushing: () => boolean) {
        this.startBatch = startBatch;
        this.isPushing = isPushing;
    }

    start(intervalMs: number = 30 * 1000) {
        this.stop();
        this.timer = window.setInterval(() => this.tick(), intervalMs);
        logRecorder.info("自动投递调度器已启动");
        // 立即评估一次，避免等待首个周期
        this.tick();
    }

    stop() {
        if (this.timer !== null) {
            window.clearInterval(this.timer);
            this.timer = null;
        }
    }

    private tick() {
        const userStore = UserStore();
        const pref = userStore.user.preference;

        // 自动投递未开启 / 未设置每日上限
        if (!pref?.autoPushE) {
            return;
        }
        const dailyLimit = pref.dailyPushLimit;
        if (!dailyLimit || dailyLimit <= 0) {
            return;
        }

        const now = new Date();

        // 工作日
        if (!isWorkday(now)) {
            return;
        }

        // 会话失效：等待用户重新登录
        if (TampermonkeyApi.GmGetValue(TampermonkeyApi.SESSION_INVALID, false)) {
            if (Tools.getCookieValue("bst")) {
                TampermonkeyApi.GmSetValue(TampermonkeyApi.SESSION_INVALID, false);
            } else {
                return;
            }
        }

        // 平台当日投递限制
        if (TampermonkeyApi.GmGetValue(TampermonkeyApi.PUSH_LIMIT, false)) {
            return;
        }

        const target = this.ensureDailyTarget(dailyLimit);
        const count = this.getDailyCount();

        const inWindow = isInWindow(now);

        // 最后一窗结束后：未达标则上报缺口（每天一次）
        if (!inWindow && isAfterLastWindow(now)) {
            this.reportGapOnce(target, count);
            return;
        }

        // 窗口间隙（如午休），重置抖动标记
        if (!inWindow) {
            this.jitterApplied = false;
            return;
        }

        // 已达标
        if (count >= target) {
            return;
        }

        // 正在投递中（手动或上一批）
        if (this.pushing || this.isPushing()) {
            return;
        }

        // 进入窗口后的随机抖动
        if (!this.jitterApplied) {
            this.jitterApplied = true;
            this.lastBatchAt = Date.now();
            this.cooldownMs = Tools.getRandomNumber(0, WINDOW_JITTER_MAX_MS);
        }

        // 冷却中
        if (Date.now() - this.lastBatchAt < this.cooldownMs) {
            return;
        }

        // 登录检查
        if (!Tools.window?._PAGE?.token) {
            return;
        }

        // 触发一批投递，批上限 = 剩余缺口
        const gap = target - count;
        this.lastBatchAt = Date.now();
        this.cooldownMs = Tools.getRandomNumber(COOLDOWN_MIN_MS, COOLDOWN_MAX_MS);
        this.pushing = true;
        this.startBatch(gap)
            .catch(e => {
                logRecorder.error("自动投递批次异常", e);
            })
            .finally(() => {
                this.pushing = false;
            });
    }

    private ensureDailyTarget(dailyLimit: number): number {
        const today = Tools.getCurDay();
        const savedDate = TampermonkeyApi.GmGetValue(TampermonkeyApi.PUSH_DAILY_TARGET_DATE, "");
        if (savedDate === today) {
            const saved = TampermonkeyApi.GmGetValue(TampermonkeyApi.PUSH_DAILY_TARGET, 0);
            if (saved > 0) {
                return Math.min(saved, dailyLimit);
            }
        }
        // 每天随机取一个目标值：在 [dailyLimit-20, dailyLimit] 内（如上限 80 → 60-80）
        const min = Math.max(1, dailyLimit - 20);
        const target = Tools.getRandomNumber(min, dailyLimit);
        TampermonkeyApi.GmSetValue(TampermonkeyApi.PUSH_DAILY_TARGET_DATE, today);
        TampermonkeyApi.GmSetValue(TampermonkeyApi.PUSH_DAILY_TARGET, target);
        logRecorder.info(`今日投递目标：${target}（上限 ${dailyLimit}）`);
        return target;
    }

    private getDailyCount(): number {
        const today = Tools.getCurDay();
        const date = TampermonkeyApi.GmGetValue(TampermonkeyApi.PUSH_DAILY_DATE, "");
        if (date !== today) {
            return 0;
        }
        return TampermonkeyApi.GmGetValue(TampermonkeyApi.PUSH_DAILY_COUNT, 0);
    }

    private reportGapOnce(target: number, count: number) {
        const today = Tools.getCurDay();
        if (TampermonkeyApi.GmGetValue(TampermonkeyApi.PUSH_DAILY_GAP_REPORTED, "") === today) {
            return;
        }
        if (count >= target) {
            return;
        }
        TampermonkeyApi.GmSetValue(TampermonkeyApi.PUSH_DAILY_GAP_REPORTED, today);
        const msg = `今日投递不足：目标 ${target} 实际 ${count}`;
        logRecorder.warn(msg);
        TampermonkeyApi.GmNotification(msg);
    }
}
