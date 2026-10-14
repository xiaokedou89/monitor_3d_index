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
  // 用 debug 面板像素读取：canvas 本身
  const canvas = dbg.renderer.domElement;
  const ctx = canvas.getContext('webgl2') || canvas.getContext('webgl');
  const readPx = (x, y) => {
    const buf = new Uint8Array(4);
    ctx.readPixels(x, canvas.height - y, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, buf);
    return [buf[0], buf[1], buf[2]];
  };
  const bg = dbg.sceneColor();
  const pts = {
    tokyo: toScreen(68.4, -0.4, 0),
    sydney: toScreen(34, -0.4, -10),
    eastAsia: toScreen(50, -0.4, -5),
    beijing: toScreen(0, 0.01, 0),   // 中国顶面（应=地图色）
    offChina: toScreen(40, -0.4, -5),
    corner: { x: 50, y: 50 },        // 画布角落（纯背景）
  };
  const res = {};
  for (const [k, p] of Object.entries(pts)) {
    if (p.x < 0 || p.x >= canvas.width || p.y < 0 || p.y >= canvas.height) { res[k] = 'offscreen'; continue; }
    res[k] = readPx(p.x, p.y);
  }
  const worldMat = dbg.scene.getObjectByName('world-backdrop').material;
  const wall = dbg.settingsStore.get().style.wall;
  return JSON.stringify({ bg, wall, worldColor: '#' + worldMat.color.getHexString(), res, canvasSize: [canvas.width, canvas.height] }, null, 2);
});
console.log(info);
await browser.close();
