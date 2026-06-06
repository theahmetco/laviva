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
  messages = messages.filter(m => new Date(m.time).getTime() > cutoff);
  saveMessages(messages);
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

function uploadToCloudinary(base64Data, resourceType, callback) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHash('sha1')
    .update(`timestamp=${timestamp}${apiSecret}`)
    .digest('hex');
  const postData = `file=${encodeURIComponent(base64Data)}&timestamp=${timestamp}&api_key=${apiKey}&signature=${signature}`;
  const options = {
    hostname: 'api.cloudinary.com',
    path: `/v1_1/${cloudName}/${resourceType}/upload`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData)
    }
  };
  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const result = JSON.parse(data);
        console.log('Cloudinary:', JSON.stringify(result).slice(0, 200));
        if (result.secure_url) callback(null, result.secure_url);
        else callback(new Error(JSON.stringify(result)));
      } catch (e) { callback(e); }
    });
  });
  req.on('error', callback);
  req.write(postData);
  req.end();
}

app.use(express.static(path.join(__dirname, 'public')));

app.post('/upload-audio', (req, res) => {
  const { audio, nick } = req.body;
  if (!audio || !nick) return res.status(400).json({ error: 'missing' });
  uploadToCloudinary(audio, 'video', (err, url) => {
    if (err || !url) { console.error(err); return res.status(500).json({ error: 'failed' }); }
    const m = {
      id: Date.now() + '_' + Math.random().toString(36).slice(2),
      nick: nick.slice(0, 30),
      text: '🎤 Sesli mesaj',
      audioUrl: url,
      time: new Date().toISOString(),
      deleted: false
    };
    messages.push(m);
    if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES);
    saveMessages(messages);
    broadcast({ type: 'message', message: m });
    res.json({ ok: true });
  });
});

app.post('/upload-file', (req, res) => {
  const { file, nick, fileType, fileName } = req.body;
  if (!file || !nick) return res.status(400).json({ error: 'missing' });

  let resourceType = 'auto';
  let msgText = '📄 ' + (fileName || 'Dosya');
  if (fileType && fileType.startsWith('image/')) { resourceType = 'image'; msgText = '🖼 Fotoğraf'; }
  else if (fileType && fileType.startsWith('video/')) { resourceType = 'video'; msgText = '🎬 Video'; }

  uploadToCloudinary(file, resourceType, (err, url) => {
    if (err || !url) { console.error(err); return res.status(500).json({ error: 'failed' }); }
    const m = {
      id: Date.now() + '_' + Math.random().toString(36).slice(2),
      nick: nick.slice(0, 30),
      text: msgText,
      fileUrl: url,
      fileType: fileType || '',
      fileName: fileName || 'Dosya',
      time: new Date().toISOString(),
      deleted: false
    };
    messages.push(m);
    if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES);
    saveMessages(messages);
    broadcast({ type: 'message', message: m });
    res.json({ ok: true });
  });
});

wss.on('connection', (ws) => {
  cleanOldMessages();
  ws.send(JSON.stringify({ type: 'history', messages }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'join' && msg.nick) {
      clients.set(ws, msg.nick.slice(0, 30));
      broadcastOnline();
      broadcast({ type: 'system', text: msg.nick.slice(0, 30) + ' katıldı', kind: 'join' });
    }

    if (msg.type === 'typing' && msg.nick) {
      wss.clients.forEach(c => {
        if (c !== ws && c.readyState === WebSocket.OPEN) {
          c.send(JSON.stringify({ type: 'typing', nick: msg.nick.slice(0, 30) }));
        }
      });
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
        m.audioUrl = null;
        m.fileUrl = null;
        saveMessages(messages);
        broadcast({ type: 'deleted', id: msg.id });
      }
    }
  });

  ws.on('close', () => {
    const nick = clients.get(ws);
    clients.delete(ws);
    broadcastOnline();
    if (nick) broadcast({ type: 'system', text: nick + ' ayrıldı', kind: 'leave' });
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log('Laviva running on port ' + PORT));
