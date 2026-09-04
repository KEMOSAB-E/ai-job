// 内存版 Tampermonkey API：替换 vite-plugin-monkey 的 `$` 虚拟模块，供 vitest 使用。
// 被测模块（platform/utils、logging/record）通过 TampermonkeyApi 包装这些函数，
// CUR_CK 默认为 ""，因此直接以原始 key 读写。
const store = new Map<string, any>();

export function GM_getValue(key: string, defVal: any = undefined): any {
    return store.has(key) ? store.get(key) : defVal;
}

export function GM_setValue(key: string, val: any): void {
    store.set(key, val);
}

export function GM_deleteValue(key: string): void {
    store.delete(key);
}

export function GM_addValueChangeListener(_name: string, _fn: (...args: any[]) => void): number {
    return 0;
}

export function GM_notification(..._args: any[]): void {
}

export function GM_xmlhttpRequest(..._args: any[]): void {
}

export const unsafeWindow: any = globalThis;

// ---- 测试辅助 ----
export function __resetGMStore(): void {
    store.clear();
}
