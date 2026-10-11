// Generic offline wrapper: loads a real site URL, answers its requests from mirror.js.
// Configure in mirror.config.json (startUrl, scope, stub, appName, window size).
// Flags: --offline | --refresh   --perf   --fullscreen   --devtools   --url=<override start URL>
// Any Chromium switch also works, e.g. --remote-debugging-port=9333 (then drive it with scripts/cdp.mjs).
const { app, BrowserWindow, ipcMain, session, globalShortcut } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createMirror } = require('./mirror');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'mirror.config.json'), 'utf8'));
const arg = name => process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`));
const val = (name, fallback) => arg(name)?.split('=').slice(1).join('=') || fallback;
const mode = arg('offline') ? 'offline' : arg('refresh') ? 'refresh' : 'cache';

app.setName(config.appName);
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('disable-background-timer-throttling');
const dataDir = app.getPath('userData');            // ~/Library/Application Support/<appName>
const perfLog = path.join(dataDir, 'perf.log');

app.whenReady().then(() => {
  const mirror = createMirror(path.join(dataDir, 'mirror'), mode, {
    scope: config.scope.map(s => new RegExp(s)),
    stub: (config.stub ?? []).map(s => ({ ...s, match: new RegExp(s.match) })),
    pageKeys: (config.pageKeys ?? []).map(s => new RegExp(s)),
  });
  session.defaultSession.protocol.handle('https', req => mirror.handle(req));

  const win = new BrowserWindow({
    width: config.width ?? 1440, height: config.height ?? 900, backgroundColor: '#000', title: config.appName,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false, backgroundThrottling: false },
  });
  win.setMenuBarVisibility(false);
  // setFullScreen before the first load is ignored on macOS; wait for it.
  if (arg('fullscreen')) win.webContents.once('did-finish-load', () => win.setFullScreen(true));
  win.loadURL(val('url', config.startUrl));
  if (arg('devtools')) win.webContents.openDevTools({ mode: 'detach' });
  globalShortcut.register('F11', () => win.setFullScreen(!win.isFullScreen()));
  globalShortcut.register('CommandOrControl+Alt+I', () => win.webContents.toggleDevTools());

  ipcMain.handle('config', () => ({ perf: Boolean(arg('perf')), mode, perfRegex: config.perfOverlayRegex ?? null }));
  if (arg('perf')) {
    fs.writeFileSync(perfLog, 'time\tfps\textra\tmem_total_mb\tmem_gpu_mb\tmem_renderer_mb\n');
    ipcMain.on('perf', (_e, s) => {
      const metrics = app.getAppMetrics();
      const mb = type => Math.round(metrics.filter(m => !type || m.type === type).reduce((sum, m) => sum + m.memory.workingSetSize, 0) / 1024);
      fs.appendFileSync(perfLog, [new Date().toISOString(), s.fps, s.extra ?? '', mb(), mb('GPU'), mb('Tab')].join('\t') + '\n');
    });
  }
  app.on('will-quit', () => console.log(`[mirror] ${mode}`, mirror.stats));
});

app.on('window-all-closed', () => app.quit());
