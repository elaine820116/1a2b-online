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
const answer = (length) => { let digits = ''; while (digits.length < length) { const digit = String(Math.floor(Math.random() * 10)); if (!digits.includes(digit)) digits += digit; } return digits; };
const score = (secret, guess) => {
  let A = 0, B = 0;
  [...guess].forEach((digit, index) => secret[index] === digit ? A++ : secret.includes(digit) && B++);
  return { A, B };
};
const nickname = (value) => String(value || '').trim().slice(0, 20);
const avatar = (value) => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 6 ? Number(value) : 1;
const duplicate = (room, name) => room.players.some((player) => player.name.toLocaleLowerCase() === name.toLocaleLowerCase());
const activePlayers = (room) => room.players.filter((player) => !player.done && player.fromRound <= room.round);
const botDelay = { low: 8000, medium: 5000, high: 3000 };

function botGuess(length, guesses, difficulty) {
  const history = guesses.filter((item) => item.guess);
  const tried = new Set(history.map((item) => item.guess));
  const fits = (candidate) => !tried.has(candidate) && history.every((item) => {
    const result = score(candidate, item.guess);
    return result.A === item.A && result.B === item.B;
  });
  const candidates = [], seen = new Set();
  for (let attempt = 0; attempt < 6000 && candidates.length < 24; attempt++) {
    const candidate = answer(length);
    if (!seen.has(candidate) && fits(candidate)) { seen.add(candidate); candidates.push(candidate); }
  }
  if (!candidates.length) {
    const used = new Set();
    const search = (prefix) => {
      if (candidates.length >= 24) return;
      if (prefix.length === length) { if (fits(prefix)) candidates.push(prefix); return; }
      for (let digit = 0; digit < 10; digit++) {
        const value = String(digit);
        if (!used.has(value)) { used.add(value); search(prefix + value); used.delete(value); }
        if (candidates.length >= 24) return;
      }
    };
    search('');
  }
  if (!candidates.length) return null;
  if (difficulty === 'low' || candidates.length === 1) return candidates[Math.floor(Math.random() * candidates.length)];
  if (difficulty === 'medium') {
    const recentDigits = new Set(history.slice(-2).flatMap((item) => [...item.guess]));
    return candidates.reduce((best, candidate) => [...candidate].filter((digit) => !recentDigits.has(digit)).length > [...best].filter((digit) => !recentDigits.has(digit)).length ? candidate : best);
  }
  return candidates.reduce((best, candidate) => {
    const buckets = new Map();
    candidates.forEach((possible) => { const result = score(possible, candidate); const key = `${result.A}:${result.B}`; buckets.set(key, (buckets.get(key) || 0) + 1); });
    const cost = [...buckets.values()].reduce((sum, count) => sum + count * count, 0);
    return !best || cost < best.cost ? { candidate, cost } : best;
  }, null).candidate;
}

function clearBotTimers(room) { room.botTimers.forEach(clearTimeout); room.botTimers.clear(); }
function queueBot(room, bot, delay) {
  const timer = setTimeout(() => {
    room.botTimers.delete(timer);
    if (room.status !== 'playing' || !room.players.includes(bot) || bot.done) return;
    if (room.playStyle === 'traditional' && bot.roundSubmitted) return;
    const guess = botGuess(room.digits, bot.guesses, bot.difficulty);
    if (guess) recordGuess(room, bot, guess);
    if (room.playStyle === 'race' && room.status === 'playing' && !bot.done) queueBot(room, bot, botDelay[bot.difficulty]);
  }, delay);
  timer.unref?.(); room.botTimers.add(timer);
}
function scheduleBots(room) {
  room.players.filter((player) => player.isBot && !player.done).forEach((bot) => {
    const base = botDelay[bot.difficulty];
    const delay = room.playStyle === 'traditional' ? Math.min(room.turnSeconds * 750, base + Math.floor(Math.random() * 1000)) : base + Math.floor(Math.random() * 800);
    queueBot(room, bot, delay);
  });
}

function view(room, viewer) {
  const finished = room.status === 'finished';
  return {
    code: room.code, inviteToken: room.inviteToken, name: room.name, maxPlayers: room.maxPlayers, mode: room.mode, digits: room.digits, solo: room.solo,
    playStyle: room.playStyle, allowMidJoin: room.allowMidJoin, turnSeconds: room.turnSeconds,
    round: room.round, roundDeadline: room.roundDeadline, status: room.status,
    isHost: viewer === room.players[0], viewerId: viewer.id, answer: finished ? room.answer : null,
    guesses: viewer.guesses,
    canGuess: room.status === 'playing' && !viewer.done &&
      (room.playStyle === 'race' || (viewer.fromRound <= room.round && !viewer.roundSubmitted)),
    players: [...room.players, ...(finished ? room.departed : [])].map((player, index) => {
      const actual = player.guesses.filter((guess) => !guess.missed);
      return {
        id: player.id, nickname: player.name, avatar: player.avatar, isHost: index === 0,
        connected: player.connected, ready: player.ready, isBot: Boolean(player.isBot), difficulty: player.difficulty || null, exited: Boolean(player.exited), attempts: actual.length,
        roundSubmitted: player.roundSubmitted,
        last: actual.at(-1) ? `${actual.at(-1).A}A${actual.at(-1).B}B` : '—',
        best: actual.reduce((best, guess) => Math.max(best, guess.A * 10 + guess.B), 0),
        done: Boolean(player.done), rank: player.rank,
        history: finished ? player.guesses : undefined,
      };
    }),
  };
}
function send(room) { room.players.filter((player) => !player.isBot).forEach((player) => io.to(player.token).emit('room:update', view(room, player))); }
function finish(room) {
  if (room.timer) clearTimeout(room.timer);
  clearBotTimers(room);
  room.timer = null; room.roundDeadline = null; room.status = 'finished';
  room.players.filter((player) => player.done).sort((a, b) => a.done - b.done || a.guesses.length - b.guesses.length)
    .forEach((player, index) => { player.rank = index + 1; });
}
function nextRound(room) {
  if (room.status !== 'playing' || room.playStyle !== 'traditional') return;
  if (room.timer) clearTimeout(room.timer);
  clearBotTimers(room);
  room.round += 1;
  room.players.forEach((player) => { player.roundSubmitted = false; });
  room.roundDeadline = Date.now() + room.turnSeconds * 1000;
  room.timer = setTimeout(() => {
    activePlayers(room).filter((player) => !player.roundSubmitted).forEach((player) => player.guesses.push({ round: room.round, missed: true }));
    nextRound(room); send(room);
  }, room.turnSeconds * 1000);
  room.timer.unref?.(); scheduleBots(room); send(room);
}
function maybeAdvance(room) {
  if (room.playStyle === 'traditional' && room.status === 'playing' && activePlayers(room).every((player) => player.roundSubmitted)) nextRound(room);
}
function roomFor(socket) {
  const room = rooms.get(socket.data.code);
  return { room, player: room?.players.find((item) => item.token === socket.data.token) };
}
function recordGuess(room, player, guess) {
  if (room.status !== 'playing') return { error: '遊戲尚未開始或已結束。' };
  if (player.done) return { error: '你已猜中。' };
  if (room.playStyle === 'traditional' && player.fromRound > room.round) return { error: '請等待下一輪開始。' };
  if (room.playStyle === 'traditional' && player.roundSubmitted) return { error: '本輪已猜測，請等待其他玩家。' };
  if (typeof guess !== 'string' || guess.length !== room.digits || !/^\d+$/.test(guess) || new Set(guess).size !== room.digits) return { error: `請輸入 ${room.digits} 個不重複數字。` };
  const { A, B } = score(room.answer, guess);
  player.guesses.push({ guess, A, B, round: room.playStyle === 'traditional' ? room.round : undefined });
  if (room.playStyle === 'traditional') player.roundSubmitted = true;
  if (A === room.digits) { player.done = Date.now(); if (room.mode === 'first' || room.players.every((item) => item.done)) finish(room); }
  maybeAdvance(room); send(room);
  return { result: { guess, A, B } };
}

app.post('/api/rooms', (request, response) => {
  const body = request.body || {}, name = nickname(body.nickname), solo = body.solo === true;
  const maxPlayers = solo ? 1 : Number(body.maxPlayers);
  const digits = Number(body.digits ?? 4);
  const botCount = solo ? 0 : Number(body.botCount ?? 0);
  const botDifficulty = body.botDifficulty ?? 'medium';
  if (!name) return response.status(400).json({ error: '請輸入暱稱。' });
  if (![4, 5, 6, 7].includes(digits)) return response.status(400).json({ error: '數字位數須為 4～7 位。' });
  if (!solo && !String(body.password || '')) return response.status(400).json({ error: '請設定房間密碼。' });
  if (!solo && (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 10)) return response.status(400).json({ error: '玩家上限須為 2～10 人。' });
  if (!solo && !['first', 'all'].includes(body.mode)) return response.status(400).json({ error: '遊戲模式不正確。' });
  if (!solo && !['race', 'traditional'].includes(body.playStyle)) return response.status(400).json({ error: '玩法不正確。' });
  if (!solo && (!Number.isInteger(botCount) || botCount < 0 || botCount >= maxPlayers)) return response.status(400).json({ error: '電腦人數須少於玩家上限。' });
  if (!solo && botCount > 0 && !['low', 'medium', 'high'].includes(botDifficulty)) return response.status(400).json({ error: '電腦難度不正確。' });
  const turnSeconds = Number(body.turnSeconds);
  if (!solo && body.playStyle === 'traditional' && ![15, 20, 30, 60].includes(turnSeconds)) return response.status(400).json({ error: '請選擇有效的回合秒數。' });
  const player = { id: token(), token: token(), name, avatar: avatar(body.avatar), connected: false, ready: false, guesses: [], roundSubmitted: false, fromRound: 1 };
  let code; do { code = randomBytes(3).toString('hex').slice(0, 4).toUpperCase(); } while (rooms.has(code));
  const bots = Array.from({ length: botCount }, (_, index) => ({ id: token(), token: null, name: name === `電腦 ${index + 1}` ? `電腦 ${index + 1}（AI）` : `電腦 ${index + 1}`, avatar: (index % 6) + 1, isBot: true, difficulty: botDifficulty, connected: true, ready: true, guesses: [], roundSubmitted: false, fromRound: 1 }));
  const room = { code, inviteToken: randomBytes(16).toString('hex'), name: solo ? '' : String(body.name || '').trim().slice(0, 40), password: solo ? null : body.password,
    maxPlayers, mode: solo ? 'first' : body.mode, playStyle: solo ? 'race' : body.playStyle, digits, solo, allowMidJoin: !solo && body.allowMidJoin === true,
    turnSeconds: !solo && body.playStyle === 'traditional' ? turnSeconds : null,
    status: solo ? 'playing' : 'waiting', answer: solo ? answer(digits) : null, players: [player, ...bots], departed: [], round: 0, roundDeadline: null, timer: null, botTimers: new Set() };
  rooms.set(code, room); response.status(201).json({ session: player.token, room: view(room, player) });
});
app.post('/api/rooms/:code/join', (request, response) => {
  const room = rooms.get(request.params.code.toUpperCase());
  if (!room) return response.status(404).json({ error: '房間已失效，請重新建立。' });
  if (room.solo) return response.status(409).json({ error: '單人模式無法加入。' });
  const name = nickname(request.body?.nickname);
  if (!name) return response.status(400).json({ error: '請輸入暱稱。' });
  const validInvite = typeof request.body?.inviteToken === 'string' && request.body.inviteToken === room.inviteToken;
  if (!validInvite && request.body?.password !== room.password) return response.status(403).json({ error: request.body?.inviteToken ? '邀請連結無效，請重新取得。' : '房間密碼不正確。' });
  if (duplicate(room, name)) return response.status(409).json({ error: '暱稱重複', code: 'DUPLICATE_NICKNAME' });
  if (room.players.length >= room.maxPlayers) return response.status(409).json({ error: '房間已滿。' });
  if (room.status === 'finished' || (room.status === 'playing' && !room.allowMidJoin)) return response.status(409).json({ error: '遊戲已開始，無法加入。' });
  const player = { id: token(), token: token(), name, avatar: avatar(request.body?.avatar), ready: false, connected: false, guesses: [], roundSubmitted: false,
    fromRound: room.status === 'playing' && room.playStyle === 'traditional' ? room.round + 1 : room.round };
  room.players.push(player); send(room); response.json({ session: player.token, room: view(room, player) });
});
app.get('/health', (_, response) => response.json({ ok: true }));
app.get('/api/status', (_, response) => {
  const active = [...rooms.values()].filter((room) => room.status !== 'finished' && room.players.some((player) => !player.isBot && player.connected));
  response.json({ activeRooms: active.length, connectedHumans: active.reduce((sum, room) => sum + room.players.filter((player) => !player.isBot && player.connected).length, 0), bots: active.reduce((sum, room) => sum + room.players.filter((player) => player.isBot).length, 0) });
});

io.on('connection', (socket) => {
  socket.on('room:enter', (data, reply) => {
    const room = rooms.get(String(data?.code || '').toUpperCase());
    const player = room?.players.find((item) => !item.isBot && item.token === data?.session);
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
    room.status = 'playing'; room.answer = answer(room.digits); reply?.({ ok: true });
    if (room.playStyle === 'traditional') nextRound(room); else { scheduleBots(room); send(room); }
  });
  socket.on('room:leave', (reply) => {
    const { room, player } = roomFor(socket);
    if (!room || !player) return reply?.({ error: '房間已失效。' });
    room.players.splice(room.players.indexOf(player), 1);
    if (room.status !== 'waiting') { player.exited = true; player.connected = false; room.departed.push(player); }
    reply?.({ ok: true });
    io.to(player.token).emit('room:left');
    io.in(player.token).socketsLeave(player.token);
    if (!room.players.some((item) => !item.isBot)) {
      if (room.timer) clearTimeout(room.timer);
      clearBotTimers(room);
      rooms.delete(room.code);
      return;
    }
    if (room.players[0].isBot) {
      const nextHost = room.players.find((item) => !item.isBot);
      room.players.splice(room.players.indexOf(nextHost), 1); room.players.unshift(nextHost);
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
    reply?.(recordGuess(room, player, guess));
  });
  socket.on('disconnect', () => {
    const { room, player } = roomFor(socket);
    if (!room || !player) return;
    player.connected = io.sockets.adapter.rooms.get(player.token)?.size > 0;
    if (room.players[0] === player && !player.connected) {
      const nextHost = room.players.find((item) => !item.isBot && item.connected);
      if (nextHost) { room.players.splice(room.players.indexOf(nextHost), 1); room.players.unshift(nextHost); }
    }
    send(room);
  });
});
server.listen(process.env.PORT || 3001);
