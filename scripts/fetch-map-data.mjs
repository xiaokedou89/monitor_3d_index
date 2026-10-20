/**
 * 地图数据获取与合规核验脚本：
 *   node scripts/fetch-map-data.mjs
 * 1. 中国地图（含台湾省/港澳/十段线要素）—— DataV.GeoAtlas areas_v3 100000_full.json
 *    （基于自然资源部标准地图数据加工，演示用；生产环境应替换为
 *      自然资源部标准地图服务（bzdt.ch.mnr.gov.cn）发布的标准地图并标注审图号）
 * 2. 世界地图低清轮廓 —— Natural Earth 110m（地域层背景装饰，中国部分以 DataV 数据为准）
 * 3. 海南省全域（含三沙/南海诸岛，用于右下角南海诸岛附图）—— 460000_full.json
 * 全部下载后执行核验（边界完整、十段线要素存在、台湾/港澳在列），
 * 核验不通过则拒绝落盘。元信息写入 public/data/map-meta.json。
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/data');

const SOURCES = [
  {
    key: 'china',
    url: 'https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json',
    file: 'china.geo.json',
    validate: (d) => {
      const errors = [];
      if (d?.type !== 'FeatureCollection') errors.push('根类型不是 FeatureCollection');
      const fs = d?.features ?? [];
      if (fs.length < 34) errors.push(`省级特征数不足 34（实际 ${fs.length}）`);
      const names = fs.map((f) => f.properties?.name ?? '');
      for (const must of ['台湾省', '香港特别行政区', '澳门特别行政区']) {
        if (!names.includes(must)) errors.push(`缺少 ${must} 特征`);
      }
      const tenDash = fs.find((f) => !f.properties?.name || f.properties?.adcode === '100000_JD');
      if (!tenDash) errors.push('缺少十段线特征（空名/100000_JD）');
      else if ((tenDash.geometry?.coordinates ?? []).length < 8) {
        errors.push('十段线特征多边形数量异常');
      }
      return errors;
    },
  },
  {
    key: 'world',
    url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson',
    file: 'world.geo.json',
    validate: (d) => {
      const errors = [];
      if (d?.type !== 'FeatureCollection') errors.push('根类型不是 FeatureCollection');
      if ((d?.features ?? []).length < 100) errors.push('国家特征数不足 100');
      return errors;
    },
  },
  {
    key: 'hainan',
    url: 'https://geo.datav.aliyun.com/areas_v3/bound/460000_full.json',
    file: 'hainan.geo.json',
    optional: true,
    validate: (d) => {
      const errors = [];
      if (d?.type !== 'FeatureCollection') errors.push('根类型不是 FeatureCollection');
      const names = (d?.features ?? []).map((f) => f.properties?.name ?? '');
      if (!names.includes('三沙市')) errors.push('缺少三沙市（南海诸岛）特征');
      return errors;
    },
  },
];

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'monitorctrl-3d map fetcher' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const meta = { fetchedAt: new Date().toISOString(), files: [] };
  let failed = false;

  for (const src of SOURCES) {
    console.log(`[1/3] 下载 ${src.key}: ${src.url}`);
    try {
      const data = await fetchJson(src.url);
      const errors = src.validate(data);
      const text = JSON.stringify(data);
      const sha = createHash('sha256').update(text).digest('hex');
      if (errors.length > 0) {
        console.error(`[✗] ${src.key} 核验失败:\n  - ${errors.join('\n  - ')}`);
        failed = true;
        continue;
      }
      writeFileSync(path.join(OUT_DIR, src.file), text);
      meta.files.push({ key: src.key, file: src.file, url: src.url, bytes: text.length, sha256: sha, valid: true });
      console.log(`[✓] ${src.key} 核验通过，写入 ${src.file} (${(text.length / 1024).toFixed(0)} KB)`);
    } catch (err) {
      if (src.optional) {
        console.warn(`[!] ${src.key} 下载失败（可选），跳过: ${err.message}`);
        meta.files.push({ key: src.key, file: src.file, url: src.url, valid: false, error: String(err.message), optional: true });
      } else {
        console.error(`[✗] ${src.key} 下载失败: ${err.message}`);
        failed = true;
      }
    }
  }

  writeFileSync(
    path.join(OUT_DIR, 'map-meta.json'),
    JSON.stringify(
      {
        ...meta,
        note: '演示用地图数据。中国地图基于自然资源部标准地图数据（DataV.GeoAtlas 加工），生产环境请替换为自然资源部标准地图服务发布的标准地图并标注审图号。',
      },
      null,
      2,
    ),
  );

  if (failed) {
    console.error('\n存在必需数据缺失，请检查网络后重试。');
    process.exit(1);
  }
  console.log('\n地图数据就绪，元信息已写入 public/data/map-meta.json');
}

main();
