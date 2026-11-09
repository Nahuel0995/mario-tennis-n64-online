const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
app.use(cors());

// Cabeceras COOP/COEP para habilitar SharedArrayBuffer en WebAssembly (Mupen64Plus-Next)
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

// Detectar IP de red local (LAN) para que el link compartido no use "localhost" cuando se envía a otra PC/celular
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

app.get('/api/rom-status', (req, res) => {
  const romPath = path.join(romDir, 'mario_tennis.z64');
  const exists = fs.existsSync(romPath);
  const PORT = process.env.PORT || 3000;
  const lanIps = getLocalNetworkIPs();
  res.json({
    exists,
    url: '/rom/mario_tennis.z64',
    lanUrl: lanIps.length > 0 ? `http://${lanIps[0]}:${PORT}` : null
  });
});

app.post('/api/upload-rom', (req, res) => {
  const targetPath = path.join(romDir, 'mario_tennis.z64');
  const writeStream = fs.createWriteStream(targetPath);

  req.pipe(writeStream);

  writeStream.on('finish', () => {
    io.emit('rom-ready', { url: '/rom/mario_tennis.z64' });
    res.status(200).json({ ok: true, url: '/rom/mario_tennis.z64' });
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
  maxHttpBufferSize: 1e7
});

/**
 * Gestión de Salas en Memoria
 * Map<roomId, {
 *   id: string,
 *   hostSocketId: string,
 *   players: Map<socketId, {
 *     socketId: string,
 *     name: string,
 *     slot: number,
 *     controllerType: string,
 *     ping: number
 *   }>
 * }>
 */
const rooms = new Map();

function serializeRoom(room) {
  return {
    id: room.id,
    hostSocketId: room.hostSocketId,
    players: Array.from(room.players.values()).sort((a, b) => a.slot - b.slot)
  };
}

io.on('connection', (socket) => {
  console.log(`[Socket] Jugador conectado: ${socket.id}`);

  socket.on('ping-check', (clientTime, ack) => {
    if (typeof ack === 'function') ack(clientTime);
  });

  // Unirse o inicializar automáticamente una sala (?room=abc12345)
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

    // Si la sala no existe, el primer usuario en entrar la inicializa como Host (1P / slot 0)
    if (!room) {
      const playerName = String(name || 'Jugador 1').trim().substring(0, 18) || 'Jugador 1';
      room = {
        id: cleanRoomId,
        hostSocketId: socket.id,
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
          room: serialized
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

    // Buscar el primer puerto disponible (0 = 1P, 1 = 2P, 2 = 3P, 3 = 4P)
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

    // Avisar a toda la sala y pedir al Host (1P) que inicie el stream hacia este nuevo jugador
    io.to(cleanRoomId).emit('system-message', {
      text: `🎾 ${playerName} se conectó como ${assignedSlot + 1}P.`
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
        room: serialized
      });
    }
  });

  // Actualizar nombre, tipo de control o ping en tiempo real
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

  // Solicitar reconexión de video WebRTC al Host
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

  // Señalización WebRTC P2P
  socket.on('webrtc-signal', ({ targetSocketId, signal }) => {
    io.to(targetSocketId).emit('webrtc-signal', {
      senderSocketId: socket.id,
      signal
    });
  });

  // Transmisión de inputs de los mandos 2P, 3P y 4P hacia el Host (1P)
  socket.on('input-fallback', ({ roomId, slot, state }) => {
    const room = rooms.get(roomId);
    if (room && room.hostSocketId) {
      io.to(room.hostSocketId).emit('remote-input-state', {
        slot,
        state
      });
    }
  });

  // Retransmisión de frames de respaldo por si WebRTC P2P tarda o es bloqueado por firewall
  socket.on('video-frame-fallback', ({ roomId, frameDataUrl }) => {
    socket.to(roomId).volatile.emit('video-frame-fallback', frameDataUrl);
  });

  // Mensajes de chat entre los jugadores conectados
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
            newHostSocketId: room.hostSocketId
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
  console.log(` 🎾 MARIO TENNIS 64 ONLINE // SERVIDOR MULTIJUGADOR`);
  console.log(` 🖥️  Local:      http://localhost:${PORT}`);
  if (lanIps.length > 0) {
    console.log(` 🌐 Red / LAN:  http://${lanIps[0]}:${PORT}`);
  }
  console.log(`======================================================\n`);
});
