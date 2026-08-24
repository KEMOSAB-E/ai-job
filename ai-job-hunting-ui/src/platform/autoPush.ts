import {TampermonkeyApi, Tools} from "./utils";
import {UserStore} from "../stores";
import {LogRecorder} from "../logging/record";

const logRecorder = new LogRecorder("autoPush");

// 每小时投递槽位（工作日），按小时均分每日目标
const PUSH_SLOTS: { start: number, end: number }[] = [
    {start: 10 * 60, end: 11 * 60},       // 10:00 - 11:00
    {start: 11 * 60, end: 11 * 60 + 30},  // 11:00 - 11:30
    {start: 14 * 60, end: 15 * 60},       // 14:00 - 15:00
    {start: 15 * 60, end: 16 * 60},       // 15:00 - 16:00
    {start: 16 * 60, end: 17 * 60},       // 16:00 - 17:00
];

// 每个槽位的权重（前多后少，中等递减），与 PUSH_SLOTS 一一对应
const SLOT_WEIGHTS = [4, 3, 3, 2, 1];

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

function getCurrentSlot(date: Date): number {
    const m = minutesOfDay(date);
    return PUSH_SLOTS.findIndex(s => m >= s.start && m < s.end); // 不在窗口内返回 -1
}

function isAfterLastSlot(date: Date): boolean {
    const last = PUSH_SLOTS[PUSH_SLOTS.length - 1];
    return minutesOfDay(date) >= last.end;
}

// 动态配额：把剩余缺口按权重分摊到当前及之后的所有槽位。
// 前面槽位没投够的量会自动平滑滚到后续槽位，最后槽位自然兜底（配额=剩余缺口）。
function computeSlotQuota(remaining: number, slotIndex: number): number {
    let weightSum = 0;
    for (let i = slotIndex; i < SLOT_WEIGHTS.length; i++) {
        weightSum += SLOT_WEIGHTS[i];
    }
    return Math.round(remaining * SLOT_WEIGHTS[slotIndex] / weightSum);
}

/**
 * 自动定时投递调度器。
 * 核心逻辑：工作日 + 时间窗内，按权重把当日目标分摊到每个槽位（前多后少）、每槽位投一批；
 * 剩余缺口按权重动态平滑滚到后续槽位，最后槽位兜底投满；批间冷却 15-30 分钟随机；
 * 投递完成后若未达标则刷新页面加载新岗位。
 */
export class AutoPushScheduler {
    private timer: number | null = null;
    private pushing = false;
    private lastBatchAt = 0;
    private cooldownMs = 0;
    private lastPushedSlotKey = ""; // 本槽位是否已投过一批（非最后槽位每个小时只投一批）
    private currentSlotKey = "";    // 用于检测槽位切换、重置冷却/抖动

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

        const slotIndex = getCurrentSlot(now);

        // 最后一窗结束后：未达标则上报缺口（每天一次）
        if (slotIndex < 0 && isAfterLastSlot(now)) {
            this.reportGapOnce(target, count);
            return;
        }

        // 不在窗口内（清晨/午休等）
        if (slotIndex < 0) {
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

        const slot = PUSH_SLOTS[slotIndex];
        const slotKey = `${Tools.getCurDay()}:${slot.start}`;
        const isLast = slotIndex === PUSH_SLOTS.length - 1;

        // 非最后槽位：每个小时只投一批，投过即等下一个槽位
        if (!isLast && this.lastPushedSlotKey === slotKey) {
            return;
        }

        // 进入新槽位：冷却重置为随机抖动（0-10 分钟，避免整点扎堆）
        if (this.currentSlotKey !== slotKey) {
            this.currentSlotKey = slotKey;
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

        // 计算本批上限：剩余缺口按权重动态分摊到当前及之后槽位（前面没投够的平滑滚到后面）
        const remaining = target - count;
        const batchLimit = Math.min(computeSlotQuota(remaining, slotIndex), remaining);

        if (batchLimit <= 0) {
            return;
        }

        logRecorder.info(`本批投递上限 ${batchLimit}（剩余 ${remaining}）`);

        // 触发一批投递
        this.lastBatchAt = Date.now();
        this.cooldownMs = Tools.getRandomNumber(COOLDOWN_MIN_MS, COOLDOWN_MAX_MS);
        if (!isLast) this.lastPushedSlotKey = slotKey;
        this.pushing = true;
        this.startBatch(batchLimit)
            .catch(e => {
                logRecorder.error("自动投递批次异常", e);
            })
            .finally(() => {
                this.pushing = false;
                // 投递完成后若仍未达标且自动投递仍开启，刷新页面加载新岗位（每日进度存 GM，刷新后保留）
                if (UserStore().user.preference?.autoPushE && this.getDailyCount() < target) {
                    window.setTimeout(() => window.location.reload(), 5000);
                }
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
