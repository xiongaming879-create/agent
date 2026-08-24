import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // 测试从根目录运行,而 client 源码会解析到 client/node_modules,
    // dedupe 保证 pinia/vue 全局唯一实例(否则 setActivePinia 对 store 无效)
    dedupe: ['pinia', 'vue'],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
