const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json({ limit: '50mb' }));

// ── ADMIN ─────────────────────────────────────────────────────────────────────
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'admin';
const ADMIN_TOKENS = new Set(); // basit session token

function genToken() {
  return crypto.randomBytes(24).toString('hex');
}
function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || !ADMIN_TOKENS.has(token)) return res.status(401).json({ ok: false, error: 'Yetkisiz' });
  next();
}

// ── ODALAR (disk'ten yükle, yoksa varsayılan) ─────────────────────────────────
const ROOMS_FILE = path.join(__dirname, 'rooms.json');
const SHUTDOWN_TIME = new Date('2030-12-31T23:59:59+03:00').getTime();
const MAX_MESSAGES = 200;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function loadRooms() {
  try {
    if (fs.existsSync(ROOMS_FILE)) return JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8'));
  } catch(e) {}
  return {
    '1': { name: 'Oda 1', password: 'sifre1' },
    '2': { name: 'Oda 2', password: 'sifre2' },
    '3': { name: 'Oda 3', password: 'sifre3' },
    '4': { name: 'Oda 4', password: 'sifre4' },
    '5': { name: 'Oda 5', password: 'sifre5' },
  };
}
function saveRooms() {
  fs.writeFileSync(ROOMS_FILE, JSON.stringify(ROOMS, null, 2), 'utf8');
}

let ROOMS = loadRooms();

// Her oda için mesaj & client
const roomMessages = {};
const roomClients  = {};

function initRoom(id) {
  if (roomMessages[id]) return;
  const dbFile = path.join(__dirname, `messages_room${id}.json`);
  let msgs = [];
  try { if (fs.existsSync(dbFile)) msgs = JSON.parse(fs.readFileSync(dbFile, 'utf8')); } catch(e) {}
  const cutoff = Date.now() - MAX_AGE_MS;
  msgs = msgs.filter(m => new Date(m.time).getTime() > cutoff);
  roomMessages[id] = msgs;
  roomClients[id]  = new Map();
  fs.writeFileSync(dbFile, JSON.stringify(msgs), 'utf8');
}

Object.keys(ROOMS).forEach(initRoom);

function saveRoomMessages(roomId) {
  fs.writeFileSync(path.join(__dirname, `messages_room${roomId}.json`), JSON.stringify(roomMessages[roomId]), 'utf8');
}
function cleanRoom(roomId) {
  if (!roomMessages[roomId]) return;
  const cutoff = Date.now() - MAX_AGE_MS;
  roomMessages[roomId] = roomMessages[roomId].filter(m => new Date(m.time).getTime() > cutoff);
  saveRoomMessages(roomId);
}
setInterval(() => Object.keys(ROOMS).forEach(cleanRoom), 60 * 60 * 1000);

function broadcastToRoom(roomId, data) {
  if (!roomClients[roomId]) return;
  const str = JSON.stringify(data);
  roomClients[roomId].forEach((_, ws) => { if (ws.readyState === WebSocket.OPEN) ws.send(str); });
}
function broadcastOnline(roomId) {
  if (!roomClients[roomId]) return;
  const users = Array.from(roomClients[roomId].values());
  broadcastToRoom(roomId, { type: 'online', count: users.length, users });
}

// ── CLOUDINARY ────────────────────────────────────────────────────────────────
function uploadToCloudinary(base64Data, resourceType, callback) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey    = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHash('sha1').update(`timestamp=${timestamp}${apiSecret}`).digest('hex');
  const postData  = `file=${encodeURIComponent(base64Data)}&timestamp=${timestamp}&api_key=${apiKey}&signature=${signature}`;
  const options   = {
    hostname: 'api.cloudinary.com',
    path: `/v1_1/${cloudName}/${resourceType}/upload`,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) }
  };
  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      try { const r = JSON.parse(data); r.secure_url ? callback(null, r.secure_url) : callback(new Error(JSON.stringify(r))); }
      catch(e) { callback(e); }
    });
  });
  req.on('error', callback);
  req.write(postData);
  req.end();
}

// ── STATIC ────────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── AUTH ──────────────────────────────────────────────────────────────────────
app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = genToken();
    ADMIN_TOKENS.add(token);
    return res.json({ ok: true, token });
  }
  res.status(403).json({ ok: false, error: 'Kullanıcı adı veya şifre hatalı' });
});

app.post('/admin/logout', requireAdmin, (req, res) => {
  ADMIN_TOKENS.delete(req.headers['x-admin-token']);
  res.json({ ok: true });
});

// ── ADMIN PANEL API ───────────────────────────────────────────────────────────
// Odaları listele
app.get('/admin/rooms', requireAdmin, (req, res) => {
  const list = Object.entries(ROOMS).map(([id, r]) => ({ id, name: r.name, password: r.password, online: roomClients[id] ? roomClients[id].size : 0 }));
  res.json(list);
});

// Oda güncelle (isim + şifre)
app.put('/admin/rooms/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { name, password } = req.body;
  if (!ROOMS[id]) return res.status(404).json({ ok: false, error: 'Oda yok' });
  if (name)     ROOMS[id].name     = String(name).slice(0, 40);
  if (password) ROOMS[id].password = String(password).slice(0, 100);
  saveRooms();
  res.json({ ok: true });
});

// Yeni oda ekle
app.post('/admin/rooms', requireAdmin, (req, res) => {
  const { name, password } = req.body;
  if (!name || !password) return res.status(400).json({ ok: false, error: 'Eksik alan' });
  const id = String(Date.now());
  ROOMS[id] = { name: String(name).slice(0, 40), password: String(password).slice(0, 100) };
  initRoom(id);
  saveRooms();
  res.json({ ok: true, id });
});

// Oda sil
app.delete('/admin/rooms/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  if (!ROOMS[id]) return res.status(404).json({ ok: false, error: 'Oda yok' });
  // odadaki herkesi kopar
  if (roomClients[id]) roomClients[id].forEach((_, ws) => ws.close());
  delete ROOMS[id];
  delete roomMessages[id];
  delete roomClients[id];
  saveRooms();
  res.json({ ok: true });
});

// Odanın mesajlarını sil
app.delete('/admin/rooms/:id/messages', requireAdmin, (req, res) => {
  const { id } = req.params;
  if (!ROOMS[id]) return res.status(404).json({ ok: false, error: 'Oda yok' });
  roomMessages[id] = [];
  saveRoomMessages(id);
  broadcastToRoom(id, { type: 'history', messages: [] });
  res.json({ ok: true });
});

// ── PUBLIC API ────────────────────────────────────────────────────────────────
app.get('/shutdown-time', (req, res) => res.json({ shutdownTime: SHUTDOWN_TIME }));

app.get('/rooms', (req, res) => {
  const list = Object.entries(ROOMS).map(([id, r]) => ({ id, name: r.name }));
  res.json(list);
});

app.post('/verify-room', (req, res) => {
  const { roomId, password } = req.body;
  const room = ROOMS[roomId];
  if (!room) return res.status(404).json({ ok: false, error: 'Oda bulunamadı' });
  if (room.password !== password) return res.status(403).json({ ok: false, error: 'Yanlış şifre' });
  res.json({ ok: true, roomName: room.name });
});

app.post('/upload-audio', (req, res) => {
  if (Date.now() >= SHUTDOWN_TIME) return res.status(403).json({ error: 'closed' });
  const { audio, nick, roomId } = req.body;
  if (!audio || !nick || !ROOMS[roomId]) return res.status(400).json({ error: 'missing' });
  uploadToCloudinary(audio, 'video', (err, url) => {
    if (err || !url) return res.status(500).json({ error: 'failed' });
    const m = { id: Date.now()+'_'+Math.random().toString(36).slice(2), nick: nick.slice(0,30), text:'🎤 Sesli mesaj', audioUrl: url, time: new Date().toISOString(), deleted: false };
    roomMessages[roomId].push(m);
    if (roomMessages[roomId].length > MAX_MESSAGES) roomMessages[roomId] = roomMessages[roomId].slice(-MAX_MESSAGES);
    saveRoomMessages(roomId);
    broadcastToRoom(roomId, { type: 'message', message: m });
    res.json({ ok: true });
  });
});

app.post('/upload-file', (req, res) => {
  if (Date.now() >= SHUTDOWN_TIME) return res.status(403).json({ error: 'closed' });
  const { file, nick, fileType, fileName, roomId } = req.body;
  if (!file || !nick || !ROOMS[roomId]) return res.status(400).json({ error: 'missing' });
  let resourceType = 'auto', msgText = '📄 '+(fileName||'Dosya');
  if (fileType?.startsWith('image/')) { resourceType='image'; msgText='🖼 Fotoğraf'; }
  else if (fileType?.startsWith('video/')) { resourceType='video'; msgText='🎬 Video'; }
  uploadToCloudinary(file, resourceType, (err, url) => {
    if (err || !url) return res.status(500).json({ error: 'failed' });
    const m = { id: Date.now()+'_'+Math.random().toString(36).slice(2), nick: nick.slice(0,30), text: msgText, fileUrl: url, fileType: fileType||'', fileName: fileName||'Dosya', time: new Date().toISOString(), deleted: false };
    roomMessages[roomId].push(m);
    if (roomMessages[roomId].length > MAX_MESSAGES) roomMessages[roomId] = roomMessages[roomId].slice(-MAX_MESSAGES);
    saveRoomMessages(roomId);
    broadcastToRoom(roomId, { type: 'message', message: m });
    res.json({ ok: true });
  });
});

// ── WEBSOCKET ─────────────────────────────────────────────────────────────────
wss.on('connection', (ws) => {
  let joinedRoom = null;

  ws.on('message', (raw) => {
    if (Date.now() >= SHUTDOWN_TIME) return;
    let msg; try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'join' && msg.nick && msg.roomId && msg.password) {
      const room = ROOMS[msg.roomId];
      if (!room || room.password !== msg.password) { ws.send(JSON.stringify({ type: 'error', text: 'Yanlış şifre' })); return; }
      joinedRoom = msg.roomId;
      initRoom(joinedRoom);
      cleanRoom(joinedRoom);
      roomClients[joinedRoom].set(ws, msg.nick.slice(0,30));
      ws.send(JSON.stringify({ type: 'history', messages: roomMessages[joinedRoom] }));
      ws.send(JSON.stringify({ type: 'shutdown', shutdownTime: SHUTDOWN_TIME }));
      broadcastOnline(joinedRoom);
      broadcastToRoom(joinedRoom, { type: 'system', text: msg.nick.slice(0,30)+' katıldı', kind: 'join' });
    }

    if (!joinedRoom) return;

    if (msg.type === 'typing' && msg.nick) {
      roomClients[joinedRoom].forEach((_, c) => {
        if (c !== ws && c.readyState === WebSocket.OPEN) c.send(JSON.stringify({ type: 'typing', nick: msg.nick.slice(0,30) }));
      });
    }

    if (msg.type === 'chat' && msg.nick && msg.text) {
      const m = { id: Date.now()+'_'+Math.random().toString(36).slice(2), nick: msg.nick.slice(0,30), text: msg.text.slice(0,500), time: new Date().toISOString(), deleted: false };
      roomMessages[joinedRoom].push(m);
      if (roomMessages[joinedRoom].length > MAX_MESSAGES) roomMessages[joinedRoom] = roomMessages[joinedRoom].slice(-MAX_MESSAGES);
      saveRoomMessages(joinedRoom);
      broadcastToRoom(joinedRoom, { type: 'message', message: m });
    }

    if (msg.type === 'delete' && msg.id) {
      const m = roomMessages[joinedRoom].find(x => x.id === msg.id);
      if (m && m.nick === msg.nick) {
        m.deleted = true; m.text = ''; m.audioUrl = null; m.fileUrl = null;
        saveRoomMessages(joinedRoom);
        broadcastToRoom(joinedRoom, { type: 'deleted', id: msg.id });
      }
    }
  });

  ws.on('close', () => {
    if (!joinedRoom) return;
    const nick = roomClients[joinedRoom]?.get(ws);
    roomClients[joinedRoom]?.delete(ws);
    broadcastOnline(joinedRoom);
    if (nick) broadcastToRoom(joinedRoom, { type: 'system', text: nick+' ayrıldı', kind: 'leave' });
    joinedRoom = null;
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log('Laviva running on port ' + PORT));
