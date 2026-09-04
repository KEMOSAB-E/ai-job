import logger, {Logger, LogLevel} from "./index";
import { TampermonkeyApi } from "../platform/utils";

// 页面来源标签：本标签页会话内唯一，用于区分多标签页产生的日志
// （如 jobs?jobType=1901 与 jobs?jobType=1901&scale=303,304）
const PAGE_TAG = (() => {
    try {
        const path = location.pathname.split("/").filter(Boolean).pop() || "";
        return path + location.search;
    } catch {
        return "";
    }
})();

// 生成 YYYY-MM-DD 日期
function formatDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

// 日志条目：id 用于跨页面合并去重；date/timestamp 分别存日期与时间，时间筛选保持兼容
export interface LogEntry {
    id: string;
    level: string;
    message: string;
    page: string;
    date: string;
    timestamp: string;
}

export class LogRecorder extends Logger {
    private static readonly LOGS_STORAGE_KEY = "logs_data";
    private persistTimer: number | null = null;
    private static logs: LogEntry[] = [];
    private static seq = 0;

    constructor(name: string = "") {
        super(name);
        this.loadLogsFromStorage();
        this.startPersistTimer();
    }

    private loadLogsFromStorage() {
        const storedLogs = TampermonkeyApi.GmGetValue(LogRecorder.LOGS_STORAGE_KEY, []);
        // 通过 id 去重（旧版本条目无 id，用 页面+日期+时间+内容 兜底生成），避免重复加载历史日志
        const existingIds = new Set(LogRecorder.logs.map(log => log.id));
        storedLogs.forEach((log: any) => {
            const id = log.id || `${log.page || ""}:${log.date || ""}:${log.timestamp}:${log.message}`;
            if (!existingIds.has(id)) {
                existingIds.add(id);
                LogRecorder.logs.push({
                    id,
                    level: log.level,
                    message: log.message,
                    page: log.page || "",
                    date: log.date || "",
                    timestamp: log.timestamp,
                });
            }
        });
        this.trimAndSort();
    }

    private startPersistTimer() {
        this.persistTimer = window.setInterval(() => {
            this.persistLogs();
        }, 10000);
    }

    private persistLogs() {
        // 合并写：读取已存日志，与本地按 id 去重后写回，避免多标签页互相覆盖丢日志
        const storedLogs = TampermonkeyApi.GmGetValue(LogRecorder.LOGS_STORAGE_KEY, []) as LogEntry[];
        const merged: LogEntry[] = [...storedLogs];
        const existingIds = new Set(merged.map(log => log.id));
        LogRecorder.logs.forEach(log => {
            if (!existingIds.has(log.id)) {
                existingIds.add(log.id);
                merged.push(log);
            }
        });
        merged.sort((a, b) => `${a.date} ${a.timestamp}`.localeCompare(`${b.date} ${b.timestamp}`));
        TampermonkeyApi.GmSetValue(LogRecorder.LOGS_STORAGE_KEY, merged.slice(-this.maxLogs));
    }

    public clearLogs() {
        LogRecorder.logs = [];
        TampermonkeyApi.GmSetValue(LogRecorder.LOGS_STORAGE_KEY, []);
    }

    // 设置日志存储的最大条数
    private maxLogs = 1000;

    private trimAndSort() {
        LogRecorder.logs.sort((a, b) => `${a.date} ${a.timestamp}`.localeCompare(`${b.date} ${b.timestamp}`));
        if (LogRecorder.logs.length > this.maxLogs) {
            LogRecorder.logs.splice(0, LogRecorder.logs.length - this.maxLogs);
        }
    }

    private addLog(level: string, message: string) {
        const now = new Date();
        const entry: LogEntry = {
            id: `${PAGE_TAG}:${now.getTime()}:${LogRecorder.seq++}`,
            level,
            message: PAGE_TAG ? `[${PAGE_TAG}] ${message}` : message,
            page: PAGE_TAG,
            date: formatDate(now),
            timestamp: now.toLocaleTimeString(),
        };
        LogRecorder.logs.push(entry);
        if (LogRecorder.logs.length > this.maxLogs) {
            LogRecorder.logs.shift();
        }
    }

    error(...messages: any[]) {
        const msg = messages.join(' ');
        this.addLog('error', msg);
        super.error(msg);
    }

    warn(...messages: any[]) {
        const msg = messages.join(' ');
        this.addLog('warn', msg);
        super.warn(msg);
    }

    info(...messages: any[]) {
        const msg = messages.join(' ');
        this.addLog('info', msg);
        super.info(msg);
    }

    debug(...messages: any[]) {
        const msg = messages.join(' ');
        this.addLog('debug', msg);
        super.debug(msg);
    }

    trace(...messages: any[]) {
        const msg = messages.join(' ');
        this.addLog('trace', msg);
        super.trace(msg);
    }

    // 获取日志数据，支持分页
    getLogs(page: number, pageSize: number) {
        const start = (page - 1) * pageSize;
        return LogRecorder.logs.slice(start, start + pageSize);
    }

    // 获取日志总条数
    getLogCount() {
        return LogRecorder.logs.length;
    }
}
