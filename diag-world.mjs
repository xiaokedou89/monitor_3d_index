import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://localhost:5199/?debug=1');
await page.waitForSelector('.hud-title', { timeout: 30000 });
await page.waitForTimeout(2000);
const info = await page.evaluate(() => {
  const dbg = window.__sceneDbg;
  const cam = dbg.camera;
  const worldA = dbg.scene.getObjectByName('world-backdrop');
  const worldB = dbg.scene.getObjectByName('world-backdrop-b');
  const bbox = (m) => {
    if (!m) return null;
    m.geometry.computeBoundingBox();
    const b = m.geometry.boundingBox;
    return b ? { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] } : null;
  };
  const proj = null; // removed
  const toScreen = (x, y, z) => {
    const V3 = dbg.scene.children[0].position.constructor;
    const v = new V3(x, y, z).project(cam);
    const r = dbg.renderer.domElement.getBoundingClientRect();
    return { x: Math.round(r.left + (v.x * 0.5 + 0.5) * r.width), y: Math.round(r.top + (-v.y * 0.5 + 0.5) * r.height) };
  };
  const dim = dbg.scene.children[0].material?.userData?.shader?.uniforms?.uLayerDim?.value;
  return JSON.stringify({
    camPos: [cam.position.x, cam.position.y, cam.position.z],
    fov: cam.fov, aspect: cam.aspect,
    fog: dbg.scene.fog ? { near: dbg.scene.fog.near, far: dbg.scene.fog.far } : null,
    worldA: { visible: worldA?.visible, verts: worldA?.geometry.attributes.position.count, bbox: bbox(worldA) },
    worldB: { visible: worldB?.visible, verts: worldB?.geometry.attributes.position.count, bbox: bbox(worldB) },
    opacityA: worldA?.material.opacity,
    screen: {
      paris: toScreen(-102.6, 0, -0.46),   // 巴黎（A 布局欧洲最左）
      moscow: toScreen(-60, 0, -0.46),
      tokyo: toScreen(68.4, 0, -0.46),     // 东京（亚洲东缘）
      sydney: toScreen(34, 0, -10),
      washington: toScreen(77.4, 0, -0.46), // A 布局美洲最左
      beijing: toScreen(0, 0, 0),
    },
  }, null, 2);
});
console.log(info);
await browser.close();
