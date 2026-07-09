'use strict';
/**
 * The classroom server: Express (static pages) + Socket.IO (game protocol)
 * around one authoritative Session. Runs on the teacher's machine; students
 * reach it over the room's LAN. No internet needed.
 *
 * Routes:
 *   /            student client (join screen; ?room=CODE pre-fills)
 *   /host        teacher control view  (?key=HOSTKEY)
 *   /cast        projector view        (?key=HOSTKEY)
 *   /qr.png      QR code of the join URL
 *   /health      JSON liveness probe
 */

const http = require('http');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const { EVENTS } = require('./protocol');
const { Session } = require('./session');
const store = require('./store');

function getLanIPs() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ iface: name, address: a.address });
    }
  }
  // Prefer classic private ranges (travel router / hotspot) over anything exotic.
  out.sort((a, b) => rank(a.address) - rank(b.address));
  return out;
  function rank(ip) {
    if (ip.startsWith('192.168.')) return 0;
    if (ip.startsWith('10.')) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2;
    return 3;
  }
}

function makeRoomCode() {
  // Unambiguous alphabet (no 0/O, 1/I) — students type this if the QR fails.
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (const b of crypto.randomBytes(4)) code += alphabet[b % alphabet.length];
  return code;
}

/**
 * Create (or restore) a server around one session.
 * opts: { pack, shell, settings, port, hostKey, preview, resumeDir }
 */
async function createServer(opts) {
  const {
    pack, shell, settings = {}, port = 3131,
    hostKey = crypto.randomBytes(6).toString('hex'),
    preview = false, resumeDir = null,
  } = opts;

  store.ensureDirs();
  const app = express();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, { cors: { origin: true } });

  let session;
  let sessionDir;
  let roomCode;
  if (resumeDir) {
    const checkpoint = store.readCheckpoint(resumeDir);
    if (!checkpoint) throw new Error(`No checkpoint found in ${resumeDir}`);
    sessionDir = resumeDir;
    roomCode = checkpoint.roomCode;
    session = Session.restore(checkpoint, { io, pack, shell, settings: checkpoint.settings, sessionDir, roomCode, hostKey, preview: checkpoint.preview });
  } else {
    sessionDir = store.newSessionDir(pack.packId, { preview });
    roomCode = makeRoomCode();
    session = new Session({ io, pack, shell, settings, sessionDir, roomCode, hostKey, preview });
  }

  // ── static pages ──
  app.use(express.static(path.join(__dirname, 'client')));
  app.get('/host', (_req, res) => res.sendFile(path.join(__dirname, 'host', 'control.html')));
  app.get('/cast', (_req, res) => res.sendFile(path.join(__dirname, 'host', 'cast.html')));
  app.use('/host-assets', express.static(path.join(__dirname, 'host')));
  app.get('/qr.png', async (_req, res) => {
    try {
      const png = await QRCode.toBuffer(session.joinUrl || 'http://localhost', { width: 480, margin: 1 });
      res.type('png').send(png);
    } catch (e) {
      res.status(500).send(String(e));
    }
  });
  app.get('/health', (_req, res) => res.json({ ok: true, phase: session.phase, room: roomCode }));

  // ── sockets ──
  io.on('connection', (socket) => {
    socket.on(EVENTS.JOIN, (payload, cb) => session.handleJoin(socket, payload || {}, cb));
    socket.on(EVENTS.INPUT, (payload) => session.handleInput(socket, payload || {}));
    socket.on(EVENTS.LEAVE, () => session.handleDisconnect(socket));
    socket.on('disconnect', () => {
      if (socket.data.isHost) return;
      session.handleDisconnect(socket);
    });

    socket.on(EVENTS.HOST_AUTH, (payload, cb) => {
      const ok = payload && payload.key === hostKey;
      if (ok) {
        socket.data.isHost = true;
        socket.join('hosts');
        session.pushDashboard();
      }
      if (typeof cb === 'function') cb({ ok });
    });

    socket.on(EVENTS.HOST_CONTROL, (payload, cb) => {
      const done = typeof cb === 'function' ? cb : () => {};
      if (!socket.data.isHost) return done({ ok: false, error: 'not-authorized' });
      const { action, args } = payload || {};
      try {
        done(session.hostControl(action, args || {}));
      } catch (e) {
        done({ ok: false, error: String(e && e.message || e) });
      }
    });
  });

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, '0.0.0.0', resolve);
  });
  const actualPort = httpServer.address().port;

  const ips = getLanIPs();
  const bestIp = ips[0] ? ips[0].address : 'localhost';
  session.joinUrl = `http://${bestIp}:${actualPort}/?room=${roomCode}`;
  session.emitLobby();

  return {
    httpServer, io, session, sessionDir, roomCode, hostKey,
    port: actualPort,
    joinUrl: session.joinUrl,
    hostUrl: `http://localhost:${actualPort}/host?key=${hostKey}`,
    castUrl: `http://localhost:${actualPort}/cast?key=${hostKey}`,
    lanIPs: ips,
    async stop() {
      session.stopTick();
      session.clearRoundTimer();
      io.close();
      await new Promise((r) => httpServer.close(r));
    },
  };
}

module.exports = { createServer, getLanIPs, makeRoomCode };
