import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://localhost:5199/?debug=1');
await page.waitForSelector('.hud-title', { timeout: 30000 });
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
    return `${label}: ${patchAvg(p.x, p.y).join(',')}`;
  };
  const lines = [];
  lines.push(probe(-60, 5, '土耳其(陆地)'));      // 欧洲-亚洲陆地
  lines.push(probe(-90, 10, '法国(陆地)'));       // 欧洲
  lines.push(probe(34, -10, '北海道(陆地)'));     // 亚洲东缘
  lines.push(probe(27, 20, '澳大利亚(陆地)'));    // 大洋洲
  lines.push(probe(68.4, 0, '白令海(海洋)'));     // 应≈背景
  lines.push(probe(0, 46, '印度洋(海洋)'));       // 应≈背景
  lines.push(probe(100, 5, '加州(陆地,A布局)'));  // 美洲（A 布局应入画）
  lines.push(probe(-102.6, 8, '伊比利亚(陆地,最左端)')); // 欧洲最左
  lines.push({ x: 50, y: 50, label: '角落背景' });
  const corner = lines.pop();
  lines.push(`${corner.label}: ${patchAvg(corner.x, corner.y).join(',')}`);
  const fillColor = dbg.scene.getObjectByName('world-backdrop').material.color.getHexString();
  const outline = dbg.scene.getObjectByName('world-backdrop-outline');
  return { fillColor, outlineVerts: outline?.geometry.attributes.position.count, fov: cam.fov, lines };
});
console.log(JSON.stringify(res, null, 2));
await browser.close();
