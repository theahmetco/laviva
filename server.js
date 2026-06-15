const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const url = require('url');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json({ limit: '50mb' }));

const DB_FILE = path.join(__dirname, 'messages.json');
const MAX_MESSAGES = 200;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

// TR saatiyle sistem bitiş süresi
const SHUTDOWN_TIME = new Date('2030-12-31T23:59:59+03:00').getTime();

function loadMessages() {
  try {
    if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {}
  return [];
}

function saveMessages(msgs) {
  fs.writeFileSync(DB_FILE, JSON.stringify(msgs), 'utf8');
}

let messages = loadMessages();

function cleanOldMessages() {
  const cutoff = Date.now() - MAX_AGE_MS;
  messages = messages.filter(m => new Date(m.time).getTime() > cutoff);
  saveMessages(messages);
}
setInterval(cleanOldMessages, 60 * 60 * 1000);

// Statik dosyaları sun (CSS, JS, Görseller)
app.use(express.static(path.join(__dirname)));

// Dinamik oda URL desteği (Örn: siteniz.com/123)
app.get('/:room?', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// WebSocket İstemci Takibi (ws -> {nick, room})
const clients = new Map();

wss.on('connection', (ws, req) => {
  // Gelen bağlantı isteğinin URL'inden oda parametresini çek (?room=X)
  const parameters = url.parse(req.url, true).query;
  const room = parameters.room || 'default';

  if (Date.now() > SHUTDOWN_TIME) {
    ws.send(JSON.stringify({ type: 'system', text: 'Sistem kullanım süresi dolmuştur.' }));
    ws.close();
    return;
  }

  // İlk bağlantıda odayı set et, nick henüz boş
  clients.set(ws, { nick: '', room: room });

  // Sadece ilgili odadaki kullanıcılara yayın yapma fonksiyonu
  function broadcastToRoom(roomName, data) {
    wss.clients.forEach(c => {
      const clientData = clients.get(c);
      if (c.readyState === WebSocket.OPEN && clientData && clientData.room === roomName) {
        c.send(JSON.stringify(data));
      }
    });
  }

  // İlgili odanın anlık çevrimiçi sayısını güncelleme
  function broadcastOnlineCount(roomName) {
    let count = 0;
    wss.clients.forEach(c => {
      const clientData = clients.get(c);
      if (clientData && clientData.room === roomName && clientData.nick) count++;
    });
    broadcastToRoom(roomName, { type: 'online', count });
  }

  ws.on('message', (message) => {
    let msg;
    try { msg = JSON.parse(message); } catch (e) { return; }

    const clientData = clients.get(ws);
    if (!clientData) return;

    // Kullanıcı odaya giriş yaptığında
    if (msg.type === 'join' && msg.nick) {
      clientData.nick = msg.nick.slice(0, 30);
      clients.set(ws, clientData);

      broadcastOnlineCount(room);
      broadcastToRoom(room, { type: 'system', text: clientData.nick + ' katıldı', kind: 'join' });

      // Kullanıcıya sadece giriş yaptığı odaya ait geçmiş mesajları gönder
      const roomMessages = messages.filter(m => m.room === room);
      ws.send(JSON.stringify({ type: 'history', messages: roomMessages }));
    }

    // Yazıyor... durum bildirimi (Sadece oda içi)
    if (msg.type === 'typing' && msg.nick) {
      wss.clients.forEach(c => {
        const targetData = clients.get(c);
        if (c !== ws && c.readyState === WebSocket.OPEN && targetData && targetData.room === room) {
          c.send(JSON.stringify({ type: 'typing', nick: msg.nick.slice(0, 30) }));
        }
      });
    }

    // Yeni mesaj gönderildiğinde
    if (msg.type === 'chat' && msg.nick && msg.text) {
      const m = {
        id: Date.now() + '_' + Math.random().toString(36).slice(2),
        room: room, // Mesajın ait olduğu oda
        nick: msg.nick.slice(0, 30),
        text: msg.text.slice(0, 500),
        time: new Date().toISOString(),
        deleted: false
      };
      messages.push(m);
      if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES);
      saveMessages(messages);
      broadcastToRoom(room, { type: 'message', message: m });
    }

    // Mesaj silme işlemi (Sadece oda içi)
    if (msg.type === 'delete' && msg.id) {
      const m = messages.find(x => x.id === msg.id);
      if (m && m.nick === msg.nick && m.room === room) {
        m.deleted = true;
        m.text = '';
        saveMessages(messages);
        broadcastToRoom(room, { type: 'delete', id: msg.id });
      }
    }
  });

  ws.on('close', () => {
    const clientData = clients.get(ws);
    if (clientData) {
      const userNick = clientData.nick;
      const userRoom = clientData.room;
      clients.delete(ws);
      if (userNick) {
        broadcastOnlineCount(userRoom);
        broadcastToRoom(userRoom, { type: 'system', text: userNick + ' ayrıldı', kind: 'leave' });
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});
