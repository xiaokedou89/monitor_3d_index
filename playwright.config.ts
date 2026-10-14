import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test/e2e',
  // 软渲染（SwiftShader）帧驱动飞行对 CPU 竞争敏感：用例内部等待均有收敛条件，
  // 用例级超时放宽到 300s，保证高负载机器（无硬件 GPU、多进程竞争）下依然稳定。
  // 并行 worker 从默认 4 降到 2：4 路 SwiftShader 软渲染竞争 CPU 时帧率低至 ~1.3fps，
  // Playwright 点击稳定性检查（需 2 帧 rAF 采样）被饿死，出现点击重试超时类假失败。
  timeout: 300_000,
  workers: 2,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5199',
    viewport: { width: 1600, height: 900 },
    launchOptions: {
      executablePath: '/usr/bin/chromium',
      args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=swiftshader'],
    },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --port 5199 --strictPort',
    url: 'http://localhost:5199',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
