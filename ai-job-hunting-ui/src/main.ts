import {createApp} from 'vue';
import './style.css';
import 'element-plus/dist/index.css'
import PlatformFactory, {Platform} from "./platform/platform";
import App from './App.vue';
import logger, {Logger, LogLevel} from "./logging";
import './webSocket/hookMain'
import {createPinia} from 'pinia'
import axios from "./axios";
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import {isProdEnv} from "./utils/tools";

import {ServerStore} from "./stores/server";

const app = createApp(App);
if (!isProdEnv()) {
    Logger.setGlobalLogLevel(LogLevel.Debug)
}
const pinia = createPinia()
app.use(pinia)

// 初始化服务器检查
const serverStore = ServerStore(pinia)
serverStore.checkConnection()

// 使用本地化语言包(主要是运行记录中时间筛选组件显示中文)
app.use(ElementPlus, {
    locale: zhCn,
})

// 创建平台
const platform: Platform = PlatformFactory.getInstance(location.href);
app.provide('$platform', platform)
app.provide('$axios', axios)

// 挂载
const rootApp = document.createElement('div');
rootApp.id = "ai-job"
rootApp.classList.add('page-job-content');

// 先挂载到离屏容器，再等平台挂载元素出现后移入 DOM。
// 不依赖 window.onload：Tampermonkey 默认 document-idle 运行，
// 若页面 load 事件已先触发，window.onload 回调永远不会执行，导致面板偶发不渲染。
app.mount(rootApp);
platform.getMountEle().then(elP => {
    let containerEle = elP.el
    let p = elP.p
    if (p === "end") {
        containerEle.appendChild(rootApp)
    } else {
        containerEle.insertBefore(
            rootApp,
            containerEle.firstElementChild
        );
    }
})

