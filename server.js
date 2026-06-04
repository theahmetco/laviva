const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const DB_FILE = path.join(__dirname, 'messages.json');
const MAX_MESSAGES = 200;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function loadMessages() {
  try {
    if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {}
  return [];
}

function saveMessages(msgs) {
  fs.writeFileSync(DB_FILE, JSON.stringify(msgs), 'utf8');
}

function cleanOldMessages() {
  const cutoff = Date.now() - MAX_AGE_MS;
  const before = messages.length;
  messages = messages.filter(m => new Date(m.time).getTime() > cutoff);
  if (messages.length !== before) saveMessages(messages);
}

let messages = loadMessages();
cleanOldMessages();
setInterval(cleanOldMessages, 60 * 60 * 1000);

const clients = new Map();

function broadcast(data) {
  const str = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(str); });
}

function broadcastOnline() {
  const users = Array.from(clients.values());
  broadcast({ type: 'online', count: users.length, users });
}

app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', (ws) => {
  cleanOldMessages();
  ws.send(JSON.stringify({ type: 'history', messages }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'join' && msg.nick) {
      clients.set(ws, msg.nick.slice(0, 30));
      broadcastOnline();
      broadcast({ type: 'system', text: msg.nick.slice(0, 30) + ' odaya katıldı' });
    }

    if (msg.type === 'chat' && msg.nick && msg.text) {
      const m = {
        id: Date.now() + '_' + Math.random().toString(36).slice(2),
        nick: msg.nick.slice(0, 30),
        text: msg.text.slice(0, 500),
        time: new Date().toISOString(),
        deleted: false
      };
      messages.push(m);
      if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES);
      saveMessages(messages);
      broadcast({ type: 'message', message: m });
    }

    if (msg.type === 'delete' && msg.id) {
      const m = messages.find(x => x.id === msg.id);
      if (m && m.nick === msg.nick) {
        m.deleted = true;
        m.text = '';
        saveMessages(messages);
        broadcast({ type: 'deleted', id: msg.id });
      }
    }
  });

  ws.on('close', () => {
    const nick = clients.get(ws);
    clients.delete(ws);
    broadcastOnline();
    if (nick) broadcast({ type: 'system', text: nick + ' ayrıldı' });
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log('Laviva running on port ' + PORT));
