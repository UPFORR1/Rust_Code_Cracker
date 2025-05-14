// server.js
const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

// 1️⃣ load your cleaned up codes
//    Make sure pin_codes_fixed.json lives next to this file
const pinCodes = require('./pin_codes_fixed.json');

const app    = express();
const httpSrv = http.createServer(app);
const io     = new Server(httpSrv);

// 2️⃣ serve everything in public/
app.use(express.static(path.join(__dirname, 'public')));

// in-memory sessions map
const sessions = {};

io.on('connection', socket => {
  const { session: sessionId, total } = socket.handshake.query;
  if (!sessionId) {
    socket.emit('error','Session ID required');
    return socket.disconnect(true);
  }

  // 3️⃣ initialize session if new
  if (!sessions[sessionId]) {
    sessions[sessionId] = {
      maxPlayers: parseInt(total,10) || 4,
      playerIdToIndex: {},
      playerProgress: {}
    };
  }
  const sess = sessions[sessionId];
  const { maxPlayers, playerIdToIndex, playerProgress } = sess;

  socket.join(sessionId);

  // helper to broadcast everyone’s progress
  function broadcastProgress() {
    const arr = Array(maxPlayers).fill(0);
    for (const [i,v] of Object.entries(playerProgress)) {
      arr[i] = v;
    }
    io.to(sessionId).emit('updateProgress', { playerProgress: arr });
  }

  // helper to send *only* this player’s codes
  function sendCodes(index) {
    const myCodes = pinCodes.filter((_,i) => i % maxPlayers === index);
    socket.emit('codeList', myCodes);
  }

  // 4️⃣ new player slot
  socket.on('newPlayer', () => {
    let slot = null;
    for (let i = 0; i < maxPlayers; i++) {
      if (!Object.values(playerIdToIndex).includes(i)) {
        slot = i;
        break;
      }
    }
    if (slot === null) {
      socket.emit('error','Room full');
      return;
    }
    playerIdToIndex[socket.id] = slot;
    playerProgress[slot] = playerProgress[slot] || 0;

    socket.emit('assignedIndex', slot);
    sendCodes(slot);
    broadcastProgress();
  });

  // 5️⃣ reconnect to previous slot
  socket.on('reconnectPlayer', reqIdx => {
    const taken = Object.entries(playerIdToIndex)
                       .find(([,idx]) => idx === reqIdx);
    if (!taken) {
      playerIdToIndex[socket.id] = reqIdx;
      playerProgress[reqIdx] = playerProgress[reqIdx]||0;
      socket.emit('assignedIndex', reqIdx);
      sendCodes(reqIdx);
      broadcastProgress();
      return;
    }
    const [otherId] = taken;
    const otherSock = io.sockets.sockets.get(otherId);
    if (!otherSock || !otherSock.connected) {
      delete playerIdToIndex[otherId];
      playerIdToIndex[socket.id] = reqIdx;
      socket.emit('assignedIndex', reqIdx);
      sendCodes(reqIdx);
      broadcastProgress();
    } else {
      socket.emit('reclaimDenied');
    }
  });

  // 6️⃣ progress updates
  socket.on('progressUpdate', pct => {
    const idx = playerIdToIndex[socket.id];
    if (idx != null) {
      playerProgress[idx] = pct;
      broadcastProgress();
    }
  });

  // 7️⃣ cleanup on disconnect
  socket.on('disconnect', () => {
    delete playerIdToIndex[socket.id];
    broadcastProgress();
  });
});

// 8️⃣ start server on provided PORT or 3000
const PORT = process.env.PORT || 3000;
httpSrv.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});