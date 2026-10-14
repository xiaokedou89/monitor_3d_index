import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://localhost:5199/?debug=1');
await page.waitForSelector('.hud-title', { timeout: 30000 });
await page.waitForTimeout(2500);
const probeBoth = async (layout) => {
  await page.evaluate((l) => {
    const dbg = window.__sceneDbg;
    dbg.settingsStore.set({ mapLayout: l });
    // 同步等 view-sync 应用布局（等一帧）
  }, layout);
  await page.waitForTimeout(1200);
  return page.evaluate(() => {
    const dbg = window.__sceneDbg;
    const cam = dbg.camera;
    const V3 = dbg.scene.children[0].position.constructor;
    const toScreen = (x, y, z) => {
      const v = new V3(x, y, z).project(cam);
      const r = dbg.renderer.domElement.getBoundingClientRect();
      return { x: Math.round(r.left + (v.x * 0.5 + 0.5) * r.width), y: Math.round(r.top + (-v.y * 0.5 + 0.5) * r.height) };
    };
    const canvas = dbg.renderer.domElement;
    const ctx = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const readPx = (x, y) => {
      const buf = new Uint8Array(4);
      ctx.readPixels(x, canvas.height - y, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, buf);
      return [buf[0], buf[1], buf[2]];
    };
    const patchAvg = (x, y, n = 10) => {
      let r = 0, g = 0, b = 0, c = 0;
      for (let i = -n; i <= n; i += 2) for (let j = -n; j <= n; j += 2) {
        const p = readPx(x + i, y + j); r += p[0]; g += p[1]; b += p[2]; c++;
      }
      return [Math.round(r / c), Math.round(g / c), Math.round(b / c)];
    };
    const probe = (x, z, label) => {
      const p = toScreen(x, -0.4, z);
      if (p.x < 0 || p.x >= canvas.width || p.y < 0 || p.y >= canvas.height) return `${label}: offscreen`;
      return `${label}: ${patchAvg(p.x, p.y).join(',')}`;
    };
    const a = dbg.scene.getObjectByName('world-backdrop');
    const b = dbg.scene.getObjectByName('world-backdrop-b');
    return {
      visA: a.visible, visB: b.visible,
      lines: [
        probe(-102.6, -5, '伊比利亚(欧洲最左)'),
        probe(-85, -22, '北欧(斯堪的纳维亚)'),
        probe(120, -2, '加州(美洲西岸)'),
        probe(110, 8, '下加州/墨西哥'),
        probe(-60, 5, '土耳其'),
        probe(34, -10, '北海道'),
        probe(27, 55, '澳大利亚'),
        probe(0, 46, '印度洋(海洋)'),
      ],
    };
  });
};
const A = await probeBoth('china-centered');
const B = await probeBoth('linear');
console.log('A 布局:', JSON.stringify(A, null, 2));
console.log('B 布局:', JSON.stringify(B, null, 2));
await browser.close();
