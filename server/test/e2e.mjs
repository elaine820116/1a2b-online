import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const port = 3101;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['src/index.js'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const emit = (socket, event, ...args) => new Promise((resolve) => socket.emit(event, ...args, resolve));
const connect = (socket) => new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });

async function api(path, body) {
  const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return response.json();
}
async function setup(mode) {
  const host = await api('/api/rooms', { nickname: '甲', password: 'test1234', maxPlayers: 2, mode, playStyle: 'race', allowMidJoin: false });
  const guest = await api(`/api/rooms/${host.room.code}/join`, { nickname: '乙', password: 'test1234' });
  const a = io(base, { autoConnect: false }), b = io(base, { autoConnect: false });
  a.connect(); b.connect(); await Promise.all([connect(a), connect(b)]);
  const beforeA = await emit(a, 'room:enter', { code: host.room.code, session: host.session });
  await emit(b, 'room:enter', { code: host.room.code, session: guest.session });
  assert.equal(beforeA.room.answer, null);
  assert.ok(beforeA.room.players.every((player) => player.history === undefined));
  assert.deepEqual(await emit(a, 'room:start'), { ok: true });
  const hostPlaying = await emit(a, 'room:enter', { code: host.room.code, session: host.session });
  const guestPlaying = await emit(b, 'room:enter', { code: host.room.code, session: guest.session });
  assert.equal(hostPlaying.room.canGuess, true, 'race host must be able to guess');
  assert.equal(guestPlaying.room.canGuess, true, 'race guest must be able to guess');
  return { a, b };
}
async function solve(socket) {
  for (let a = 0; a < 10; a++) for (let b = 0; b < 10; b++) for (let c = 0; c < 10; c++) for (let d = 0; d < 10; d++) {
    const guess = `${a}${b}${c}${d}`;
    if (new Set(guess).size !== 4) continue;
    const response = await emit(socket, 'game:guess', guess);
    if (response.result?.A === 4) return guess;
  }
  throw new Error('answer not found');
}
async function latest(socket, action) {
  return new Promise(async (resolve, reject) => {
    const handler = (room) => { if (room.status === 'finished') { socket.off('room:update', handler); resolve(room); } };
    socket.on('room:update', handler);
    try { await action(); } catch (error) { socket.off('room:update', handler); reject(error); }
  });
}

try {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await fetch(`${base}/health`)).ok) break; } catch { /* server still starting */ }
    await delay(250);
  }
  const first = await setup('first');
  const firstFinal = await latest(first.a, () => solve(first.a));
  assert.equal(firstFinal.status, 'finished'); assert.ok(firstFinal.answer); assert.ok(firstFinal.players[0].history.length); first.a.close(); first.b.close();
  const all = await setup('all');
  await solve(all.a);
  const stillPlaying = await emit(all.b, 'game:guess', '4567');
  assert.ok(stillPlaying.result); 
  const allFinal = await latest(all.b, () => solve(all.b));
  assert.equal(allFinal.status, 'finished'); assert.deepEqual(allFinal.players.map((p) => p.rank).sort(), [1, 2]); assert.ok(allFinal.players.every((p) => p.history)); all.a.close(); all.b.close();
  const newRoom = await api('/api/rooms', { nickname: '房主', password: 'pw', maxPlayers: 3, mode: 'first', playStyle: 'traditional', turnSeconds: 15, allowMidJoin: true });
  const duplicateResponse = await fetch(base + `/api/rooms/${newRoom.room.code}/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: '房主', password: 'pw' }) });
  assert.equal(duplicateResponse.status, 409);
  assert.equal((await duplicateResponse.json()).code, 'DUPLICATE_NICKNAME');
  const guest = await api(`/api/rooms/${newRoom.room.code}/join`, { nickname: '訪客', password: 'pw' });
  const hostSocket = io(base, { autoConnect: false }), guestSocket = io(base, { autoConnect: false });
  hostSocket.connect(); guestSocket.connect(); await Promise.all([connect(hostSocket), connect(guestSocket)]);
  await emit(hostSocket, 'room:enter', { code: newRoom.room.code, session: newRoom.session });
  await emit(guestSocket, 'room:enter', { code: newRoom.room.code, session: guest.session });
  assert.deepEqual(await emit(hostSocket, 'room:start'), { ok: true });
  const hostGuess = await emit(hostSocket, 'game:guess', '1234');
  assert.ok(hostGuess.result);
  assert.match((await emit(hostSocket, 'game:guess', '5678')).error, /本輪已猜測/);
  const midJoin = await api(`/api/rooms/${newRoom.room.code}/join`, { nickname: '中途', password: 'pw' });
  assert.equal(midJoin.room.canGuess, false);
  assert.match((await emit(guestSocket, 'game:guess', '1234')).result.guess, /1234/);
  const midSocket = io(base, { autoConnect: false }); midSocket.connect(); await connect(midSocket);
  await emit(midSocket, 'room:enter', { code: newRoom.room.code, session: midJoin.session });
  const nextView = await emit(midSocket, 'game:guess', '5678');
  assert.ok(nextView.result, 'mid-join player can guess from the next round');
  assert.equal(nextView.result.guess, '5678');
  const privateView = await emit(hostSocket, 'room:enter', { code: newRoom.room.code, session: newRoom.session });
  assert.equal(privateView.room.answer, null);
  assert.ok(privateView.room.players.every((player) => player.history === undefined));
  hostSocket.close(); guestSocket.close(); midSocket.close();
  const timeoutRoom = await api('/api/rooms', { nickname: '計時房主', password: 'pw', maxPlayers: 2, mode: 'first', playStyle: 'traditional', turnSeconds: 15, allowMidJoin: false });
  const timeoutGuest = await api(`/api/rooms/${timeoutRoom.room.code}/join`, { nickname: '計時訪客', password: 'pw' });
  const ta = io(base, { autoConnect: false }), tb = io(base, { autoConnect: false });
  ta.connect(); tb.connect(); await Promise.all([connect(ta), connect(tb)]);
  await emit(ta, 'room:enter', { code: timeoutRoom.room.code, session: timeoutRoom.session });
  await emit(tb, 'room:enter', { code: timeoutRoom.room.code, session: timeoutGuest.session });
  await emit(ta, 'room:start');
  assert.ok((await emit(ta, 'game:guess', '1234')).result);
  const afterTimeout = await Promise.race([
    new Promise((resolve) => { const onUpdate = (state) => { if (state.round === 2) { ta.off('room:update', onUpdate); resolve(state); } }; ta.on('room:update', onUpdate); }),
    delay(17500).then(() => { throw new Error('traditional round did not advance after timeout'); }),
  ]);
  assert.equal(afterTimeout.guesses.length, 1);
  const guestAfterTimeout = await emit(tb, 'room:enter', { code: timeoutRoom.room.code, session: timeoutGuest.session });
  assert.equal(guestAfterTimeout.room.guesses[0].missed, true);
  assert.equal(guestAfterTimeout.room.players[0].history, undefined);
  ta.close(); tb.close();
  console.log('E2E passed: race modes, secret protection, private/public histories, duplicate names, traditional rounds and mid-join');
} finally {
  server.kill();
}
