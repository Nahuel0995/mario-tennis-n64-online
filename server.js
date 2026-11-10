const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
app.use(cors());

// Cabeceras COOP/COEP para WebAssembly de alta velocidad
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  next();
});

const romDir = path.join(__dirname, 'rom');
if (!fs.existsSync(romDir)) {
  fs.mkdirSync(romDir, { recursive: true });
}

app.use(express.static(path.join(__dirname, 'public')));
app.use('/rom', express.static(romDir));

function getLocalNetworkIPs() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips;
}

function formatGameTitleFromFilename(filename) {
  const base = path.basename(filename, path.extname(filename));
  const clean = base
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return 'Juego N64';
  return clean.toUpperCase();
}

function listAvailableRoms() {
  try {
    const validExts = new Set(['.z64', '.n64', '.v64', '.zip']);
    const files = fs.readdirSync(romDir);
    return files
      .filter((f) => validExts.has(path.extname(f).toLowerCase()))
      .map((f) => {
        const stat = fs.statSync(path.join(romDir, f));
        return {
          filename: f,
          title: formatGameTitleFromFilename(f),
          url: `/rom/${encodeURIComponent(f)}`,
          sizeMB: Number((stat.size / (1024 * 1024)).toFixed(1))
        };
      });
  } catch (_) {
    return [];
  }
}

app.get('/api/rom-status', (req, res) => {
  const roms = listAvailableRoms();
  const defaultRom = roms.find((r) => r.filename.toLowerCase() === 'mario_tennis.z64') || roms[0] || null;
  const PORT = process.env.PORT || 3000;
  const lanIps = getLocalNetworkIPs();
  res.json({
    exists: Boolean(defaultRom),
    url: defaultRom ? defaultRom.url : '/rom/mario_tennis.z64',
    title: defaultRom ? defaultRom.title : 'MARIO TENNIS 64',
    roms,
    lanUrl: lanIps.length > 0 ? `http://${lanIps[0]}:${PORT}` : null
  });
});

app.get('/api/roms', (req, res) => {
  res.json({
    ok: true,
    roms: listAvailableRoms()
  });
});

// Subir cualquier ROM de Nintendo 64 (.z64, .n64, .v64, .zip) y opcionalmente cambiar el juego de la sala
app.post('/api/upload-rom', (req, res) => {
  const rawName = String(req.query.name || req.headers['x-rom-name'] || 'mario_tennis.z64').trim();
  const roomId = String(req.query.room || req.headers['x-room-id'] || '').trim().toLowerCase();
  const ext = path.extname(rawName).toLowerCase();
  const validExts = new Set(['.z64', '.n64', '.v64', '.zip']);
  const safeExt = validExts.has(ext) ? ext : '.z64';

  const baseName = path
    .basename(rawName, ext || undefined)
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 48) || 'juego_n64';

  const finalFilename = `${baseName}${safeExt}`;
  const targetPath = path.join(romDir, finalFilename);
  const writeStream = fs.createWriteStream(targetPath);

  req.pipe(writeStream);

  writeStream.on('finish', () => {
    const romUrl = `/rom/${encodeURIComponent(finalFilename)}`;
    const gameTitle = formatGameTitleFromFilename(finalFilename);
    const roms = listAvailableRoms();

    if (roomId && rooms.has(roomId)) {
      const room = rooms.get(roomId);
      room.currentGame = {
        title: gameTitle,
        url: romUrl,
        filename: finalFilename,
        core: room.currentGame?.core || 'parallel_n64'
      };
      io.to(roomId).emit('room-game-changed', {
        game: room.currentGame,
        roms
      });
      io.to(roomId).emit('system-message', {
        text: `🎮 Nueva ROM cargada en la sala: ${gameTitle}`
      });
    } else {
      io.emit('rom-ready', { url: romUrl, title: gameTitle, roms });
    }

    res.status(200).json({
      ok: true,
      filename: finalFilename,
      title: gameTitle,
      url: romUrl,
      roms
    });
  });

  writeStream.on('error', (err) => {
    res.status(500).json({ ok: false, error: err.message });
  });
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingInterval: 10000,
  pingTimeout: 20000,
  perMessageDeflate: false,
  maxHttpBufferSize: 1e7
});

const rooms = new Map();

function serializeRoom(room) {
  return {
    id: room.id,
    hostSocketId: room.hostSocketId,
    currentGame: room.currentGame || {
      title: 'MARIO TENNIS 64',
      url: '/rom/mario_tennis.z64',
      core: 'parallel_n64'
    },
    players: Array.from(room.players.values()).sort((a, b) => a.slot - b.slot)
  };
}

io.on('connection', (socket) => {
  console.log(`[Socket] Jugador conectado: ${socket.id}`);

  socket.on('ping-check', (clientTime, ack) => {
    if (typeof ack === 'function') ack(clientTime);
  });

  socket.on('join-room', ({ roomId, name, controllerType }, ack) => {
    const cleanRoomId = String(roomId || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '');

    if (!cleanRoomId) {
      if (typeof ack === 'function') ack({ ok: false, error: 'ID de sala inválido.' });
      return;
    }

    leaveCurrentRooms(socket);

    let room = rooms.get(cleanRoomId);

    if (!room) {
      const playerName = String(name || 'Jugador 1').trim().substring(0, 18) || 'Jugador 1';
      const roms = listAvailableRoms();
      const defaultRom = roms.find((r) => r.filename.toLowerCase() === 'mario_tennis.z64') || roms[0];

      room = {
        id: cleanRoomId,
        hostSocketId: socket.id,
        currentGame: {
          title: defaultRom ? defaultRom.title : 'MARIO TENNIS 64',
          url: defaultRom ? defaultRom.url : '/rom/mario_tennis.z64',
          core: 'parallel_n64'
        },
        players: new Map()
      };
      room.players.set(socket.id, {
        socketId: socket.id,
        name: playerName,
        slot: 0,
        controllerType: controllerType || 'Teclado',
        ping: 10
      });
      rooms.set(cleanRoomId, room);
      socket.join(cleanRoomId);

      const serialized = serializeRoom(room);
      io.to(cleanRoomId).emit('room-state', serialized);

      console.log(`[Sala ${cleanRoomId}] Creada por 1P ${playerName} (${socket.id})`);

      if (typeof ack === 'function') {
        ack({
          ok: true,
          roomId: cleanRoomId,
          slot: 0,
          isHost: true,
          hostSocketId: socket.id,
          room: serialized,
          roms
        });
      }
      return;
    }

    if (room.players.size >= 4 && !room.players.has(socket.id)) {
      if (typeof ack === 'function') {
        ack({ ok: false, error: 'La sala ya tiene los 4 jugadores conectados (1P-4P).' });
      }
      return;
    }

    const occupiedSlots = new Set(Array.from(room.players.values()).map((p) => p.slot));
    let assignedSlot = 0;
    while (occupiedSlots.has(assignedSlot) && assignedSlot < 4) {
      assignedSlot++;
    }

    const defaultName = `Jugador ${assignedSlot + 1}`;
    const playerName = String(name || defaultName).trim().substring(0, 18) || defaultName;

    room.players.set(socket.id, {
      socketId: socket.id,
      name: playerName,
      slot: assignedSlot,
      controllerType: controllerType || 'Teclado',
      ping: 18
    });

    socket.join(cleanRoomId);

    const serialized = serializeRoom(room);
    io.to(cleanRoomId).emit('room-state', serialized);

    io.to(cleanRoomId).emit('system-message', {
      text: `🎮 ${playerName} se conectó como ${assignedSlot + 1}P.`
    });

    if (room.hostSocketId !== socket.id) {
      io.to(room.hostSocketId).emit('peer-joined', {
        peerSocketId: socket.id,
        slot: assignedSlot,
        name: playerName
      });
    }

    console.log(`[Sala ${cleanRoomId}] ${playerName} unido en ${assignedSlot + 1}P (${socket.id})`);

    if (typeof ack === 'function') {
      ack({
        ok: true,
        roomId: cleanRoomId,
        slot: assignedSlot,
        isHost: room.hostSocketId === socket.id,
        hostSocketId: room.hostSocketId,
        room: serialized,
        roms: listAvailableRoms()
      });
    }
  });

  // Cambiar de juego o núcleo N64 dentro de la misma sala sin desconectar a los amigos
  socket.on('change-room-game', ({ roomId, title, url, core, isLocalBlob }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    const cleanTitle = String(title || 'JUEGO N64').trim().substring(0, 40).toUpperCase();
    const cleanCore = core === 'n64' ? 'n64' : 'parallel_n64';

    room.currentGame = {
      title: cleanTitle,
      url: isLocalBlob ? room.currentGame?.url : (url || room.currentGame?.url || '/rom/mario_tennis.z64'),
      core: cleanCore
    };

    io.to(roomId).emit('room-state', serializeRoom(room));
    io.to(roomId).emit('room-game-metadata', {
      title: cleanTitle,
      core: cleanCore,
      url: isLocalBlob ? null : url,
      changedBySocketId: socket.id
    });
    io.to(roomId).emit('system-message', {
      text: `🕹️ ${player ? player.name : 'Host'} cambió el juego a: ${cleanTitle}`
    });
  });

  socket.on('update-player-meta', ({ name, controllerType, ping }) => {
    for (const [roomId, room] of rooms.entries()) {
      if (room.players.has(socket.id)) {
        const player = room.players.get(socket.id);
        if (typeof name === 'string' && name.trim()) {
          player.name = name.trim().substring(0, 18);
        }
        if (controllerType) player.controllerType = controllerType;
        if (typeof ping === 'number') player.ping = ping;
        io.to(roomId).emit('room-state', serializeRoom(room));
      }
    }
  });

  socket.on('request-stream-sync', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (room && room.hostSocketId && room.players.has(socket.id)) {
      const player = room.players.get(socket.id);
      io.to(room.hostSocketId).emit('peer-joined', {
        peerSocketId: socket.id,
        slot: player.slot,
        name: player.name
      });
    }
  });

  socket.on('webrtc-signal', ({ targetSocketId, signal }) => {
    io.to(targetSocketId).emit('webrtc-signal', {
      senderSocketId: socket.id,
      signal
    });
  });

  socket.on('input-fallback', ({ roomId, slot, state }) => {
    const room = rooms.get(roomId);
    if (room && room.hostSocketId) {
      io.to(room.hostSocketId).emit('remote-input-state', {
        slot,
        state
      });
    }
  });

  socket.on('chat-message', ({ roomId, text }) => {
    const room = rooms.get(roomId);
    if (!room || !room.players.has(socket.id)) return;
    const player = room.players.get(socket.id);
    const cleanText = String(text || '').trim().substring(0, 140);
    if (!cleanText) return;

    io.to(roomId).emit('chat-message', {
      slot: player.slot,
      name: player.name,
      text: cleanText,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  });

  socket.on('disconnect', () => {
    leaveCurrentRooms(socket);
  });
});

function leaveCurrentRooms(socket) {
  for (const [roomId, room] of rooms.entries()) {
    if (room.players.has(socket.id)) {
      const leaving = room.players.get(socket.id);
      room.players.delete(socket.id);
      socket.leave(roomId);

      if (room.players.size === 0) {
        rooms.delete(roomId);
      } else {
        if (room.hostSocketId === socket.id) {
          const nextHost = room.players.values().next().value;
          room.hostSocketId = nextHost.socketId;
          nextHost.slot = 0;
          io.to(roomId).emit('host-promoted', {
            newHostSocketId: room.hostSocketId,
            currentGame: room.currentGame
          });
        }

        io.to(roomId).emit('peer-left', {
          peerSocketId: socket.id,
          slot: leaving.slot,
          name: leaving.name
        });
        io.to(roomId).emit('system-message', {
          text: `🔌 ${leaving.name} (${leaving.slot + 1}P) salió de la sala.`
        });
        io.to(roomId).emit('room-state', serializeRoom(room));
      }
    }
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  const lanIps = getLocalNetworkIPs();
  console.log(`\n======================================================`);
  console.log(` 🎮 N64 ONLINE ARENA // SERVIDOR MULTIJUGADOR P2P`);
  console.log(` 🖥️  Local:      http://localhost:${PORT}`);
  if (lanIps.length > 0) {
    console.log(` 🌐 Red / LAN:  http://${lanIps[0]}:${PORT}`);
  }
  console.log(`======================================================\n`);
});
