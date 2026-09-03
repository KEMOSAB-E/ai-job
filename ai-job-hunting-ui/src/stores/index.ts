import {reactive, ref} from 'vue'
import {defineStore} from 'pinia'
import {PreferenceConfig, User} from "./types";
import logger from "../logging";
import platform, {PlatformTypeEnum} from "../platform/platform";
import {TampermonkeyApi, Tools} from "../platform/utils";

// 本标签页今日投递成功数存储 key（sessionStorage：每标签页独立、同标签跨刷新保留、关标签清除）
const PAGE_DAILY_DATE_KEY = "pagePushDailyDate"
const PAGE_DAILY_COUNT_KEY = "pagePushDailyCount"

function loadPageDailyCount(): number {
    const today = Tools.getCurDay()
    if (sessionStorage.getItem(PAGE_DAILY_DATE_KEY) !== today) {
        return 0
    }
    const v = Number(sessionStorage.getItem(PAGE_DAILY_COUNT_KEY) ?? '0')
    return Number.isFinite(v) ? v : 0
}

export const pushResultCount = defineStore('pushResultCount', () => {
    const notMatchCount = ref(0)
    const successCount = ref(TampermonkeyApi.GmGetValue(TampermonkeyApi.PUSH_SUCCESS_COUNT, 0))
    const onceSuccessCount = ref(0)
    const failCount = ref(TampermonkeyApi.GmGetValue(TampermonkeyApi.PUSH_FAIL_COUNT, 0))
    // 本标签页今日累计投递成功数（跨天清零）
    const pageDailyCount = ref(loadPageDailyCount())

    function notMatchIncr() {
        notMatchCount.value++
    }

    function successIncr() {
        successCount.value++
        onceSuccessCount.value++
        TampermonkeyApi.GmSetValue(TampermonkeyApi.PUSH_SUCCESS_COUNT, successCount.value)
        // 每日投递计数：跨天自动清零
        const today = Tools.getCurDay()
        if (TampermonkeyApi.GmGetValue(TampermonkeyApi.PUSH_DAILY_DATE, "") !== today) {
            TampermonkeyApi.GmSetValue(TampermonkeyApi.PUSH_DAILY_DATE, today)
            TampermonkeyApi.GmSetValue(TampermonkeyApi.PUSH_DAILY_COUNT, 0)
        }
        const daily = TampermonkeyApi.GmGetValue(TampermonkeyApi.PUSH_DAILY_COUNT, 0)
        TampermonkeyApi.GmSetValue(TampermonkeyApi.PUSH_DAILY_COUNT, daily + 1)

        // 本标签页今日投递计数：跨天清零后自增
        if (sessionStorage.getItem(PAGE_DAILY_DATE_KEY) !== today) {
            sessionStorage.setItem(PAGE_DAILY_DATE_KEY, today)
            pageDailyCount.value = 0
        }
        pageDailyCount.value++
        sessionStorage.setItem(PAGE_DAILY_COUNT_KEY, String(pageDailyCount.value))
    }

    function failIncr() {
        failCount.value++
        TampermonkeyApi.GmSetValue(TampermonkeyApi.PUSH_FAIL_COUNT, failCount.value)
    }

    function clearOnceSuccessCount() {
        onceSuccessCount.value = 0
    }

    return {
        notMatchIncr,
        successIncr,
        notMatchCount,
        successCount,
        failCount,
        failIncr,
        onceSuccessCount,
        clearOnceSuccessCount,
        pageDailyCount
    }
})

export const UserStore = defineStore('ai-user', () => {

    const platformType = ref<number>()
    const user = reactive<User>(getLocalUser())
    return {
        user,
        platformType
    };
})


export const LoginStore = defineStore('LoginStore', () => {

    const login = ref<false | true>()
    const loginFailStatus = ref<false | true>()

    function loginSuccess() {
        login.value = true
    }

    function loginFail() {
        loginFailStatus.value = true
    }

    return {
        login, loginSuccess, loginFailStatus, loginFail
    };
})


function getLocalUser(): User {
    const map = new Map<PlatformTypeEnum, PreferenceConfig>();
    let jsonData = localStorage.getItem("ai-job-user");
    if (jsonData === null) {
        jsonData = '{"phone":"","email":"","preference":{},"preferenceMap":{}}'
    }
    let user = JSON.parse(jsonData) as User;
    logger.debug("获取本地用户配置", user)
    return user;
}


export const ProductStore = defineStore('ProductStore', () => {

    const showProduct = ref<false | true>(false)

    function setShowProduct(show: boolean) {
        showProduct.value = show
    }

    return {
        showProduct, setShowProduct
    };
})