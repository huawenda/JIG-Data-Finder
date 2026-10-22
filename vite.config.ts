import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// Tauri 需要固定端口, 不能自动回退
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Tauri 使用自定义协议, 必须指向 src-tauri/tauri.conf.json
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      /*
       * ignored 里前两条防的是同一个坑:
       *   编辑工具保存文件时会先在同目录建一个隐藏暂存目录
       *   (形如 src/.App.tsx.<uuid>.tmpdir/App.tsx.tmp) 再改名。
       *   Vite 的 watcher 扫到就 EBUSY —— Windows 上 rename 期间的
       *   文件句柄还没释放, fs.watch 直接抛 'resource busy or locked',
       *   Node 进程整个崩掉, tauri dev 跟着报
       *   'The "beforeDevCommand" terminated with a non-zero status code'。
       *   已经因此连崩四次, 且报错信息里只有那个临时路径, 很容易
       *   误判成自己的代码有问题。
       */
      ignored: [
        '**/src-tauri/**',
        '**/*.tmpdir/**',
        '**/.*.tmpdir/**',
      ],
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'chrome105',
    minify: 'esbuild',
    sourcemap: false,
    outDir: 'dist',
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    /*
     * 固定单 fork 跑, 不要改回默认的多 worker。
     *
     * 多 worker 并行时 Node 的 compile cache 会被多个进程同时写同一个文件,
     * 偶发 EPERM 导致个别测试文件**根本没被加载** —— 输出变成
     * "7 passed" 而不是 8, 但退出码依然是 0, 闸门于是假通过。
     * 这个坑不报错、不红字, 只少一行, 极难发现。
     *
     * 全部 128 个测试单进程跑完 1 秒出头, 确定性远比这点并行收益重要。
     */
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
} as never)