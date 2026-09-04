import {defineConfig} from "vitest/config";
import {fileURLToPath} from "node:url";

export default defineConfig({
    resolve: {
        alias: {
            // 将 Tampermonkey 虚拟模块 `$` 指向本地内存 mock
            "$": fileURLToPath(new URL("./test/mocks/tampermonkey.ts", import.meta.url)),
        },
    },
    test: {
        environment: "node",
        setupFiles: [fileURLToPath(new URL("./test/setup.ts", import.meta.url))],
        include: ["src/**/__tests__/**/*.spec.ts"],
    },
});
