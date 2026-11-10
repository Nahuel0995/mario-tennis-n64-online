// public/app.js
// Plataforma Multijugador Nintendo 64 Online (1P a 4P en Tiempo Real):
// - Soporte Multi-ROM en la misma página (?room=): sube o cambia cualquier juego (.z64, .n64, .v64, .zip) sin desconectar la sala
// - Motor Anti-Tilde: iframe aislado de WebAssembly + Cero fugas de AudioNodes + Cuantización analógica + Parallel N64 / Mupen64Plus
// - Configurador interactivo de teclas guardado en localStorage
// - Panel lateral de Personas Conectadas (1P a 4P) con Nombre editable y Chat

(() => {
  const N64_BTN = {
    A:     1 << 0,  // Botón A (Golpe Liftado / Acelerar / Saltar / Ataque)
    B:     1 << 1,  // Botón B (Golpe Cortado / Frenar / Especial)
    Z:     1 << 2,  // Gatillo Z (Ítem / Escudo / Agarre)
    START: 1 << 3,  // Botón START / Pausa
    DU:    1 << 4,
    DD:    1 << 5,
    DL:    1 << 6,
    DR:    1 << 7,
    L:     1 << 8,
    R:     1 << 9,  // Botón R (Derrapar en Kart / Globo)
    CU:    1 << 10, // C Arriba
    CD:    1 << 11, // C Abajo
    CL:    1 << 12, // C Izquierda
    CR:    1 << 13  // C Derecha
  };

  const RTC_ICE_CONFIG = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' }
    ]
  };

  // ==========================================================================
  // 1. CONFIGURACIÓN PERSONALIZABLE DE TECLAS (GUARDADA EN LOCALSTORAGE)
  // ==========================================================================
  const KEYMAP_STORAGE_KEY = 'mt64_custom_keymap_v2';

  const DEFAULT_KEYMAP = {
    UP:    'ArrowUp',
    DOWN:  'ArrowDown',
    LEFT:  'ArrowLeft',
    RIGHT: 'ArrowRight',
    A:     'KeyZ',
    B:     'KeyX',
    Z:     'KeyV',
    R:     'Space',
    CU:    'KeyW',
    CD:    'KeyC',
    CL:    'KeyA',
    CR:    'KeyD',
    START: 'Enter'
  };

  const KEYMAP_DESCRIPTIONS = [
    { key: 'UP',    title: 'Mover Arriba ▲',          sub: 'Stick Analógico Arriba' },
    { key: 'DOWN',  title: 'Mover Abajo ▼',           sub: 'Stick Analógico Abajo' },
    { key: 'LEFT',  title: 'Mover Izquierda ◄',       sub: 'Stick Analógico Izquierda' },
    { key: 'RIGHT', title: 'Mover Derecha ►',         sub: 'Stick Analógico Derecha' },
    { key: 'A',     title: 'Botón A (Principal)',     sub: 'Liftado (Tennis) / Acelerar (Kart) / Saltar' },
    { key: 'B',     title: 'Botón B (Secundario)',    sub: 'Cortado (Tennis) / Frenar / Ataque' },
    { key: 'R',     title: 'Botón R / Globo (A+B)',   sub: 'Globo (Tennis) / Derrapar-Saltar (Kart)' },
    { key: 'CD',    title: 'Botón C▼ / Dejada',       sub: 'Dejada (Tennis) / Cámara / Saltar (Smash)' },
    { key: 'Z',     title: 'Gatillo Z',               sub: 'Lanzar Ítem (Kart) / Escudo (Smash)' },
    { key: 'CU',    title: 'Botón C▲',                sub: 'Cámara Arriba / Saltar (Smash)' },
    { key: 'CL',    title: 'Botón C◄',                sub: 'Cámara Izquierda' },
    { key: 'CR',    title: 'Botón C►',                sub: 'Cámara Derecha' },
    { key: 'START', title: 'Botón START',             sub: 'Pausa / Iniciar Partida' }
  ];

  let userKeymap = { ...DEFAULT_KEYMAP };
  try {
    const saved = localStorage.getItem(KEYMAP_STORAGE_KEY);
    if (saved) {
      userKeymap = { ...DEFAULT_KEYMAP, ...JSON.parse(saved) };
    }
  } catch (_) {}

  function saveKeymap() {
    try {
      localStorage.setItem(KEYMAP_STORAGE_KEY, JSON.stringify(userKeymap));
    } catch (_) {}
  }

  function formatKeyCode(code) {
    if (!code) return '---';
    return code
      .replace(/^Key/, 'Tecla ')
      .replace(/^Digit/, 'Num ')
      .replace('ArrowUp', 'Flecha ↑')
      .replace('ArrowDown', 'Flecha ↓')
      .replace('ArrowLeft', 'Flecha ←')
      .replace('ArrowRight', 'Flecha →')
      .replace('Space', 'Espacio');
  }

  let listeningActionKey = null;

  function renderKeymapModal() {
    const grid = document.getElementById('keymap-grid');
    if (!grid) return;
    grid.innerHTML = '';

    KEYMAP_DESCRIPTIONS.forEach((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `keymap-item-btn ${listeningActionKey === item.key ? 'listening' : ''}`;
      const badgeText = listeningActionKey === item.key
        ? 'Presiona una tecla...'
        : formatKeyCode(userKeymap[item.key]);

      btn.innerHTML = `
        <div>
          <div class="keymap-action-label">${item.title}</div>
          <span class="keymap-action-sub">${item.sub}</span>
        </div>
        <span class="keymap-key-badge">${badgeText}</span>
      `;

      btn.addEventListener('click', () => {
        listeningActionKey = item.key;
        renderKeymapModal();
      });

      grid.appendChild(btn);
    });
  }

  const keymapModal = document.getElementById('keymap-modal');
  document.getElementById('open-keymap-btn').addEventListener('click', () => {
    listeningActionKey = null;
    renderKeymapModal();
    keymapModal.classList.remove('hidden');
  });

  function closeKeymapModal() {
    listeningActionKey = null;
    keymapModal.classList.add('hidden');
  }

  document.getElementById('close-keymap-btn').addEventListener('click', closeKeymapModal);
  document.getElementById('done-keymap-btn').addEventListener('click', closeKeymapModal);
  document.getElementById('reset-keymap-btn').addEventListener('click', () => {
    userKeymap = { ...DEFAULT_KEYMAP };
    saveKeymap();
    listeningActionKey = null;
    renderKeymapModal();
  });

  // ==========================================================================
  // 2. GESTIÓN AUTOMÁTICA DEL PARÁMETRO ?room= Y NOMBRE DEL JUGADOR
  // ==========================================================================
  function ensureRoomIdInUrl() {
    const params = new URLSearchParams(window.location.search);
    let roomId = params.get('room');
    if (!roomId || !roomId.trim()) {
      roomId = Math.random().toString(36).substring(2, 10);
      const newUrl = `${window.location.pathname}?room=${roomId}`;
      window.history.replaceState({ roomId }, '', newUrl);
    }
    return roomId.trim().toLowerCase();
  }

  const currentRoomId = ensureRoomIdInUrl();
  document.getElementById('room-code-display').textContent = `SALA: ${currentRoomId}`;

  let myPlayerName = localStorage.getItem('mt64_player_name') || '';
  const nameInput = document.getElementById('player-name-input');
  if (myPlayerName) nameInput.value = myPlayerName;

  let lanBaseUrl = null;

  function getShareableInviteUrl() {
    if (
      lanBaseUrl &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ) {
      return `${lanBaseUrl}/?room=${currentRoomId}`;
    }
    return `${window.location.origin}${window.location.pathname}?room=${currentRoomId}`;
  }

  function refreshShareUrlBox() {
    const url = getShareableInviteUrl();
    const shareInput = document.getElementById('share-url-input');
    if (shareInput) shareInput.value = url;
  }
  refreshShareUrlBox();

  // ==========================================================================
  // 3. MOTOR DE CONTROLES (TECLADO + GAMEPAD + TÁCTIL CON CUANTIZACIÓN ANTI-TILDE)
  // ==========================================================================
  const pressedKeys = new Set();
  const touchState = { stickX: 0, stickY: 0, buttons: new Set() };
  let activePhysicalGamepadIndex = null;
  let detectedControllerLabel = 'Teclado Personalizado';

  const n64Ports = [
    { bitmask: 0, stickX: 0, stickY: 0 },
    { bitmask: 0, stickX: 0, stickY: 0 },
    { bitmask: 0, stickX: 0, stickY: 0 },
    { bitmask: 0, stickX: 0, stickY: 0 }
  ];

  function isTypingInInput(win = window) {
    const tag = win.document?.activeElement?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  function handleKeyDownEvent(e) {
    if (!keymapModal.classList.contains('hidden') && listeningActionKey) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code !== 'Escape') {
        userKeymap[listeningActionKey] = e.code;
        saveKeymap();
      }
      listeningActionKey = null;
      renderKeymapModal();
      return;
    }

    if (isTypingInInput(window)) return;

    const mappedCodes = Object.values(userKeymap);
    if (mappedCodes.includes(e.code)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      pressedKeys.add(e.code);
    }
  }

  function handleKeyUpEvent(e) {
    if (pressedKeys.has(e.code)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      pressedKeys.delete(e.code);
    }
  }

  // Exponer a /emulator.html para que las teclas funcionen igual aunque el foco esté dentro del iframe
  window.__handleEmulatorKeyDown = handleKeyDownEvent;
  window.__handleEmulatorKeyUp = handleKeyUpEvent;

  window.addEventListener('keydown', handleKeyDownEvent, true);
  window.addEventListener('keyup', handleKeyUpEvent, true);
  window.addEventListener('blur', () => pressedKeys.clear());

  window.addEventListener('gamepadconnected', (e) => {
    activePhysicalGamepadIndex = e.gamepad.index;
    const rawId = e.gamepad.id || 'Gamepad USB/BT';
    detectedControllerLabel = `🎮 ${rawId.split('(')[0].trim().substring(0, 20)}`;
    socket.emit('update-player-meta', { controllerType: detectedControllerLabel });
  });

  window.addEventListener('gamepaddisconnected', (e) => {
    if (activePhysicalGamepadIndex === e.gamepad.index) {
      activePhysicalGamepadIndex = null;
      detectedControllerLabel = 'Teclado Personalizado';
      socket.emit('update-player-meta', { controllerType: detectedControllerLabel });
    }
  });

  function initTouchControls() {
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const touchContainer = document.getElementById('touch-controls');
    if (!isTouchDevice) return;

    touchContainer.classList.remove('hidden');
    detectedControllerLabel = '📱 Control Táctil';

    const zone = document.getElementById('touch-joystick-zone');
    const stick = document.getElementById('touch-joystick-stick');
    const maxRadius = 42;

    const handleStickMove = (touch) => {
      const rect = zone.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      let dx = touch.clientX - centerX;
      let dy = touch.clientY - centerY;
      const dist = Math.hypot(dx, dy);
      if (dist > maxRadius) {
        dx = (dx / dist) * maxRadius;
        dy = (dy / dist) * maxRadius;
      }
      stick.style.transform = `translate(${dx}px, ${dy}px)`;
      touchState.stickX = (dx / maxRadius) * 0.85;
      touchState.stickY = (dy / maxRadius) * 0.85;
    };

    const resetStick = () => {
      stick.style.transform = 'translate(0px, 0px)';
      touchState.stickX = 0;
      touchState.stickY = 0;
    };

    zone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      handleStickMove(e.targetTouches[0]);
    }, { passive: false });

    zone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      handleStickMove(e.targetTouches[0]);
    }, { passive: false });

    zone.addEventListener('touchend', resetStick);
    zone.addEventListener('touchcancel', resetStick);

    document.querySelectorAll('[data-btn]').forEach((btn) => {
      const code = btn.dataset.btn;
      btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        touchState.buttons.add(code);
      }, { passive: false });
      btn.addEventListener('touchend', (e) => {
        e.preventDefault();
        touchState.buttons.delete(code);
      }, { passive: false });
    });
  }
  initTouchControls();

  function applyN64Calibration(rawX, rawY) {
    const deadzone = 0.14;
    const peakRange = 0.85;
    const mag = Math.hypot(rawX, rawY);
    if (mag < deadzone) return { x: 0, y: 0 };
    const norm = Math.min(1, (mag - deadzone) / (1 - deadzone));
    const scale = (norm / mag) * peakRange;
    // Cuantizamos en 12 escalones discretos para eliminar micro-oscilaciones del joystick
    // que saturaban simulateInput() y el socket en cada fotograma
    const qx = Math.round(Math.max(-1, Math.min(1, rawX * scale)) * 12) / 12;
    const qy = Math.round(Math.max(-1, Math.min(1, rawY * scale)) * 12) / 12;
    return { x: qx, y: qy };
  }

  const reusablePacket = new ArrayBuffer(4);
  const reusableView = new DataView(reusablePacket);

  function sampleLocalController() {
    let bitmask = 0;
    let stickX = 0;
    let stickY = 0;

    // 1. Gamepad físico
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = activePhysicalGamepadIndex !== null ? pads[activePhysicalGamepadIndex] : null;
    if (!gp) {
      for (let i = 0; i < pads.length; i++) {
        if (pads[i] && pads[i].connected) {
          gp = pads[i];
          activePhysicalGamepadIndex = i;
          break;
        }
      }
    }

    if (gp) {
      const pressed = (idx) => gp.buttons[idx] && (gp.buttons[idx].pressed || gp.buttons[idx].value > 0.35);
      if (pressed(0)) bitmask |= N64_BTN.A;
      if (pressed(2) || pressed(1)) bitmask |= N64_BTN.B;
      if (pressed(3)) bitmask |= (N64_BTN.A | N64_BTN.B);
      if (pressed(6) || pressed(7)) bitmask |= N64_BTN.Z;
      if (pressed(4)) bitmask |= N64_BTN.L;
      if (pressed(5)) bitmask |= N64_BTN.R;
      if (pressed(9)) bitmask |= N64_BTN.START;
      if (pressed(12)) bitmask |= N64_BTN.DU;
      if (pressed(13)) bitmask |= N64_BTN.DD;
      if (pressed(14)) bitmask |= N64_BTN.DL;
      if (pressed(15)) bitmask |= N64_BTN.DR;

      const rx = gp.axes[2] || 0;
      const ry = gp.axes[3] || 0;
      if (ry < -0.5) bitmask |= N64_BTN.CU;
      if (ry >  0.5) bitmask |= N64_BTN.CD;
      if (rx < -0.5) bitmask |= N64_BTN.CL;
      if (rx >  0.5) bitmask |= N64_BTN.CR;

      const cal = applyN64Calibration(gp.axes[0] || 0, gp.axes[1] || 0);
      stickX = cal.x;
      stickY = cal.y;
    }

    // 2. Teclado personalizado
    if (pressedKeys.has(userKeymap.A))     bitmask |= N64_BTN.A;
    if (pressedKeys.has(userKeymap.B))     bitmask |= N64_BTN.B;
    if (pressedKeys.has(userKeymap.R))     bitmask |= (N64_BTN.R | N64_BTN.A | N64_BTN.B);
    if (pressedKeys.has(userKeymap.Z))     bitmask |= N64_BTN.Z;
    if (pressedKeys.has(userKeymap.CU))    bitmask |= N64_BTN.CU;
    if (pressedKeys.has(userKeymap.CD))    bitmask |= (N64_BTN.CD | N64_BTN.B);
    if (pressedKeys.has(userKeymap.CL))    bitmask |= N64_BTN.CL;
    if (pressedKeys.has(userKeymap.CR))    bitmask |= N64_BTN.CR;
    if (pressedKeys.has(userKeymap.START)) bitmask |= N64_BTN.START;

    let kx = 0;
    let ky = 0;
    if (pressedKeys.has(userKeymap.LEFT))  kx -= 1;
    if (pressedKeys.has(userKeymap.RIGHT)) kx += 1;
    if (pressedKeys.has(userKeymap.UP))    ky -= 1;
    if (pressedKeys.has(userKeymap.DOWN))  ky += 1;
    if (kx !== 0 || ky !== 0) {
      const mag = Math.hypot(kx, ky);
      stickX = Math.round(((kx / mag) * 0.85) * 12) / 12;
      stickY = Math.round(((ky / mag) * 0.85) * 12) / 12;
    }

    // 3. Controles táctiles
    if (touchState.buttons.has('A'))     bitmask |= N64_BTN.A;
    if (touchState.buttons.has('B'))     bitmask |= N64_BTN.B;
    if (touchState.buttons.has('LOB'))   bitmask |= (N64_BTN.R | N64_BTN.Z | N64_BTN.A | N64_BTN.B);
    if (touchState.buttons.has('DROP'))  bitmask |= (N64_BTN.B | N64_BTN.CD);
    if (touchState.buttons.has('START')) bitmask |= N64_BTN.START;
    if (touchState.stickX !== 0 || touchState.stickY !== 0) {
      stickX = Math.round(touchState.stickX * 12) / 12;
      stickY = Math.round(touchState.stickY * 12) / 12;
    }

    reusableView.setUint16(0, bitmask, true);
    reusableView.setInt8(2, Math.round(stickX * 127));
    reusableView.setInt8(3, Math.round(stickY * 127));

    return { bitmask, stickX, stickY, packet: reusablePacket };
  }

  function decodeControllerPacket(bufferLike) {
    if (!bufferLike) return { bitmask: 0, stickX: 0, stickY: 0 };
    const ab = bufferLike instanceof ArrayBuffer
      ? bufferLike
      : (bufferLike.buffer ? bufferLike.buffer.slice(bufferLike.byteOffset, bufferLike.byteOffset + bufferLike.byteLength) : null);
    if (!ab || ab.byteLength < 4) return { bitmask: 0, stickX: 0, stickY: 0 };
    const view = new DataView(ab);
    return {
      bitmask: view.getUint16(0, true),
      stickX: Math.round((view.getInt8(2) / 127) * 12) / 12,
      stickY: Math.round((view.getInt8(3) / 127) * 12) / 12
    };
  }

  // ==========================================================================
  // 4. INYECCIÓN OPTIMIZADA EN EMULATORJS (DENTRO DEL IFRAME AISLADO)
  // ==========================================================================
  const prevSimCache = [
    new Int32Array(24).fill(-1),
    new Int32Array(24).fill(-1),
    new Int32Array(24).fill(-1),
    new Int32Array(24).fill(-1)
  ];

  function resetInputCache() {
    for (let s = 0; s < 4; s++) {
      prevSimCache[s].fill(-1);
    }
  }

  function getEmulatorGameManager() {
    const frame = document.getElementById('emulator-frame');
    const emu = frame?.contentWindow?.EJS_emulator;
    return emu?.gameManager || null;
  }

  function injectInputIntoEmulatorJS(slot, state) {
    n64Ports[slot].bitmask = state.bitmask || 0;
    n64Ports[slot].stickX = state.stickX || 0;
    n64Ports[slot].stickY = state.stickY || 0;

    const gm = getEmulatorGameManager();
    const simFn = gm?.functions?.simulateInput || gm?.simulateInput;
    if (typeof simFn !== 'function') return;

    const bm = state.bitmask || 0;
    const sx = state.stickX || 0;
    const sy = state.stickY || 0;
    const cache = prevSimCache[slot];
    const ctx = gm.functions || gm;

    const updateBtn = (btnIdx, val) => {
      if (cache[btnIdx] !== val) {
        cache[btnIdx] = val;
        try {
          simFn.call(ctx, slot, btnIdx, val);
        } catch (_) {}
      }
    };

    // Cuantizamos el valor analógico (0..32767) en múltiplos de 2048 para cero saturación de llamadas Wasm
    const quantizeAxis = (v) => {
      if (v <= 0.08) return 0;
      return Math.min(32767, Math.round((v * 32767) / 2048) * 2048);
    };

    updateBtn(0,  (bm & N64_BTN.B)     ? 1 : 0);
    updateBtn(8,  (bm & N64_BTN.A)     ? 1 : 0);
    updateBtn(12, (bm & N64_BTN.Z)     ? 1 : 0);
    updateBtn(3,  (bm & N64_BTN.START) ? 1 : 0);
    updateBtn(4,  (bm & N64_BTN.DU)    ? 1 : 0);
    updateBtn(5,  (bm & N64_BTN.DD)    ? 1 : 0);
    updateBtn(6,  (bm & N64_BTN.DL)    ? 1 : 0);
    updateBtn(7,  (bm & N64_BTN.DR)    ? 1 : 0);
    updateBtn(10, (bm & N64_BTN.L)     ? 1 : 0);
    updateBtn(11, (bm & N64_BTN.R)     ? 1 : 0);
    updateBtn(16, quantizeAxis(sx));
    updateBtn(17, quantizeAxis(-sx));
    updateBtn(18, quantizeAxis(sy));
    updateBtn(19, quantizeAxis(-sy));
    updateBtn(20, (bm & N64_BTN.CR)    ? 32767 : 0);
    updateBtn(21, (bm & N64_BTN.CL)    ? 32767 : 0);
    updateBtn(22, (bm & N64_BTN.CD)    ? 32767 : 0);
    updateBtn(23, (bm & N64_BTN.CU)    ? 32767 : 0);
  }

  // ==========================================================================
  // 5. GESTIÓN MULTI-ROM Y LANZAMIENTO AISLADO DE EMULATORJS
  // ==========================================================================
  let emulatorStarted = false;
  let hostMediaStream = null;
  let canvasWatcherId = null;
  let activeRomUrl = '/rom/mario_tennis.z64';
  let activeGameTitle = 'MARIO TENNIS 64';
  let activeCore = localStorage.getItem('n64_preferred_core_v2') || 'n64';
  let availableServerRoms = [];

  const coreSelectEl = document.getElementById('emulator-core-select');
  if (coreSelectEl) {
    coreSelectEl.value = activeCore;
  }

  function updateGameTitleUI(title) {
    activeGameTitle = String(title || 'NINTENDO 64').toUpperCase();
    const badge = document.getElementById('game-title-badge');
    if (badge) {
      badge.textContent = `🎮 ${activeGameTitle}`;
    }
    document.title = `${activeGameTitle} // N64 Online`;
  }

  function attachStreamToAllPeers(newStream) {
    hostMediaStream = newStream;
    const newVideoTrack = newStream.getVideoTracks()[0];
    if (!newVideoTrack) return;

    if ('contentHint' in newVideoTrack) {
      newVideoTrack.contentHint = 'motion';
    }

    for (const [peerSocketId, peer] of peers.entries()) {
      const senders = peer.pc.getSenders ? peer.pc.getSenders() : [];
      const videoSender = senders.find((s) => s.track && s.track.kind === 'video');
      if (videoSender) {
        videoSender.replaceTrack(newVideoTrack).catch(() => {
          createHostPeerConnection(peerSocketId, peer.slot);
        });
      } else {
        createHostPeerConnection(peerSocketId, peer.slot);
      }
    }
  }

  function startHostStreamCaptureWatcher() {
    if (canvasWatcherId) {
      clearInterval(canvasWatcherId);
      canvasWatcherId = null;
    }

    canvasWatcherId = setInterval(() => {
      const frame = document.getElementById('emulator-frame');
      const canvas = frame?.contentDocument?.querySelector('#game canvas');
      if (canvas && canvas.width > 0 && typeof canvas.captureStream === 'function') {
        clearInterval(canvasWatcherId);
        canvasWatcherId = null;

        const stream = canvas.captureStream(30);
        attachStreamToAllPeers(stream);
        appendChatLine('system', `🟢 Stream en vivo de ${activeGameTitle} activo (60Hz inputs / 30fps video).`);
      }
    }, 600);
  }

  async function bootHostEmulator(romUrl = activeRomUrl, gameTitle = activeGameTitle, core = activeCore, forceReload = false) {
    if (emulatorStarted && !forceReload) return;

    activeRomUrl = romUrl || '/rom/mario_tennis.z64';
    activeCore = core || 'n64';
    updateGameTitleUI(gameTitle);

    if (! activeRomUrl.startsWith('blob:')) {
      try {
        const check = await fetch('/api/rom-status');
        const status = await check.json();
        if (status.lanUrl) {
          lanBaseUrl = status.lanUrl;
          refreshShareUrlBox();
        }
        if (Array.isArray(status.roms)) {
          availableServerRoms = status.roms;
          renderRomLibraryList();
        }
        if (!status.exists && activeRomUrl === '/rom/mario_tennis.z64') {
          document.getElementById('rom-missing-modal').classList.remove('hidden');
          return;
        }
      } catch (_) {}
    }

    document.getElementById('rom-missing-modal').classList.add('hidden');
    emulatorStarted = true;
    resetInputCache();

    // Configuramos los parámetros que leerá /emulator.html al cargarse en el iframe
    window.__EJS_LAUNCH_CONFIG = {
      romUrl: activeRomUrl,
      gameTitle: activeGameTitle,
      core: activeCore
    };

    const frame = document.getElementById('emulator-frame');
    frame.src = `/emulator.html?v=${Date.now()}`;

    startHostStreamCaptureWatcher();
  }

  // ==========================================================================
  // 6. MODAL CAMBIAR JUEGO / SUBIR CUALQUIER ROM N64 EN LA MISMA PÁGINA
  // ==========================================================================
  const romSwitcherModal = document.getElementById('rom-switcher-modal');
  const romFilePicker = document.getElementById('rom-file-picker');
  const romUploadStatus = document.getElementById('rom-upload-status');

  function cleanTitleFromFilename(name) {
    return String(name || 'JUEGO N64')
      .replace(/\.(z64|n64|v64|zip)$/i, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase() || 'JUEGO N64';
  }

  function renderRomLibraryList() {
    const container = document.getElementById('rom-library-list');
    if (!container) return;
    container.innerHTML = '';

    if (!availableServerRoms || availableServerRoms.length === 0) {
      container.innerHTML = `<div class="rom-library-file">No hay ROMs guardadas aún. Sube cualquier archivo .z64 arriba.</div>`;
      return;
    }

    availableServerRoms.forEach((rom) => {
      const item = document.createElement('div');
      item.className = 'rom-library-item';
      item.innerHTML = `
        <div class="rom-library-meta">
          <span class="rom-library-title">🎮 ${escapeHtml(rom.title)}</span>
          <span class="rom-library-file">${escapeHtml(rom.filename)} (${rom.sizeMB || '?'} MB)</span>
        </div>
        <button type="button" class="btn-play-rom-item">▶ Jugar en la Sala</button>
      `;

      item.querySelector('.btn-play-rom-item').addEventListener('click', () => {
        switchGameInRoom({
          romUrl: rom.url,
          title: rom.title,
          core: activeCore,
          isLocalBlob: false
        });
        romSwitcherModal.classList.add('hidden');
      });

      container.appendChild(item);
    });
  }

  async function refreshRomLibraryFromServer() {
    try {
      const res = await fetch('/api/roms');
      const data = await res.json();
      if (data && Array.isArray(data.roms)) {
        availableServerRoms = data.roms;
        renderRomLibraryList();
      }
    } catch (_) {}
  }

  function switchGameInRoom({ romUrl, title, core = activeCore, isLocalBlob = false }) {
    activeCore = core;
    if (coreSelectEl) coreSelectEl.value = activeCore;
    localStorage.setItem('n64_preferred_core_v2', activeCore);

    if (isHost) {
      bootHostEmulator(romUrl, title, activeCore, true);
    }

    socket.emit('change-room-game', {
      roomId: currentRoomId,
      title,
      url: romUrl,
      core: activeCore,
      isLocalBlob
    });
  }

  async function handleSelectedRomFile(file) {
    if (!file) return;
    const gameTitle = cleanTitleFromFilename(file.name);

    if (romUploadStatus) {
      romUploadStatus.classList.remove('hidden');
      romUploadStatus.textContent = `⏳ Cargando ${gameTitle}...`;
    }

    // Si somos el Host (1P), cargamos el juego INSTANTÁNEAMENTE desde un Blob URL local
    // (0 segundos de espera, sin depender de la velocidad de subida a Render)
    if (isHost) {
      const localBlobUrl = URL.createObjectURL(file);
      switchGameInRoom({
        romUrl: localBlobUrl,
        title: gameTitle,
        core: activeCore,
        isLocalBlob: true
      });
      romSwitcherModal.classList.add('hidden');
    }

    // Además lo subimos en segundo plano al servidor para que quede en la lista de la sala
    try {
      const q = new URLSearchParams({
        name: file.name,
        room: isHost ? '' : currentRoomId
      });
      const res = await fetch(`/api/upload-rom?${q.toString()}`, {
        method: 'POST',
        headers: {
          'x-rom-name': encodeURIComponent(file.name),
          'x-room-id': isHost ? '' : currentRoomId
        },
        body: file
      });
      const data = await res.json();
      if (data && Array.isArray(data.roms)) {
        availableServerRoms = data.roms;
        renderRomLibraryList();
      }
      if (romUploadStatus) {
        romUploadStatus.textContent = `✅ ¡${gameTitle} listo en la sala!`;
      }
      if (!isHost) {
        romSwitcherModal.classList.add('hidden');
      }
    } catch (_) {
      if (romUploadStatus) {
        romUploadStatus.textContent = isHost
          ? `✅ ${gameTitle} ejecutándose desde tu navegador.`
          : `⚠️ Error al subir el archivo al servidor.`;
      }
    }
  }

  document.getElementById('open-rom-switcher-btn').addEventListener('click', () => {
    refreshRomLibraryFromServer();
    if (romUploadStatus) romUploadStatus.classList.add('hidden');
    romSwitcherModal.classList.remove('hidden');
  });

  document.getElementById('close-rom-switcher-btn').addEventListener('click', () => {
    romSwitcherModal.classList.add('hidden');
  });

  document.getElementById('trigger-rom-upload-btn').addEventListener('click', () => {
    romFilePicker.value = '';
    romFilePicker.click();
  });

  document.getElementById('select-rom-btn').addEventListener('click', () => {
    romFilePicker.value = '';
    romFilePicker.click();
  });

  romFilePicker.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleSelectedRomFile(file);
  });

  // Soporte Drag & Drop para arrastrar cualquier ROM .z64/.n64/.v64/.zip
  const dropzone = document.getElementById('rom-dropzone');
  if (dropzone) {
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      const file = e.dataTransfer?.files?.[0];
      if (file) handleSelectedRomFile(file);
    });
  }

  // Selector de motor N64 (Mupen64Plus-Next vs Parallel N64) y botón de Reinicio rápido
  if (coreSelectEl) {
    coreSelectEl.addEventListener('change', () => {
      activeCore = coreSelectEl.value;
      localStorage.setItem('n64_preferred_core_v2', activeCore);
      if (isHost && emulatorStarted) {
        bootHostEmulator(activeRomUrl, activeGameTitle, activeCore, true);
        appendChatLine('system', `⚙️ Motor N64 cambiado a: ${activeCore === 'n64' ? 'Mupen64Plus-Next (Original 4:3)' : 'Parallel N64'}.`);
      }
    });
  }

  document.getElementById('restart-emulator-btn').addEventListener('click', () => {
    if (isHost) {
      bootHostEmulator(activeRomUrl, activeGameTitle, activeCore, true);
      romSwitcherModal.classList.add('hidden');
      appendChatLine('system', `🔄 Juego reiniciado sin cerrar la sala.`);
    } else {
      socket.emit('request-stream-sync', { roomId: currentRoomId });
      romSwitcherModal.classList.add('hidden');
    }
  });

  // ==========================================================================
  // 7. RED MULTIJUGADOR (SOCKET.IO + WEBRTC P2P + GESTIÓN DE PUERTOS 1P-4P)
  // ==========================================================================
  const socket = window.io({
    reconnection: true,
    reconnectionDelay: 500,
    timeout: 20000
  });
  const peers = new Map();
  let mySlot = 0;
  let isHost = false;
  let myPingMs = 12;
  let latestRoomState = null;

  function requestChangePlayerSlot(targetSocketId, newSlot) {
    socket.emit('change-player-slot', {
      roomId: currentRoomId,
      targetSocketId,
      newSlot: Number(newSlot)
    }, (res) => {
      if (res && !res.ok && res.error) {
        appendChatLine('system', `⚠️ ${res.error}`);
      }
    });
  }

  function requestKickPlayer(targetSocketId, playerName) {
    socket.emit('kick-player', {
      roomId: currentRoomId,
      targetSocketId
    }, (res) => {
      if (res && !res.ok && res.error) {
        appendChatLine('system', `⚠️ ${res.error}`);
      }
    });
  }

  fetch('/api/rom-status')
    .then((r) => r.json())
    .then((info) => {
      if (info.lanUrl) {
        lanBaseUrl = info.lanUrl;
        refreshShareUrlBox();
      }
      if (Array.isArray(info.roms)) {
        availableServerRoms = info.roms;
        renderRomLibraryList();
      }
    })
    .catch(() => {});

  socket.on('connect', () => {
    socket.emit('join-room', {
      roomId: currentRoomId,
      name: myPlayerName,
      controllerType: detectedControllerLabel
    }, (res) => {
      if (!res || !res.ok) {
        alert(res?.error || 'No se pudo entrar a la sala.');
        return;
      }

      mySlot = res.slot;
      isHost = res.isHost;

      if (Array.isArray(res.roms)) {
        availableServerRoms = res.roms;
        renderRomLibraryList();
      }

      if (res.room?.currentGame?.title) {
        updateGameTitleUI(res.room.currentGame.title);
      }

      if (!myPlayerName) {
        myPlayerName = `Jugador ${mySlot + 1}`;
        nameInput.value = myPlayerName;
      }

      renderConnectedPlayersSidebar(res.room);

      if (isHost) {
        document.getElementById('emulator-container').classList.remove('hidden');
        document.getElementById('guest-stage').classList.add('hidden');
        const initialUrl = res.room?.currentGame?.url || '/rom/mario_tennis.z64';
        const initialTitle = res.room?.currentGame?.title || 'MARIO TENNIS 64';
        bootHostEmulator(initialUrl, initialTitle, activeCore, false);
      } else {
        document.getElementById('emulator-container').classList.add('hidden');
        document.getElementById('guest-stage').classList.remove('hidden');
        appendChatLine('system', `✅ Conectado como ${mySlot + 1}P. Puedes cambiar a 2P/3P/4P desde la lista derecha.`);
      }
    });
  });

  setInterval(() => {
    const t0 = performance.now();
    socket.emit('ping-check', t0, () => {
      myPingMs = Math.max(1, Math.round(performance.now() - t0));
      socket.emit('update-player-meta', { ping: myPingMs });
    });
  }, 4000);

  socket.on('room-state', (room) => {
    latestRoomState = room;
    if (room?.currentGame?.title) {
      updateGameTitleUI(room.currentGame.title);
    }
    if (Array.isArray(room?.players)) {
      const me = room.players.find((p) => p.socketId === socket.id);
      if (me && typeof me.slot === 'number') {
        mySlot = me.slot;
        const badge = document.getElementById('guest-stream-badge');
        if (badge && !isHost) {
          badge.textContent = `🟢 En Vivo (${mySlot + 1}P) • ${activeGameTitle}`;
        }
      }
      // Sincronizar los números de puerto en las conexiones WebRTC del Host
      if (isHost) {
        room.players.forEach((p) => {
          const peer = peers.get(p.socketId);
          if (peer) peer.slot = p.slot;
        });
      }
    }
    renderConnectedPlayersSidebar(room);
  });

  socket.on('player-slot-changed', ({ targetSocketId, oldSlot, newSlot, swappedSocketId, swappedNewSlot }) => {
    if (isHost) {
      if (typeof oldSlot === 'number') {
        injectInputIntoEmulatorJS(oldSlot, { bitmask: 0, stickX: 0, stickY: 0 });
      }
      if (typeof newSlot === 'number') {
        injectInputIntoEmulatorJS(newSlot, { bitmask: 0, stickX: 0, stickY: 0 });
      }
      const p1 = peers.get(targetSocketId);
      if (p1 && typeof newSlot === 'number') p1.slot = newSlot;
      if (swappedSocketId) {
        const p2 = peers.get(swappedSocketId);
        if (p2 && typeof swappedNewSlot === 'number') p2.slot = swappedNewSlot;
      }
    }
    if (socket.id === targetSocketId && typeof newSlot === 'number') {
      mySlot = newSlot;
    } else if (socket.id === swappedSocketId && typeof swappedNewSlot === 'number') {
      mySlot = swappedNewSlot;
    }
  });

  socket.on('kicked-from-room', ({ reason }) => {
    for (const peer of peers.values()) {
      peer.pc.close();
    }
    peers.clear();
    const guestVideo = document.getElementById('guest-video-stream');
    if (guestVideo) guestVideo.srcObject = null;
    const badge = document.getElementById('guest-stream-badge');
    if (badge) badge.textContent = `🚫 ${reason || 'Fuiste eliminado de la sala.'}`;
    appendChatLine('system', `🚫 ${reason || 'Fuiste eliminado de la sala.'}`);
  });

  socket.on('room-game-metadata', ({ title, url, core, changedBySocketId }) => {
    if (title) updateGameTitleUI(title);
    if (isHost && changedBySocketId !== socket.id && url) {
      bootHostEmulator(url, title || activeGameTitle, core || activeCore, true);
    }
  });

  socket.on('room-game-changed', ({ game, roms }) => {
    if (Array.isArray(roms)) {
      availableServerRoms = roms;
      renderRomLibraryList();
    }
    if (game) {
      updateGameTitleUI(game.title);
      if (isHost && game.url) {
        bootHostEmulator(game.url, game.title, game.core || activeCore, true);
      }
    }
  });

  socket.on('rom-ready', ({ url, title, roms }) => {
    if (Array.isArray(roms)) {
      availableServerRoms = roms;
      renderRomLibraryList();
    }
    if (isHost && !emulatorStarted) {
      bootHostEmulator(url, title || 'MARIO TENNIS 64', activeCore, false);
    }
  });

  socket.on('system-message', ({ text }) => {
    appendChatLine('system', text);
  });

  socket.on('chat-message', ({ slot, name, text }) => {
    appendChatLine('user', text, `${slot + 1}P ${name}`);
  });

  socket.on('peer-joined', async ({ peerSocketId, slot }) => {
    if (!isHost) return;
    await createHostPeerConnection(peerSocketId, slot);
  });

  socket.on('peer-left', ({ peerSocketId, slot }) => {
    injectInputIntoEmulatorJS(slot, { bitmask: 0, stickX: 0, stickY: 0 });
    const peer = peers.get(peerSocketId);
    if (peer) {
      peer.pc.close();
      peers.delete(peerSocketId);
    }
  });

  socket.on('host-promoted', ({ newHostSocketId, currentGame }) => {
    if (socket.id === newHostSocketId) {
      isHost = true;
      mySlot = 0;
      document.getElementById('emulator-container').classList.remove('hidden');
      document.getElementById('guest-stage').classList.add('hidden');
      bootHostEmulator(
        currentGame?.url || activeRomUrl,
        currentGame?.title || activeGameTitle,
        activeCore,
        true
      );
    }
  });

  socket.on('webrtc-signal', async ({ senderSocketId, signal }) => {
    try {
      let peer = peers.get(senderSocketId);
      if (!peer && !isHost && signal.type === 'offer') {
        peer = await createGuestPeerConnection(senderSocketId);
      }
      if (!peer) return;

      const { pc } = peer;
      if (signal.type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signal));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('webrtc-signal', {
          targetSocketId: senderSocketId,
          signal: pc.localDescription
        });
      } else if (signal.type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signal));
      } else if (signal.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      }
    } catch (err) {
      console.warn('[WebRTC Signal Error]:', err);
    }
  });

  socket.on('remote-input-state', ({ slot, state }) => {
    if (isHost && slot >= 1 && slot <= 3 && state) {
      injectInputIntoEmulatorJS(slot, state);
    }
  });

  async function createHostPeerConnection(guestSocketId, slot) {
    const existing = peers.get(guestSocketId);
    if (existing) existing.pc.close();

    const pc = new RTCPeerConnection(RTC_ICE_CONFIG);

    if (hostMediaStream) {
      hostMediaStream.getTracks().forEach((track) => {
        if (track.kind === 'video' && 'contentHint' in track) {
          track.contentHint = 'motion';
        }
        pc.addTrack(track, hostMediaStream);
      });
    }

    const dc = pc.createDataChannel(`input-slot-${slot}`, {
      ordered: false,
      maxRetransmits: 0
    });
    dc.binaryType = 'arraybuffer';

    dc.onmessage = (e) => {
      const decoded = decodeControllerPacket(e.data);
      const currentPeer = peers.get(guestSocketId);
      const activeSlot = currentPeer ? currentPeer.slot : slot;
      injectInputIntoEmulatorJS(activeSlot, decoded);
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit('webrtc-signal', {
          targetSocketId: guestSocketId,
          signal: { candidate: e.candidate }
        });
      }
    };

    peers.set(guestSocketId, { pc, dc, slot });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('webrtc-signal', {
      targetSocketId: guestSocketId,
      signal: pc.localDescription
    });
  }

  async function createGuestPeerConnection(hostSocketId) {
    const existing = peers.get(hostSocketId);
    if (existing) existing.pc.close();

    const pc = new RTCPeerConnection(RTC_ICE_CONFIG);
    const guestVideo = document.getElementById('guest-video-stream');
    const badge = document.getElementById('guest-stream-badge');

    pc.ontrack = (e) => {
      if (e.receiver && 'playoutDelayHint' in e.receiver) {
        e.receiver.playoutDelayHint = 0.0;
      }
      if (e.streams && e.streams[0]) {
        guestVideo.srcObject = e.streams[0];
        guestVideo.play().catch(() => {});
        badge.textContent = `🟢 En Vivo (${mySlot + 1}P) • ${activeGameTitle}`;
      }
    };

    pc.ondatachannel = (e) => {
      const dc = e.channel;
      dc.binaryType = 'arraybuffer';
      const peerObj = peers.get(hostSocketId);
      if (peerObj) peerObj.dc = dc;
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit('webrtc-signal', {
          targetSocketId: hostSocketId,
          signal: { candidate: e.candidate }
        });
      }
    };

    const peerObj = { pc, dc: null, slot: 0 };
    peers.set(hostSocketId, peerObj);
    return peerObj;
  }

  document.getElementById('unmute-guest-btn').addEventListener('click', (e) => {
    const guestVideo = document.getElementById('guest-video-stream');
    guestVideo.muted = false;
    guestVideo.play().catch(() => {});
    e.currentTarget.textContent = '🔊 Audio Activado';
  });

  document.getElementById('resync-stream-btn').addEventListener('click', () => {
    socket.emit('request-stream-sync', { roomId: currentRoomId });
  });

  // Bucle de 60Hz para aplicar controles locales y remotos sin duplicar paquetes
  let lastSentBitmask = -1;
  let lastSentX = 0;
  let lastSentY = 0;

  function updateInputsLoop() {
    const localState = sampleLocalController();

    if (isHost) {
      injectInputIntoEmulatorJS(0, localState);
    } else {
      n64Ports[mySlot].bitmask = localState.bitmask;
      n64Ports[mySlot].stickX = localState.stickX;
      n64Ports[mySlot].stickY = localState.stickY;

      const changed =
        localState.bitmask !== lastSentBitmask ||
        Math.abs(localState.stickX - lastSentX) > 0.05 ||
        Math.abs(localState.stickY - lastSentY) > 0.05;

      let sentViaWebRTC = false;
      for (const peer of peers.values()) {
        if (peer.dc && peer.dc.readyState === 'open') {
          try {
            if (changed) {
              peer.dc.send(localState.packet);
            }
            sentViaWebRTC = true;
          } catch (_) {}
        }
      }

      if (changed) {
        lastSentBitmask = localState.bitmask;
        lastSentX = localState.stickX;
        lastSentY = localState.stickY;

        // Solo enviamos por Socket.io si el canal WebRTC P2P aún no está abierto
        // (evita saturar el WebSocket de Render con paquetes duplicados)
        if (!sentViaWebRTC) {
          socket.emit('input-fallback', {
            roomId: currentRoomId,
            slot: mySlot,
            state: {
              bitmask: localState.bitmask,
              stickX: localState.stickX,
              stickY: localState.stickY
            }
          });
        }
      }
    }

    for (let s = 0; s < 4; s++) {
      const st = n64Ports[s];
      const active = Boolean(st && (st.bitmask !== 0 || Math.hypot(st.stickX, st.stickY) > 0.15));

      const topPill = document.getElementById(`slot-${s + 1}p`);
      if (topPill) topPill.classList.toggle('pressing', active);

      const sideCard = document.getElementById(`sidebar-card-${s}`);
      if (sideCard) sideCard.classList.toggle('active-input', active);
    }

    requestAnimationFrame(updateInputsLoop);
  }
  requestAnimationFrame(updateInputsLoop);

  // ==========================================================================
  // 8. PANEL LATERAL DE PERSONAS CONECTADAS, CAMBIO DE PUERTO (3P->2P) Y ELIMINAR
  // ==========================================================================
  function renderConnectedPlayersSidebar(room) {
    if (!room || !Array.isArray(room.players)) return;

    const connectedBySlot = new Map();
    room.players.forEach((p) => connectedBySlot.set(p.slot, p));

    document.getElementById('connected-count-badge').textContent = `${room.players.length}/4`;

    const listContainer = document.getElementById('connected-players-list');
    listContainer.innerHTML = '';

    for (let s = 0; s < 4; s++) {
      const player = connectedBySlot.get(s);
      const topPill = document.getElementById(`slot-${s + 1}p`);
      const topLabel = topPill.querySelector('.slot-label');

      if (player) {
        topPill.classList.add('connected');
        topPill.classList.toggle('me', s === mySlot);
        topLabel.textContent = `${s + 1}P: ${player.name}`;
      } else {
        topPill.classList.remove('connected', 'me');
        topLabel.textContent = `${s + 1}P`;
      }

      const card = document.createElement('div');
      card.id = `sidebar-card-${s}`;
      card.className = `player-card ${player ? 'online' : 'offline'} ${s === mySlot ? 'is-me' : ''}`;

      if (player) {
        const roleTag = s === 0 ? '👑 Host' : 'Invitado';
        const youTag = s === mySlot ? ' (Tú)' : '';
        const canManageSlot = s > 0 && (isHost || player.socketId === socket.id);

        card.innerHTML = `
          <div class="slot-badge p${s + 1}">${s + 1}P</div>
          <div class="player-card-info">
            <div class="player-card-name">${escapeHtml(player.name)}${youTag}</div>
            <div class="player-card-meta">${roleTag} • ${escapeHtml(player.controllerType || 'Teclado')}</div>
          </div>
          <div class="player-card-actions">
            <span class="player-ping-tag">${player.ping || 12} ms</span>
            ${canManageSlot ? `
              <select class="slot-switch-select" title="Cambiar número de Jugador (2P, 3P, 4P)">
                <option value="1" ${s === 1 ? 'selected' : ''}>2P</option>
                <option value="2" ${s === 2 ? 'selected' : ''}>3P</option>
                <option value="3" ${s === 3 ? 'selected' : ''}>4P</option>
              </select>
              <button type="button" class="btn-kick-player" title="${isHost ? 'Eliminar jugador de la sala' : 'Salir de la sala'}">✕</button>
            ` : ''}
          </div>
        `;

        if (canManageSlot) {
          const selectEl = card.querySelector('.slot-switch-select');
          if (selectEl) {
            selectEl.addEventListener('change', (e) => {
              requestChangePlayerSlot(player.socketId, Number(e.target.value));
            });
          }
          const kickBtn = card.querySelector('.btn-kick-player');
          if (kickBtn) {
            kickBtn.addEventListener('click', () => {
              requestKickPlayer(player.socketId, player.name);
            });
          }
        }
      } else {
        // Si el lugar está LIBRE (ej: 2P está libre y hay alguien en 3P o 4P)
        const otherGuest = isHost
          ? room.players.find((p) => p.slot > 0 && p.slot !== s)
          : (!isHost && mySlot > 0 ? room.players.find((p) => p.socketId === socket.id) : null);

        card.innerHTML = `
          <div class="slot-badge p${s + 1}">${s + 1}P</div>
          <div class="player-card-info">
            <div class="player-card-name">Esperando amigo...</div>
            <div class="player-card-meta">Puerto ${s + 1}P disponible</div>
          </div>
          <div class="player-card-actions">
            ${otherGuest ? `
              <button type="button" class="btn-take-slot" title="Mover a ${escapeHtml(otherGuest.name)} al lugar ${s + 1}P">
                🔄 Pasar a ${s + 1}P
              </button>
            ` : `<span class="player-ping-tag">LIBRE</span>`}
          </div>
        `;

        if (otherGuest) {
          const takeBtn = card.querySelector('.btn-take-slot');
          if (takeBtn) {
            takeBtn.addEventListener('click', () => {
              requestChangePlayerSlot(otherGuest.socketId, s);
            });
          }
        }
      }

      listContainer.appendChild(card);
    }
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  document.getElementById('name-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const val = nameInput.value.trim().substring(0, 18);
    if (!val) return;
    myPlayerName = val;
    localStorage.setItem('mt64_player_name', myPlayerName);
    socket.emit('update-player-meta', { name: myPlayerName });
  });

  nameInput.addEventListener('input', () => {
    const val = nameInput.value.trim().substring(0, 18);
    if (val) {
      myPlayerName = val;
      localStorage.setItem('mt64_player_name', myPlayerName);
      socket.emit('update-player-meta', { name: myPlayerName });
    }
  });

  function appendChatLine(type, text, author = '') {
    const box = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = `chat-line ${type}`;
    if (type === 'system') {
      div.textContent = text;
    } else {
      div.innerHTML = `<span class="chat-author">${escapeHtml(author)}:</span> ${escapeHtml(text)}`;
    }
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }

  document.getElementById('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;
    socket.emit('chat-message', { roomId: currentRoomId, text });
    input.value = '';
  });

  function copyInviteUrl(btnElement) {
    const shareUrl = getShareableInviteUrl();
    navigator.clipboard.writeText(shareUrl).then(() => {
      const prev = btnElement.textContent;
      btnElement.textContent = '✅ ¡Copiado!';
      setTimeout(() => {
        btnElement.textContent = prev;
      }, 1800);
    });
  }

  document.getElementById('copy-invite-btn').addEventListener('click', (e) => {
    copyInviteUrl(e.currentTarget);
  });

  document.getElementById('sidebar-copy-btn').addEventListener('click', (e) => {
    copyInviteUrl(e.currentTarget);
  });

  document.getElementById('toggle-sidebar-btn').addEventListener('click', () => {
    document.getElementById('players-sidebar').classList.toggle('hidden');
  });

  document.getElementById('fullscreen-btn').addEventListener('click', () => {
    const wrapper = document.getElementById('viewport-wrapper');
    if (!document.fullscreenElement) {
      wrapper.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });
})();
