/**
 * Tiny CLI for poking the event pipeline.
 *
 *   node scripts/push-event.mjs '{"type":"agent.state","agent":"file","state":"working","task":"检索合同"}'
 */
const raw = process.argv[2];

if (!raw) {
  console.error('用法: node scripts/push-event.mjs \'{"type":"agent.state","agent":"file","state":"working"}\'');
  process.exit(1);
}

const url = process.env.EVENT_URL || 'http://localhost:5173/event';

try {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw,
  });
  console.log(res.status, await res.text());
} catch (err) {
  console.error(`无法连接 ${url}`);
  console.error('请先运行: node server.mjs');
  process.exit(1);
}
