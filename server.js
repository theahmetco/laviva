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

function loadMessages() {
  try {
    if (fs.existsSync(DB_FILE)) {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }
  } catch (e) {}
  return [];
}

function saveMessages(messages) {
  fs.writeFileSync(DB_FILE, JSON.stringify(messages), 'utf8');
}

let messages = loadMessages();

app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'history', messages }));

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    if (msg.type === 'chat' && msg.nick && msg.text) {
      const message = {
        nick: msg.nick.slice(0, 30),
        text: msg.text.slice(0, 500),
        time: new Date().toISOString()
      };

      messages.push(message);
      if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES);
      saveMessages(messages);

      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'message', message }));
        }
      });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Laviva chat running on port ${PORT}`);
});
