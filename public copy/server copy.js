const express = require('express');
const app     = express();
const http    = require('http').createServer(app);
const io      = require('socket.io')(http);

app.use(express.static('public'));

const sessions = {};  // sessionId → { maxPlayers, playerIdToIndex, playerProgress }

io.on('connection', socket => {
  const { session: sessionId, total } = socket.handshake.query;
  if (!sessionId) {
    socket.emit('error', 'No session specified');
    return socket.disconnect();
  }

  // lazy-init session
  if (!sessions[sessionId]) {
    sessions[sessionId] = {
      maxPlayers: parseInt(total,10) || 4,
      playerIdToIndex: {},
      playerProgress: {}
    };
  }
  const sess = sessions[sessionId];
  const { maxPlayers, playerIdToIndex, playerProgress } = sess;

  // helpers bound to this session
  function broadcastProgress() {
    const arr = Array(maxPlayers).fill(0);
    Object.entries(playerProgress).forEach(([i,v]) => arr[i]=v);
    const overall = arr.reduce((a,b)=>a+b,0) / maxPlayers;
    io.to(sessionId).emit('updateProgress', {
      playerProgress: arr,
      totalProgress: overall
    });
  }

  // join a room so we can broadcast per-session
  socket.join(sessionId);

  socket.on('newPlayer', () => {
    // find first free slot
    let slot = null;
    for (let i=0; i<maxPlayers; i++) {
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
    playerProgress[slot] = playerProgress[slot]||0;

    socket.emit('assignedIndex', slot);
    broadcastProgress();
  });

  socket.on('reconnectPlayer', idx => {
    const takenBy = Object.entries(playerIdToIndex)
                           .find(([id,i]) => i===idx);
    if (!takenBy) {
      // free → reclaim
      playerIdToIndex[socket.id] = idx;
      playerProgress[idx] = playerProgress[idx]||0;
      socket.emit('assignedIndex', idx);
      broadcastProgress();
      return;
    }
    const [otherId] = takenBy;
    if (otherId === socket.id || !io.sockets.sockets.get(otherId)?.connected) {
      // same or disconnected → reclaim
      delete playerIdToIndex[otherId];
      playerIdToIndex[socket.id] = idx;
      socket.emit('assignedIndex', idx);
      broadcastProgress();
    } else {
      socket.emit('reclaimDenied');
    }
  });

  socket.on('progressUpdate', pct => {
    const idx = playerIdToIndex[socket.id];
    if (idx != null) {
      playerProgress[idx] = pct;
      broadcastProgress();
    }
  });

  socket.on('disconnect', () => {
    delete playerIdToIndex[socket.id];
    broadcastProgress();
  });
});

app.get('/', (req, res) => {
  res.send('Server running');
});

http.listen(3000, () => {
  console.log('Listening on http://localhost:3000');
});
