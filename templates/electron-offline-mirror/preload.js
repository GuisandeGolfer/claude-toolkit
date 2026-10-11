// Perf sampler (with --perf) and optional gamepad shim.
// IMPORTANT: browser rAF rate is NOT an app's/game's frame rate (bo1z under WebGL2: page 80 fps, engine 21).
// If the app prints its own FPS (e.g. a ?perf=1 overlay), set perfOverlayRegex in mirror.config.json:
// a regex run over document.body.innerText whose group 1 is the FPS (group 2, if any, goes to "extra").
const { ipcRenderer } = require('electron');
let startGamepad = null;
try { ({ startGamepad } = require('./gamepad-to-keys')); } catch { /* optional */ }

window.addEventListener('DOMContentLoaded', async () => {
  startGamepad?.();
  const config = await ipcRenderer.invoke('config');
  if (!config.perf) return;
  const overlay = config.perfRegex && new RegExp(config.perfRegex);
  let frames = 0;
  const tick = () => { frames++; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  setInterval(() => {
    const m = overlay && document.body.innerText.match(overlay);
    ipcRenderer.send('perf', m ? { fps: +m[1], extra: m[2] } : { fps: +(frames / 5).toFixed(1), extra: 'raf' });
    frames = 0;
  }, 5000);
});
