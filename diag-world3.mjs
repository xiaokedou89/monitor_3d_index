import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://localhost:5199/?debug=1');
await page.waitForSelector('.hud-title', { timeout: 30000 });
await page.waitForTimeout(2500);
const info = await page.evaluate(() => {
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
  const tokyo = toScreen(68.4, -0.4, 0);
  const patchAvg = (x, y, n = 12) => {
    let r = 0, g = 0, b = 0, c = 0;
    for (let i = -n; i <= n; i += 2) for (let j = -n; j <= n; j += 2) {
      const p = readPx(x + i, y + j); r += p[0]; g += p[1]; b += p[2]; c++;
    }
    return [Math.round(r / c), Math.round(g / c), Math.round(b / c)];
  };
  const worldA = dbg.scene.getObjectByName('world-backdrop');
  const before = { tokyo: patchAvg(tokyo.x, tokyo.y) };
  // 强制红色高亮世界网格（透明度 1，仅用于诊断渲染路径）
  worldA.material.opacity = 1;
  worldA.material.color.set(0xff0000);
  worldA.material.needsUpdate = true;
  const info1 = { drawCalls: dbg.renderer.info.render.calls, triangles: dbg.renderer.info.render.triangles };
  // 等一帧渲染
  const after = {};
  requestAnimationFrame(() => requestAnimationFrame(() => {
    after.tokyo = patchAvg(tokyo.x, tokyo.y);
  }));
  return { tokyoPt: tokyo, before, after, info1, layerDim: worldA.material.userData };
});
console.log(JSON.stringify(info, null, 2));
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const worldA = window.__sceneDbg.scene.getObjectByName('world-backdrop');
  worldA.material.opacity = 1;
  worldA.material.color.set(0xff0000);
});
await page.waitForTimeout(2000);
const after = await page.evaluate(() => {
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
  const patchAvg = (x, y, n = 12) => {
    let r = 0, g = 0, b = 0, c = 0;
    for (let i = -n; i <= n; i += 2) for (let j = -n; j <= n; j += 2) {
      const p = readPx(x + i, y + j); r += p[0]; g += p[1]; b += p[2]; c++;
    }
    return [Math.round(r / c), Math.round(g / c), Math.round(b / c)];
  };
  const tokyo = toScreen(68.4, -0.4, 0);
  const sydney = toScreen(34, -0.4, -10);
  const paris = toScreen(-102.6, -0.4, 0);
  const wash = toScreen(77.4, -0.4, 0);
  const corner = { x: 50, y: 50 };
  const pick = (p) => (p.x < 0 || p.x >= canvas.width || p.y < 0 || p.y >= canvas.height ? 'offscreen' : patchAvg(p.x, p.y));
  return { tokyo: pick(tokyo), sydney: pick(sydney), paris: pick(paris), wash: pick(wash), corner: pick(corner) };
});
console.log('after-red:', JSON.stringify(after));
await browser.close();
