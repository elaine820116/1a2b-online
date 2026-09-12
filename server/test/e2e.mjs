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
  const host = await api('/api/rooms', { nickname: '甲', password: 'test1234', maxPlayers: 2, mode });
  const guest = await api(`/api/rooms/${host.room.code}/join`, { nickname: '乙', password: 'test1234' });
  const a = io(base, { autoConnect: false }), b = io(base, { autoConnect: false });
  a.connect(); b.connect(); await Promise.all([connect(a), connect(b)]);
  const beforeA = await emit(a, 'room:enter', { code: host.room.code, session: host.session });
  await emit(b, 'room:enter', { code: host.room.code, session: guest.session });
  assert.equal(beforeA.room.answer, null);
  assert.deepEqual(await emit(a, 'room:start'), { ok: true });
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
  await delay(500);
  const first = await setup('first');
  const firstFinal = await latest(first.a, () => solve(first.a));
  assert.equal(firstFinal.status, 'finished'); assert.ok(firstFinal.answer); assert.ok(firstFinal.players[0].history.length); first.a.close(); first.b.close();
  const all = await setup('all');
  await solve(all.a);
  const stillPlaying = await emit(all.b, 'game:guess', '4567');
  assert.ok(stillPlaying.result); 
  const allFinal = await latest(all.b, () => solve(all.b));
  assert.equal(allFinal.status, 'finished'); assert.deepEqual(allFinal.players.map((p) => p.rank).sort(), [1, 2]); assert.ok(allFinal.players.every((p) => p.history)); all.a.close(); all.b.close();
  console.log('Phase 4 E2E passed: first/all modes, secret protection, ranking, public histories');
} finally {
  server.kill();
}
