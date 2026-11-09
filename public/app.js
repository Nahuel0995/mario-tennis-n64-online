// public/app.js
// Cliente Full-Stack Mario Tennis 64 Online:
// - Optimizado contra cuelgues (Cero fugas de memoria WebGL / Cero bloqueos de GPU / Fix GLideN64 Framebuffer para Mario Tennis)
// - Configurador interactivo de teclas guardado en localStorage
// - Panel lateral de Personas Conectadas con Nombre editable y Chat
// - Inyección directa de controles 1P a 4P en EmulatorJS (simulateInput sin asignación de basura en RAM)

(() => {
  const N64_BTN = {
    A:     1 << 0,  // Golpe Liftado (Topspin)
    B:     1 << 1,  // Golpe Cortado (Slice)
    Z:     1 << 2,  // Gatillo Z
    START: 1 << 3,  // Pausa / Start
    DU:    1 << 4,
    DD:    1 << 5,
    DL:    1 << 6,
    DR:    1 << 7,
    L:     1 << 8,
    R:     1 << 9,
    CU:    1 << 10, // Globo (Lob)
    CD:    1 << 11, // Dejada (Drop Shot)
    CL:    1 << 12,
    CR:    1 << 13
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
  const KEYMAP_STORAGE_KEY = 'mt64_custom_keymap_v1';

  const DEFAULT_KEYMAP = {
    UP:    'ArrowUp',
    DOWN:  'ArrowDown',
    LEFT:  'ArrowLeft',
    RIGHT: 'ArrowRight',
    A:     'KeyZ',
    B:     'KeyX',
    LOB:   'Space',
    DROP:  'KeyC',
    Z:     'KeyV',
    START: 'Enter'
  };

  const KEYMAP_DESCRIPTIONS = [
    { key: 'UP',    title: 'Mover Arriba ▲',          sub: 'Stick Analógico Arriba' },
    { key: 'DOWN',  title: 'Mover Abajo ▼',           sub: 'Stick Analógico Abajo' },
    { key: 'LEFT',  title: 'Mover Izquierda ◄',       sub: 'Stick Analógico Izquierda' },
    { key: 'RIGHT', title: 'Mover Derecha ►',         sub: 'Stick Analógico Derecha' },
    { key: 'A',     title: 'Botón A (Liftado)',       sub: 'Golpe Topspin / Confirmar' },
    { key: 'B',     title: 'Botón B (Cortado)',       sub: 'Golpe Slice / Atrás' },
    { key: 'LOB',   title: 'Globo / Smash (A+B)',     sub: 'Tiro alto al fondo o remate' },
    { key: 'DROP',  title: 'Dejada / Corta (B+C▼)',   sub: 'Tiro corto pegado a la red' },
    { key: 'Z',     title: 'Gatillo Z',               sub: 'Cambiar ángulo / Servicio' },
    { key: 'START', title: 'Botón START',             sub: 'Pausa / Saltar repetición' }
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
  // 3. MOTOR DE CONTROLES (TECLADO CONFIGURABLE + GAMEPAD API + TÁCTIL)
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

  function isTypingInInput() {
    const tag = document.activeElement?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA';
  }

  // Usamos capture=true para interceptar nuestras teclas configuradas antes que EmulatorJS
  // evitando que EmulatorJS duplique eventos en su cola SDL (lo que causaba tildes)
  window.addEventListener('keydown', (e) => {
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

    if (isTypingInInput()) return;

    const mappedCodes = Object.values(userKeymap);
    if (mappedCodes.includes(e.code)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      pressedKeys.add(e.code);
    }
  }, true);

  window.addEventListener('keyup', (e) => {
    if (pressedKeys.has(e.code)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      pressedKeys.delete(e.code);
    }
  }, true);

  window.addEventListener('blur', () => {
    pressedKeys.clear();
  });

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
    const deadzone = 0.12;
    const peakRange = 0.85;
    const mag = Math.hypot(rawX, rawY);
    if (mag < deadzone) return { x: 0, y: 0 };
    const norm = Math.min(1, (mag - deadzone) / (1 - deadzone));
    const scale = (norm / mag) * peakRange;
    return {
      x: Math.max(-1, Math.min(1, rawX * scale)),
      y: Math.max(-1, Math.min(1, rawY * scale))
    };
  }

  // Buffer reutilizable de 4 bytes para no crear basura en memoria en cada fotograma
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

    // 2. Teclado con el mapeo personalizado del jugador
    if (pressedKeys.has(userKeymap.A))     bitmask |= N64_BTN.A;
    if (pressedKeys.has(userKeymap.B))     bitmask |= N64_BTN.B;
    if (pressedKeys.has(userKeymap.LOB))   bitmask |= (N64_BTN.A | N64_BTN.B | N64_BTN.CU);
    if (pressedKeys.has(userKeymap.DROP))  bitmask |= (N64_BTN.B | N64_BTN.CD);
    if (pressedKeys.has(userKeymap.Z))     bitmask |= N64_BTN.Z;
    if (pressedKeys.has(userKeymap.START)) bitmask |= N64_BTN.START;

    let kx = 0;
    let ky = 0;
    if (pressedKeys.has(userKeymap.LEFT))  kx -= 1;
    if (pressedKeys.has(userKeymap.RIGHT)) kx += 1;
    if (pressedKeys.has(userKeymap.UP))    ky -= 1;
    if (pressedKeys.has(userKeymap.DOWN))  ky += 1;
    if (kx !== 0 || ky !== 0) {
      const mag = Math.hypot(kx, ky);
      stickX = (kx / mag) * 0.85;
      stickY = (ky / mag) * 0.85;
    }

    // 3. Controles táctiles
    if (touchState.buttons.has('A'))     bitmask |= N64_BTN.A;
    if (touchState.buttons.has('B'))     bitmask |= N64_BTN.B;
    if (touchState.buttons.has('LOB'))   bitmask |= (N64_BTN.A | N64_BTN.B | N64_BTN.CU);
    if (touchState.buttons.has('DROP'))  bitmask |= (N64_BTN.B | N64_BTN.CD);
    if (touchState.buttons.has('START')) bitmask |= N64_BTN.START;
    if (touchState.stickX !== 0 || touchState.stickY !== 0) {
      stickX = touchState.stickX;
      stickY = touchState.stickY;
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
      stickX: view.getInt8(2) / 127,
      stickY: view.getInt8(3) / 127
    };
  }

  // ==========================================================================
  // 4. INYECCIÓN SIN FUGAS DE MEMORIA EN EMULATORJS (1P A 4P)
  // ==========================================================================
  // Pre-asignamos un Int32Array(24) por cada uno de los 4 puertos para 0 Garbage Collection
  const prevSimCache = [
    new Int32Array(24).fill(-1),
    new Int32Array(24).fill(-1),
    new Int32Array(24).fill(-1),
    new Int32Array(24).fill(-1)
  ];

  function injectInputIntoEmulatorJS(slot, state) {
    n64Ports[slot].bitmask = state.bitmask || 0;
    n64Ports[slot].stickX = state.stickX || 0;
    n64Ports[slot].stickY = state.stickY || 0;

    const gm = window.EJS_emulator?.gameManager;
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
    updateBtn(16, sx >  0.08 ? Math.round(sx * 32767)  : 0);
    updateBtn(17, sx < -0.08 ? Math.round(-sx * 32767) : 0);
    updateBtn(18, sy >  0.08 ? Math.round(sy * 32767)  : 0);
    updateBtn(19, sy < -0.08 ? Math.round(-sy * 32767) : 0);
    updateBtn(20, (bm & N64_BTN.CR)    ? 32767 : 0);
    updateBtn(21, (bm & N64_BTN.CL)    ? 32767 : 0);
    updateBtn(22, (bm & N64_BTN.CD)    ? 32767 : 0);
    updateBtn(23, (bm & N64_BTN.CU)    ? 32767 : 0);
  }

  // ==========================================================================
  // 5. INICIALIZACIÓN DE EMULATORJS CON PARCHES ANTI-TILDE PARA MARIO TENNIS 64
  // ==========================================================================
  let emulatorStarted = false;
  let capturedAudioDest = null;
  let hostMediaStream = null;
  let canvasWatcherId = null;

  function hookEmulatorWebAudio() {
    const NativeAudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!NativeAudioCtx || window._audioHooked) return;
    window._audioHooked = true;

    window.AudioContext = function (...args) {
      const ctx = new NativeAudioCtx(...args);
      capturedAudioDest = ctx.createMediaStreamDestination();
      const origConnect = AudioNode.prototype.connect;
      AudioNode.prototype.connect = function (dest, ...rest) {
        if (dest === ctx.destination && capturedAudioDest) {
          try { origConnect.call(this, capturedAudioDest); } catch (_) {}
        }
        return origConnect.call(this, dest, ...rest);
      };
      return ctx;
    };
  }

  function startHostStreamCaptureWatcher() {
    if (canvasWatcherId) return;

    canvasWatcherId = setInterval(() => {
      if (hostMediaStream) {
        clearInterval(canvasWatcherId);
        canvasWatcherId = null;
        return;
      }
      const canvas = document.querySelector('#game canvas');
      if (canvas && canvas.width > 0 && typeof canvas.captureStream === 'function') {
        // Capturamos a 30 FPS por hardware (cero bloqueos de GPU glReadPixels)
        const stream = canvas.captureStream(30);
        if (capturedAudioDest) {
          capturedAudioDest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
        }
        hostMediaStream = stream;
        appendChatLine('system', '🟢 Transmisión WebRTC acelerada por hardware lista.');

        for (const [peerSocketId, peer] of peers.entries()) {
          createHostPeerConnection(peerSocketId, peer.slot);
        }
      }
    }, 700);
  }

  async function bootHostEmulator(romUrl = '/rom/mario_tennis.z64') {
    if (emulatorStarted) return;

    try {
      const check = await fetch('/api/rom-status');
      const status = await check.json();
      if (status.lanUrl) {
        lanBaseUrl = status.lanUrl;
        refreshShareUrlBox();
      }
      if (!status.exists && romUrl === '/rom/mario_tennis.z64') {
        document.getElementById('rom-missing-modal').classList.remove('hidden');
        return;
      }
    } catch (_) {}

    document.getElementById('rom-missing-modal').classList.add('hidden');
    emulatorStarted = true;

    hookEmulatorWebAudio();
    startHostStreamCaptureWatcher();

    window.EJS_player = '#game';
    window.EJS_core = 'n64';
    window.EJS_gameName = 'Mario Tennis 64';
    window.EJS_gameUrl = romUrl;
    window.EJS_pathtodata = 'https://cdn.emulatorjs.org/stable/data/';
    window.EJS_startOnLoaded = true;
    window.EJS_color = '#22c55e';
    window.EJS_backgroundColor = '#000000';

    window.EJS_Buttons = {
      playPause: false,
      restart: false,
      mute: false,
      settings: false,
      fullscreen: false,
      saveState: false,
      loadState: false,
      screenRecord: false,
      gamepad: false,
      cheat: false,
      volume: false,
      saveSavFiles: false,
      loadSavFiles: false,
      quickSave: false,
      quickLoad: false,
      screenshot: false,
      cacheManager: false
    };

    // Ajustes críticos del núcleo Mupen64Plus-Next para evitar que Mario Tennis 64 se tilde en las repeticiones:
    // Desactivar EnableFBEmulation y CopyColorToRDRAM evita el clásico cuelgue de GLideN64 en Mario Tennis.
    window.EJS_defaultOptions = {
      'mupen64plus-cpucore': 'dynamic_recompiler',
      'mupen64plus-CountPerOp': '2',
      'mupen64plus-EnableFBEmulation': 'False',
      'mupen64plus-EnableCopyColorToRDRAM': 'Off',
      'mupen64plus-EnableCopyDepthToRDRAM': 'Off',
      'mupen64plus-aspect': '4:3',
      'mupen64plus-pak1': 'memory',
      'mupen64plus-pak2': 'none',
      'mupen64plus-pak3': 'none',
      'mupen64plus-pak4': 'none'
    };

    const script = document.createElement('script');
    script.src = 'https://cdn.emulatorjs.org/stable/data/loader.js';
    script.async = true;
    document.body.appendChild(script);
  }

  const romPicker = document.getElementById('rom-file-picker');
  document.getElementById('select-rom-btn').addEventListener('click', () => romPicker.click());
  romPicker.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const localBlobUrl = URL.createObjectURL(file);
    bootHostEmulator(localBlobUrl);
    try {
      await fetch('/api/upload-rom', { method: 'POST', body: file });
    } catch (_) {}
  });

  // ==========================================================================
  // 6. RED MULTIJUGADOR (SOCKET.IO + WEBRTC P2P)
  // ==========================================================================
  const socket = window.io();
  const peers = new Map();
  let mySlot = 0;
  let isHost = false;
  let myPingMs = 12;

  fetch('/api/rom-status')
    .then((r) => r.json())
    .then((info) => {
      if (info.lanUrl) {
        lanBaseUrl = info.lanUrl;
        refreshShareUrlBox();
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

      if (!myPlayerName) {
        myPlayerName = `Jugador ${mySlot + 1}`;
        nameInput.value = myPlayerName;
      }

      renderConnectedPlayersSidebar(res.room);

      if (isHost) {
        document.getElementById('emulator-container').classList.remove('hidden');
        document.getElementById('guest-stage').classList.add('hidden');
        bootHostEmulator('/rom/mario_tennis.z64');
      } else {
        document.getElementById('emulator-container').classList.add('hidden');
        document.getElementById('guest-stage').classList.remove('hidden');
        appendChatLine('system', `✅ Conectado como ${mySlot + 1}P. Puedes configurar tus teclas arriba en "⚙️ Configurar Teclas".`);
      }
    });
  });

  setInterval(() => {
    const t0 = performance.now();
    socket.emit('ping-check', t0, () => {
      myPingMs = Math.max(1, Math.round(performance.now() - t0));
      socket.emit('update-player-meta', { ping: myPingMs });
    });
  }, 3000);

  socket.on('room-state', (room) => {
    renderConnectedPlayersSidebar(room);
  });

  socket.on('rom-ready', ({ url }) => {
    if (isHost && !emulatorStarted) {
      bootHostEmulator(url);
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

  socket.on('host-promoted', ({ newHostSocketId }) => {
    if (socket.id === newHostSocketId) {
      isHost = true;
      mySlot = 0;
      document.getElementById('emulator-container').classList.remove('hidden');
      document.getElementById('guest-stage').classList.add('hidden');
      bootHostEmulator('/rom/mario_tennis.z64');
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
      injectInputIntoEmulatorJS(slot, decoded);
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
        badge.textContent = `🟢 Partido en Vivo Conectado (${mySlot + 1}P)`;
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

  // Bucle de 60Hz para aplicar controles locales y remotos
  let lastSentBitmask = -1;
  let lastSentX = 0;
  let lastSentY = 0;

  function updateInputsLoop() {
    const localState = sampleLocalController();

    if (isHost) {
      // El Host (1P) inyecta sus teclas personalizadas directamente en el slot 0
      injectInputIntoEmulatorJS(0, localState);
    } else {
      n64Ports[mySlot].bitmask = localState.bitmask;
      n64Ports[mySlot].stickX = localState.stickX;
      n64Ports[mySlot].stickY = localState.stickY;

      let sentViaWebRTC = false;
      for (const peer of peers.values()) {
        if (peer.dc && peer.dc.readyState === 'open') {
          try {
            peer.dc.send(localState.packet);
            sentViaWebRTC = true;
          } catch (_) {}
        }
      }

      const changed =
        localState.bitmask !== lastSentBitmask ||
        Math.abs(localState.stickX - lastSentX) > 0.04 ||
        Math.abs(localState.stickY - lastSentY) > 0.04;

      if (changed || !sentViaWebRTC) {
        if (changed) {
          lastSentBitmask = localState.bitmask;
          lastSentX = localState.stickX;
          lastSentY = localState.stickY;
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
  // 7. PANEL LATERAL DE PERSONAS CONECTADAS, NOMBRES Y CHAT
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
        card.innerHTML = `
          <div class="slot-badge p${s + 1}">${s + 1}P</div>
          <div class="player-card-info">
            <div class="player-card-name">${escapeHtml(player.name)}${youTag}</div>
            <div class="player-card-meta">${roleTag} • ${escapeHtml(player.controllerType || 'Teclado')}</div>
          </div>
          <span class="player-ping-tag">${player.ping || 12} ms</span>
        `;
      } else {
        card.innerHTML = `
          <div class="slot-badge p${s + 1}">${s + 1}P</div>
          <div class="player-card-info">
            <div class="player-card-name">Esperando amigo...</div>
            <div class="player-card-meta">Comparte el link para conectar ${s + 1}P</div>
          </div>
          <span class="player-ping-tag">LIBRE</span>
        `;
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
