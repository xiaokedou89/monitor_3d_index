/**
 * SSE 演示服务器（可选）：以真实仿真引擎回放剧本/环境噪声，向前端实时推送事件。
 *   npm run sse [-- --port 8787 --scenario attack --speed 4]
 * 连接：GET /events?scenario=attack&speed=4（浏览器 EventSource）
 * 协议：SSE 每行一个 JSON 事件信封 {seq,t,ev}（与 src/shared/datasource/sse.ts 一致）
 *
 * 前端默认使用内置本地仿真数据源（SimLocalDataSource，同一引擎同节拍），
 * 换远程后端时把 main.ts 装配处换成 `new SseDataSource('http://host:8787/events')` 即可。
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SimEngine } from '../src/shared/sim/engine';
import type { Dataset } from '../src/shared/types';

const DATA_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/data/dataset.json');

interface SseOpts {
  port: number;
  scenario: string | null;
  speed: number;
}

function parseArgs(argv: string[]): SseOpts {
  let port = 8787;
  let scenario: string | null = 'attack';
  let speed = 1;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port' && argv[i + 1]) port = Number(argv[++i]);
    else if (argv[i] === '--scenario' && argv[i + 1]) {
      const name = argv[++i]!;
      scenario = name === 'none' ? null : name;
    }
    else if (argv[i] === '--speed' && argv[i + 1]) speed = Number(argv[++i]);
  }
  return { port, scenario, speed };
}

const dataset = JSON.parse(readFileSync(DATA_PATH, 'utf8')) as Dataset;
const opts = parseArgs(process.argv.slice(2));

if (opts.scenario && !dataset.scenarios.some((s) => s.id === opts.scenario)) {
  console.error(`未知剧本 ${opts.scenario}，可选：${dataset.scenarios.map((s) => s.id).join('/')} / none`);
  process.exit(1);
}

const TICK_MS = 100;
const engine = new SimEngine(dataset);
engine.loadScenario(opts.scenario);
engine.speed = opts.speed;

const sseHeaders = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'Access-Control-Allow-Origin': '*',
  'X-Accel-Buffering': 'no',
};

function handleEvents(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, sseHeaders);
  res.write(`: connected (scenario=${opts.scenario ?? 'noise'} speed=${opts.speed}x)\n\n`);

  let lastPing = Date.now();
  const timer = setInterval(() => {
    const envs = engine.tick(TICK_MS / 1000);
    for (const env of envs) res.write(`data: ${JSON.stringify(env)}\n\n`);
    // 心跳防止代理超时断连
    if (Date.now() - lastPing > 15_000) {
      res.write(`: ping\n\n`);
      lastPing = Date.now();
    }
  }, TICK_MS);

  res.on('close', () => clearInterval(timer));
}

function handleStatus(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(
    JSON.stringify({
      entities: dataset.entities.length,
      relations: dataset.relations.length,
      scenario: opts.scenario,
      speed: opts.speed,
      tickMs: TICK_MS,
    }),
  );
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname === '/events') handleEvents(req, res);
  else if (url.pathname === '/status') handleStatus(req, res);
  else {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('GET /events （SSE 事件流）或 /status（服务状态）');
  }
});

server.listen(opts.port, () => {
  console.log(`[mock-sse] 监听 http://localhost:${opts.port}/events（剧本=${opts.scenario ?? '环境噪声'}，${opts.speed}×，${TICK_MS}ms 节拍）`);
});
