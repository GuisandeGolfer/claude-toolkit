// Gamepad -> synthetic keyboard/mouse shim for web apps with no Gamepad API support.
// Works when the app reads keydown/keyup `event.code` and pointer-locked mousemove `movementX/Y` on
// `document` (check the app's input code first). Example KEYS below are BO1 Zombies PC defaults.
// Click the page once to take pointer lock; after that the pad works on its own.
//
// KEYS: standard-mapping button index -> KeyboardEvent.code (or mouse button / wheel).
// Button actions follow the game's default_controller.cfg; keys are the PC defaults from
// default_mp_controls.cfg (rawfile in zone/english/en_code_pre_gfx_mp.ff). If you rebind keys in
// Options > Controls, change the matching code here.
const KEYS = {
  0: 'Space',             // Cross / A        +gostand        jump (Space)
  1: 'CROUCH_OR_PRONE',   // Circle / B       +stance         tap: togglecrouch (C), hold: toggleprone (Ctrl)
  2: 'USE_OR_RELOAD',     // Square / X       +usereload      hold: +activate (F), tap: also +reload (R)
  3: 'WHEEL',             // Triangle / Y     weapnext        (mouse wheel)
  4: 'Digit4',            // L1               +smoke          tactical / special grenade (4)
  5: 'KeyG',              // R1               +frag           lethal grenade (G)
  6: 'MOUSE2',            // L2               +speed_throw    aim down sights (right mouse)
  7: 'MOUSE0',            // R2               +attack         fire (left mouse)
  8: 'Tab',               // Share / Back     +scores         (Tab)
  9: 'Escape',            // Options / Start  togglemenu      (Esc)
  10: 'ShiftLeft',        // L3               +breath_sprint  (Shift)
  11: 'KeyV',             // R3               +melee          knife (V)
  12: 'KeyX',             // D-pad up         +actionslot 1   (X)
  13: 'Digit7',           // D-pad down       +actionslot 2   (7)
  14: 'Digit5',           // D-pad left       +actionslot 3   (5)
  15: 'Digit6',           // D-pad right      +actionslot 4   (6)
};
const MOVE_DEADZONE = 0.35;           // left stick -> WASD threshold
const AIM_DEADZONE = 0.12, AIM_SPEED = 22, AIM_EXPONENT = 2;  // px/frame at full tilt, response curve
const PRONE_HOLD_MS = 300, RELOAD_TAP_MS = 250;

function startGamepad() {
  const down = new Set();
  let prev = [], proneTimer = null, proneHeld = false, useAt = 0;
  const canvas = () => document.querySelector('canvas');

  function key(code, isDown) {
    if (isDown === down.has(code)) return;
    isDown ? down.add(code) : down.delete(code);
    // key 'Unidentified' keeps input.js from also emitting a text character.
    document.dispatchEvent(new KeyboardEvent(isDown ? 'keydown' : 'keyup',
      { code, key: 'Unidentified', bubbles: true, cancelable: true }));
  }
  function mouse(button, isDown) {
    const target = canvas() ?? document;
    target.dispatchEvent(new MouseEvent(isDown ? 'mousedown' : 'mouseup', { button, bubbles: true, cancelable: true }));
  }
  function wheel() {
    document.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, deltaMode: 0, bubbles: true, cancelable: true }));
  }

  function button(action, isDown) {
    if (action === 'WHEEL') { if (isDown) wheel(); return; }
    if (action.startsWith('MOUSE')) return mouse(Number(action.slice(5)), isDown);
    if (action === 'CROUCH_OR_PRONE') {
      if (isDown) proneTimer = setTimeout(() => { proneHeld = true; key('ControlLeft', true); key('ControlLeft', false); }, PRONE_HOLD_MS);
      else { clearTimeout(proneTimer); if (!proneHeld) { key('KeyC', true); key('KeyC', false); } proneHeld = false; }
      return;
    }
    if (action === 'USE_OR_RELOAD') {
      // Hold F so buying/repairing works; a quick tap also reloads, like the pad's +usereload.
      if (isDown) { useAt = performance.now(); key('KeyF', true); return; }
      key('KeyF', false);
      if (performance.now() - useAt < RELOAD_TAP_MS) { key('KeyR', true); key('KeyR', false); }
      return;
    }
    key(action, isDown);
  }

  function frame() {
    const pad = [...navigator.getGamepads()].find(p => p?.connected);
    if (pad) {
      pad.buttons.forEach((b, i) => {
        const pressed = b.pressed || b.value > 0.5;
        if (pressed !== Boolean(prev[i]) && KEYS[i]) button(KEYS[i], pressed);
        prev[i] = pressed;
      });
      const [lx, ly, rx, ry] = pad.axes;
      key('KeyA', lx < -MOVE_DEADZONE); key('KeyD', lx > MOVE_DEADZONE);
      key('KeyW', ly < -MOVE_DEADZONE); key('KeyS', ly > MOVE_DEADZONE);
      const curve = v => Math.abs(v) < AIM_DEADZONE ? 0
        : Math.sign(v) * ((Math.abs(v) - AIM_DEADZONE) / (1 - AIM_DEADZONE)) ** AIM_EXPONENT * AIM_SPEED;
      const dx = Math.round(curve(rx)), dy = Math.round(curve(ry));
      if ((dx || dy) && document.pointerLockElement)
        document.dispatchEvent(new MouseEvent('mousemove', { movementX: dx, movementY: dy, bubbles: true }));
    } else if (down.size) {
      [...down].forEach(code => key(code, false)); prev = [];
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

module.exports = { startGamepad };
