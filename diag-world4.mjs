import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://localhost:5199/?debug=1');
await page.waitForSelector('.hud-title', { timeout: 30000 });
await page.waitForTimeout(2500);
await page.evaluate(() => {
  const dbg = window.__sceneDbg;
  for (const n of ['world-backdrop', 'world-backdrop-b']) {
    const m = dbg.scene.getObjectByName(n);
    m.material.opacity = 1;
    m.material.color.set(0xff0000);
    m.material.needsUpdate = true;
    m.visible = true; // 两套都显示以便同时检查
  }
});
await page.waitForTimeout(2500);
const res = await page.evaluate(() => {
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
    const px = patchAvg(p.x, p.y);
    return `${label}(${x},${z}) px=${px} ${px[0] > 60 ? 'RED' : 'bg'}`;
  };
  const lines = [];
  // z=46（lat -16）：斐济反经线带检测，全部应为海洋
  for (const x of [-200, -100, 0, 50]) lines.push(probe(x, 46, 'ocean-z46'));
  // z=-38（lat 77）：北极——x=0 泰梅尔陆地红，x=68 楚科奇北海洋应 bg（Wrangel 带检测）
  for (const x of [0, 68]) lines.push(probe(x, -38, 'arctic'));
  // z=0（lat 35）：A 布局美洲大陆检测
  for (const x of [100, 150, 200]) lines.push(probe(x, 0, 'americas'));
  // 欧洲 z=5（lat 29.4）：x=-60（黑海/土耳其陆地）应红
  lines.push(probe(-60, 5, 'europe'));
  return lines;
});
console.log(res.join('\n'));
await browser.close();
