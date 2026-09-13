import express from 'express';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { Server } from 'socket.io';

const rooms = new Map();
const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: true } });
app.use(express.json());

const token = () => randomBytes(12).toString('hex');
const answer = () => { let digits = ''; while (digits.length < 4) { const digit = String(Math.floor(Math.random() * 10)); if (!digits.includes(digit)) digits += digit; } return digits; };
const nickname = (value) => String(value || '').trim().slice(0, 20);
const avatar = (value) => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 6 ? Number(value) : 1;
const duplicate = (room, name) => room.players.some((player) => player.name.toLocaleLowerCase() === name.toLocaleLowerCase());
const activePlayers = (room) => room.players.filter((player) => !player.done && player.fromRound <= room.round);

function view(room, viewer) {
  const finished = room.status === 'finished';
  return {
    code: room.code, inviteToken: room.inviteToken, name: room.name, maxPlayers: room.maxPlayers, mode: room.mode,
    playStyle: room.playStyle, allowMidJoin: room.allowMidJoin, turnSeconds: room.turnSeconds,
    round: room.round, roundDeadline: room.roundDeadline, status: room.status,
    isHost: viewer === room.players[0], answer: finished ? room.answer : null,
    guesses: viewer.guesses,
    canGuess: room.status === 'playing' && !viewer.done &&
      (room.playStyle === 'race' || (viewer.fromRound <= room.round && !viewer.roundSubmitted)),
    players: [...room.players, ...(finished ? room.departed : [])].map((player, index) => {
      const actual = player.guesses.filter((guess) => !guess.missed);
      return {
        id: player.token, nickname: player.name, avatar: player.avatar, isHost: index === 0,
        connected: player.connected, ready: player.ready, exited: Boolean(player.exited), attempts: actual.length,
        roundSubmitted: player.roundSubmitted,
        last: actual.at(-1) ? `${actual.at(-1).A}A${actual.at(-1).B}B` : '—',
        best: actual.reduce((best, guess) => Math.max(best, guess.A * 10 + guess.B), 0),
        done: Boolean(player.done), rank: player.rank,
        history: finished ? player.guesses : undefined,
      };
    }),
  };
}
function send(room) { room.players.forEach((player) => io.to(player.token).emit('room:update', view(room, player))); }
function finish(room) {
  if (room.timer) clearTimeout(room.timer);
  room.timer = null; room.roundDeadline = null; room.status = 'finished';
  room.players.filter((player) => player.done).sort((a, b) => a.done - b.done || a.guesses.length - b.guesses.length)
    .forEach((player, index) => { player.rank = index + 1; });
}
function nextRound(room) {
  if (room.status !== 'playing' || room.playStyle !== 'traditional') return;
  if (room.timer) clearTimeout(room.timer);
  room.round += 1;
  room.players.forEach((player) => { player.roundSubmitted = false; });
  room.roundDeadline = Date.now() + room.turnSeconds * 1000;
  room.timer = setTimeout(() => {
    activePlayers(room).filter((player) => !player.roundSubmitted).forEach((player) => player.guesses.push({ round: room.round, missed: true }));
    nextRound(room); send(room);
  }, room.turnSeconds * 1000);
  room.timer.unref?.(); send(room);
}
function maybeAdvance(room) {
  if (room.playStyle === 'traditional' && room.status === 'playing' && activePlayers(room).every((player) => player.roundSubmitted)) nextRound(room);
}
function roomFor(socket) {
  const room = rooms.get(socket.data.code);
  return { room, player: room?.players.find((item) => item.token === socket.data.token) };
}

app.post('/api/rooms', (request, response) => {
  const body = request.body || {}, name = nickname(body.nickname), maxPlayers = Number(body.maxPlayers);
  if (!name) return response.status(400).json({ error: '請輸入暱稱。' });
  if (!String(body.password || '')) return response.status(400).json({ error: '請設定房間密碼。' });
  if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 10) return response.status(400).json({ error: '玩家上限須為 2～10 人。' });
  if (!['first', 'all'].includes(body.mode)) return response.status(400).json({ error: '遊戲模式不正確。' });
  if (!['race', 'traditional'].includes(body.playStyle)) return response.status(400).json({ error: '玩法不正確。' });
  const turnSeconds = Number(body.turnSeconds);
  if (body.playStyle === 'traditional' && ![15, 20, 30, 60].includes(turnSeconds)) return response.status(400).json({ error: '請選擇有效的回合秒數。' });
  const player = { token: token(), name, avatar: avatar(body.avatar), connected: false, ready: false, guesses: [], roundSubmitted: false, fromRound: 1 };
  let code; do { code = randomBytes(3).toString('hex').slice(0, 4).toUpperCase(); } while (rooms.has(code));
  const room = { code, inviteToken: randomBytes(16).toString('hex'), name: String(body.name || '').trim().slice(0, 40), password: body.password,
    maxPlayers, mode: body.mode, playStyle: body.playStyle, allowMidJoin: body.allowMidJoin === true,
    turnSeconds: body.playStyle === 'traditional' ? turnSeconds : null,
    status: 'waiting', players: [player], departed: [], round: 0, roundDeadline: null, timer: null };
  rooms.set(code, room); response.status(201).json({ session: player.token, room: view(room, player) });
});
app.post('/api/rooms/:code/join', (request, response) => {
  const room = rooms.get(request.params.code.toUpperCase());
  if (!room) return response.status(404).json({ error: '房間已失效，請重新建立。' });
  const name = nickname(request.body?.nickname);
  if (!name) return response.status(400).json({ error: '請輸入暱稱。' });
  const validInvite = typeof request.body?.inviteToken === 'string' && request.body.inviteToken === room.inviteToken;
  if (!validInvite && request.body?.password !== room.password) return response.status(403).json({ error: request.body?.inviteToken ? '邀請連結無效，請重新取得。' : '房間密碼不正確。' });
  if (duplicate(room, name)) return response.status(409).json({ error: '暱稱重複', code: 'DUPLICATE_NICKNAME' });
  if (room.players.length >= room.maxPlayers) return response.status(409).json({ error: '房間已滿。' });
  if (room.status === 'finished' || (room.status === 'playing' && !room.allowMidJoin)) return response.status(409).json({ error: '遊戲已開始，無法加入。' });
  const player = { token: token(), name, avatar: avatar(request.body?.avatar), ready: false, connected: false, guesses: [], roundSubmitted: false,
    fromRound: room.status === 'playing' && room.playStyle === 'traditional' ? room.round + 1 : room.round };
  room.players.push(player); send(room); response.json({ session: player.token, room: view(room, player) });
});
app.get('/health', (_, response) => response.json({ ok: true }));

io.on('connection', (socket) => {
  socket.on('room:enter', (data, reply) => {
    const room = rooms.get(String(data?.code || '').toUpperCase());
    const player = room?.players.find((item) => item.token === data?.session);
    if (!player) return reply?.({ error: '房間已失效，請重新建立。' });
    socket.data = { code: room.code, token: player.token }; socket.join(player.token); player.connected = true;
    reply?.({ room: view(room, player) }); send(room);
  });
  socket.on('room:ready', (reply) => {
    const { room, player } = roomFor(socket);
    if (!room || !player || room.status !== 'waiting') return reply?.({ error: '目前無法切換 Ready。' });
    if (room.players[0] === player) return reply?.({ error: '房主不需要按 READY。' });
    player.ready = !player.ready; reply?.({ ok: true }); send(room);
  });
  socket.on('room:start', (reply) => {
    const { room, player } = roomFor(socket);
    if (!room || !player) return reply?.({ error: '房間已失效。' });
    if (room.players[0] !== player) return reply?.({ error: '只有房主能開始遊戲。' });
    if (room.status !== 'waiting') return reply?.({ error: '遊戲已開始。' });
    if (room.players.filter((item) => item.connected).length < 2) return reply?.({ error: '至少需要 2 位在線玩家。' });
    if (room.players.slice(1).some((item) => !item.connected || !item.ready)) return reply?.({ error: '所有玩家都需在線並按下 READY 才能開始。' });
    room.status = 'playing'; room.answer = answer(); reply?.({ ok: true });
    if (room.playStyle === 'traditional') nextRound(room); else send(room);
  });
  socket.on('room:leave', (reply) => {
    const { room, player } = roomFor(socket);
    if (!room || !player) return reply?.({ error: '房間已失效。' });
    room.players.splice(room.players.indexOf(player), 1);
    if (room.status !== 'waiting') { player.exited = true; player.connected = false; room.departed.push(player); }
    reply?.({ ok: true });
    io.to(player.token).emit('room:left');
    io.in(player.token).socketsLeave(player.token);
    if (!room.players.length) {
      if (room.timer) clearTimeout(room.timer);
      rooms.delete(room.code);
      return;
    }
    if (room.status === 'playing') {
      if (room.mode === 'all' && room.players.every((item) => item.done)) finish(room);
      else maybeAdvance(room);
    }
    send(room);
  });
  socket.on('game:guess', (guess, reply) => {
    const { room, player } = roomFor(socket);
    if (!room || !player || room.status !== 'playing') return reply?.({ error: '遊戲尚未開始或已結束。' });
    if (player.done) return reply?.({ error: '你已猜中。' });
    if (room.playStyle === 'traditional' && player.fromRound > room.round) return reply?.({ error: '請等待下一輪開始。' });
    if (room.playStyle === 'traditional' && player.roundSubmitted) return reply?.({ error: '本輪已猜測，請等待其他玩家。' });
    if (typeof guess !== 'string' || !/^\d{4}$/.test(guess) || new Set(guess).size !== 4) return reply?.({ error: '請輸入 4 個不重複數字。' });
    let A = 0, B = 0;
    [...guess].forEach((digit, index) => room.answer[index] === digit ? A++ : room.answer.includes(digit) && B++);
    player.guesses.push({ guess, A, B, round: room.playStyle === 'traditional' ? room.round : undefined });
    if (room.playStyle === 'traditional') player.roundSubmitted = true;
    if (A === 4) { player.done = Date.now(); if (room.mode === 'first' || room.players.every((item) => item.done)) finish(room); }
    reply?.({ result: { guess, A, B } }); maybeAdvance(room); send(room);
  });
  socket.on('disconnect', () => {
    const { room, player } = roomFor(socket);
    if (!room || !player) return;
    player.connected = io.sockets.adapter.rooms.get(player.token)?.size > 0;
    if (room.players[0] === player && !player.connected) {
      const nextHost = room.players.find((item) => item.connected);
      if (nextHost) { room.players.splice(room.players.indexOf(nextHost), 1); room.players.unshift(nextHost); }
    }
    send(room);
  });
});
server.listen(process.env.PORT || 3001);
