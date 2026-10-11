#!/usr/bin/env node
// Drive any Chromium/Electron page over the Chrome DevTools Protocol. No dependencies (Node 22+).
// Start the target with --remote-debugging-port=<port> (Electron: `electron . --remote-debugging-port=9333`).
//
//   cdp.mjs targets                         list debuggable targets
//   cdp.mjs eval '<js expression>'          evaluate in the page (awaits promises), print JSON
//   cdp.mjs key <code> [key] [vk]           trusted key press, e.g. key Space " " 32 | key Escape Escape 27
//   cdp.mjs click <x> <y> [button]          trusted mouse click at CSS px (counts as a user gesture)
//   cdp.mjs shot <file.jpg|png>             screenshot of the page
//   cdp.mjs console <seconds> [reload] [--filter=<regex>] [--exclude=<regex>]
//                                           stream console + exceptions (optionally reload first)
//   cdp.mjs raw <Method> '<json params>' [<Method> '<json>' ...]
// Env: CDP_PORT (default 9333), CDP_HOST (default 127.0.0.1), CDP_URL_MATCH (pick target whose URL contains it)
import { writeFileSync } from 'node:fs';

const port = process.env.CDP_PORT ?? '9333', host = process.env.CDP_HOST ?? '127.0.0.1';
const [cmd, ...args] = process.argv.slice(2);
const targets = await fetch(`http://${host}:${port}/json`).then(r => r.json()).catch(() => {
  console.error(`no DevTools endpoint at ${host}:${port}; start the app with --remote-debugging-port=${port}`); process.exit(1);
});
if (cmd === 'targets' || !cmd) {
  for (const t of targets) console.log(t.type.padEnd(16), t.url);
  process.exit(0);
}
const match = process.env.CDP_URL_MATCH;
const page = targets.find(t => t.type === 'page' && (!match || t.url.includes(match)));
if (!page) { console.error('no page target'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const pending = new Map(), listeners = [];
ws.onmessage = m => {
  const d = JSON.parse(m.data);
  if (d.id) pending.get(d.id)?.(d); else listeners.forEach(f => f(d));
};
const call = (method, params = {}) => new Promise(r => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });

switch (cmd) {
  case 'eval': {
    const d = await call('Runtime.evaluate', { expression: args[0], awaitPromise: true, returnByValue: true });
    console.log(JSON.stringify(d.result?.result?.value ?? d.result ?? d.error));
    break;
  }
  case 'key': {
    const [code, key = code, vk = '0'] = args;
    for (const type of ['keyDown', 'keyUp'])
      await call('Input.dispatchKeyEvent', { type, code, key, windowsVirtualKeyCode: Number(vk) });
    break;
  }
  case 'click': {
    const [x, y, button = 'left'] = args;
    for (const type of ['mousePressed', 'mouseReleased'])
      await call('Input.dispatchMouseEvent', { type, x: Number(x), y: Number(y), button, clickCount: 1 });
    break;
  }
  case 'shot': {
    const file = args[0] ?? 'shot.jpg', format = file.endsWith('.png') ? 'png' : 'jpeg';
    const d = await call('Page.captureScreenshot', { format, ...(format === 'jpeg' ? { quality: 70 } : {}) });
    writeFileSync(file, Buffer.from(d.result.data, 'base64'));
    console.log(file);
    break;
  }
  case 'console': {
    const seconds = Number(args[0] ?? 10);
    const flag = name => args.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
    const keep = flag('filter') && new RegExp(flag('filter')), drop = flag('exclude') && new RegExp(flag('exclude'));
    listeners.push(d => {
      let line;
      if (d.method === 'Runtime.consoleAPICalled')
        line = `[${d.params.type}] ` + d.params.args.map(a => a.value ?? a.description ?? '').join(' ');
      else if (d.method === 'Runtime.exceptionThrown')
        line = '[EXC] ' + (d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text);
      if (line && (!keep || keep.test(line)) && (!drop || !drop.test(line))) console.log(line.slice(0, 500));
    });
    await call('Runtime.enable');
    if (args.includes('reload')) await call('Page.reload', { ignoreCache: true });
    await new Promise(r => setTimeout(r, seconds * 1000));
    break;
  }
  case 'raw': {
    for (let i = 0; i < args.length; i += 2) console.log(JSON.stringify(await call(args[i], JSON.parse(args[i + 1] ?? '{}'))));
    break;
  }
  default:
    console.error(`unknown command: ${cmd}`); process.exit(2);
}
process.exit(0);
