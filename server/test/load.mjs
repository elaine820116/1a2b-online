import { io } from 'socket.io-client';

const base = process.argv[2];
const roomCount = Number(process.argv[3] || 5);
const playersPerRoom = Number(process.argv[4] || 10);
if (!/^https?:\/\//.test(base || '') || roomCount < 1 || roomCount > 10 || playersPerRoom < 2 || playersPerRoom > 10) {
  throw new Error('Usage: node server/test/load.mjs URL [rooms: 1-10] [players: 2-10]');
}

const sockets = [];
const sessions = [];
const latencies = [];
const started = Date.now();
const timeout = (ms) => AbortSignal.timeout(ms);
async function post(path, body) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: timeout(30000) });
  const data = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${data.error}`);
  return data;
}
function connect(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket connection timeout')), 30000);
    socket.once('connect', () => { clearTimeout(timer); resolve(); });
    socket.once('connect_error', (error) => { clearTimeout(timer); reject(error); });
    socket.connect();
  });
}
function emit(socket, event, ...args) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timeout`)), 30000);
    socket.emit(event, ...args, (response) => { clearTimeout(timer); response?.error ? reject(new Error(response.error)) : resolve(response); });
  });
}
try {
  const groups = [];
  for (let roomIndex = 0; roomIndex < roomCount; roomIndex++) {
    const host = await post('/api/rooms', { nickname: `壓測房主${roomIndex}`, password: 'test-only', maxPlayers: playersPerRoom, mode: 'all', playStyle: 'race', digits: 4 });
    const members = [host];
    sessions.push({ code: host.room.code, session: host.session });
    for (let playerIndex = 1; playerIndex < playersPerRoom; playerIndex++) {
      const guest = await post(`/api/rooms/${host.room.code}/join`, { nickname: `壓測玩家${playerIndex}`, inviteToken: host.room.inviteToken });
      members.push(guest); sessions.push({ code: host.room.code, session: guest.session });
    }
    groups.push({ code: host.room.code, members });
  }
  for (const group of groups) {
    group.sockets = [];
    for (const member of group.members) {
      const socket = io(base, { autoConnect: false, reconnection: false, timeout: 30000 });
      sockets.push(socket); group.sockets.push(socket);
      await connect(socket);
      await emit(socket, 'room:enter', { code: group.code, session: member.session });
    }
  }
  const status = await (await fetch(`${base}/api/status`, { signal: timeout(30000) })).json();
  for (const group of groups) {
    for (const socket of group.sockets.slice(1)) await emit(socket, 'room:ready');
    await emit(group.sockets[0], 'room:start');
  }
  await Promise.all(groups.flatMap((group) => group.sockets.map(async (socket) => {
    const t0 = performance.now();
    await emit(socket, 'game:guess', '0123');
    latencies.push(Math.round(performance.now() - t0));
  })));
  latencies.sort((a, b) => a - b);
  console.log(JSON.stringify({ requestedRooms: roomCount, requestedPlayers: roomCount * playersPerRoom, status, successfulGuesses: latencies.length, guessAckMs: { median: latencies[Math.floor(latencies.length / 2)], p95: latencies[Math.ceil(latencies.length * 0.95) - 1], max: latencies.at(-1) }, elapsedSeconds: Math.round((Date.now() - started) / 1000) }, null, 2));
} finally {
  for (const socket of sockets) {
    if (socket.connected) {
      try { await emit(socket, 'room:leave'); } catch { /* cleanup after a failed run */ }
    }
    socket.close();
  }
}
