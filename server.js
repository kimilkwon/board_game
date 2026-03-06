import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const app = express();
const http = createServer(app);
const io = new Server(http);
const PORT = process.env.PORT || 3000;

app.use(express.static(join(__dir, 'client')));

// ── Game constants ──────────────────────────────────────────
const GRASS = new Set(['3,5','4,4','4,5','4,6','5,3','5,4','5,6','5,7','6,4','6,5','6,6','7,5']);
const BLACK_START = [[0,0],[0,1],[0,2],[1,0],[2,0],[8,10],[9,10],[10,8],[10,9],[10,10]];
const WHITE_START = [[8,0],[9,0],[10,0],[10,1],[10,2],[0,8],[0,9],[0,10],[1,10],[2,10]];

function ctype(c, r) {
  if (c === 5 && r === 5) return 'oasis';
  if (GRASS.has(`${c},${r}`)) return 'grass';
  return 'desert';
}

function makeGrid() {
  const g = Array.from({ length: 11 }, () => Array(11).fill(null));
  for (const [c, r] of BLACK_START) g[c][r] = 'black';
  for (const [c, r] of WHITE_START) g[c][r] = 'white';
  return g;
}

function slides(grid, c, r) {
  const out = [];
  for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) {
    let nc = c+dc, nr = r+dr;
    while (nc>=0 && nc<11 && nr>=0 && nr<11 && !grid[nc][nr]) {
      out.push([nc, nr]); nc += dc; nr += dr;
    }
  }
  return out;
}

function knights(grid, c, r) {
  return [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]
    .map(([dc,dr]) => [c+dc, r+dr])
    .filter(([nc,nr]) =>
      nc>=0 && nc<11 && nr>=0 && nr<11 &&
      !grid[nc][nr] && ctype(nc,nr) === 'desert'
    );
}

function isValid(grid, fc, fr, tc, tr) {
  return [...slides(grid,fc,fr), ...knights(grid,fc,fr)]
    .some(([c,r]) => c===tc && r===tr);
}

// ── Room management ─────────────────────────────────────────
const queue = [];   // { sid, name }
const rooms = new Map();

function makeRoom(p1, p2) {
  const id = Math.random().toString(36).slice(2,8).toUpperCase();
  const room = {
    id,
    players: [
      { sid: p1.sid, name: p1.name, color: 'black' },
      { sid: p2.sid, name: p2.name, color: 'white' },
    ],
    grid: makeGrid(),
    turn: 'black',
    done: false,
    timerId: null,
    timeLeft: 60,
  };
  rooms.set(id, room);
  return room;
}

function roomState(room) {
  return { grid: room.grid, turn: room.turn, done: room.done, timeLeft: room.timeLeft };
}

function startTimer(room) {
  clearInterval(room.timerId);
  room.timeLeft = 60;
  room.timerId = setInterval(() => {
    if (room.done) { clearInterval(room.timerId); return; }
    room.timeLeft--;
    io.to(room.id).emit('tick', room.timeLeft);
    if (room.timeLeft <= 0) {
      room.turn = room.turn === 'black' ? 'white' : 'black';
      io.to(room.id).emit('state', roomState(room));
      startTimer(room);
    }
  }, 1000);
}

function tryMatch() {
  while (queue.length >= 2) {
    const p1 = queue.shift(), p2 = queue.shift();
    const s1 = io.sockets.sockets.get(p1.sid);
    const s2 = io.sockets.sockets.get(p2.sid);
    if (!s1 && !s2) continue;
    if (!s1) { queue.unshift(p2); continue; }
    if (!s2) { queue.unshift(p1); continue; }
    const room = makeRoom(p1, p2);
    s1.join(room.id); s2.join(room.id);
    s1.emit('matched', { roomId:room.id, myColor:'black', oppName:p2.name, state:roomState(room) });
    s2.emit('matched', { roomId:room.id, myColor:'white', oppName:p1.name, state:roomState(room) });
    startTimer(room);
  }
}

// ── Socket handlers ─────────────────────────────────────────
io.on('connection', socket => {
  console.log('connect:', socket.id);

  socket.on('join', ({ name }) => {
    const i = queue.findIndex(p => p.sid === socket.id);
    if (i >= 0) queue.splice(i, 1);
    queue.push({ sid: socket.id, name: (name || '플레이어').slice(0, 14) });
    socket.emit('waiting');
    tryMatch();
  });

  socket.on('cancel', () => {
    const i = queue.findIndex(p => p.sid === socket.id);
    if (i >= 0) queue.splice(i, 1);
  });

  socket.on('move', ({ roomId, fc, fr, tc, tr }) => {
    const room = rooms.get(roomId);
    if (!room || room.done) return;
    const me = room.players.find(p => p.sid === socket.id);
    if (!me || me.color !== room.turn) return;
    if (!room.grid[fc]?.[fr] || room.grid[fc][fr] !== me.color) return;
    if (!isValid(room.grid, fc, fr, tc, tr)) return;

    room.grid[tc][tr] = room.grid[fc][fr];
    room.grid[fc][fr] = null;

    if (tc === 5 && tr === 5) {
      room.done = true;
      clearInterval(room.timerId);
      io.to(room.id).emit('winner', { color: me.color, name: me.name });
      return;
    }
    room.turn = room.turn === 'black' ? 'white' : 'black';
    io.to(room.id).emit('state', roomState(room));
    startTimer(room);
  });

  socket.on('disconnect', () => {
    const i = queue.findIndex(p => p.sid === socket.id);
    if (i >= 0) queue.splice(i, 1);
    for (const [, room] of rooms) {
      if (room.done) continue;
      if (!room.players.some(p => p.sid === socket.id)) continue;
      clearInterval(room.timerId);
      room.done = true;
      const opp = room.players.find(p => p.sid !== socket.id);
      if (opp) io.to(opp.sid).emit('opp_left');
    }
  });
});

http.listen(PORT, () => console.log(`말달리자 서버: http://localhost:${PORT}`));
