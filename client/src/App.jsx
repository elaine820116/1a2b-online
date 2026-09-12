import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const api = import.meta.env.VITE_API_URL || '';
const socketUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';
const sessionKey = (code) => `1a2b:${code}`;

async function post(path, body) {
  const response = await fetch(`${api}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}

function Field({ label, children }) { return <label>{label}{children}</label>; }

function Game({ room, socket, error, setError }) {
  const [guess, setGuess] = useState('');
  const finished = room.status === 'finished';
  const ranking = [...room.players].sort((a, b) => (a.rank || 99) - (b.rank || 99) || b.best - a.best);
  function submit(event) {
    event.preventDefault();
    socket.current.emit('game:guess', guess, (result) => result?.error && setError(result.error));
    setGuess('');
  }
  return <main><section className="form-card"><span className="eyebrow">即時 PK</span><h1>{finished ? `本局結束：答案 ${room.answer}` : '破解答案'}</h1>
    {!finished && <form onSubmit={submit}><Field label="輸入 4 個不重複數字"><input value={guess} onChange={(e) => setGuess(e.target.value)} inputMode="numeric" maxLength="4" required /></Field><button>送出猜測</button></form>}
    <h2>{finished ? '最終排名' : '目前領先榜'}</h2>{ranking.map((p, index) => <p key={p.id}>{p.rank || index + 1}. {p.nickname}　{finished ? `共 ${p.attempts} 次` : `最高 ${Math.floor(p.best / 10)}A${p.best % 10}B`}</p>)}
    {finished && <><h2>所有猜測紀錄</h2>{room.players.map((p) => <div key={p.id}><strong>{p.nickname}</strong>{p.history.map((g, i) => <p key={i}>{g.guess}　{g.A}A{g.B}B</p>)}</div>)}<button onClick={() => location.assign('/')}>再玩一局</button></>}
    {!finished && <><h2>玩家 PK</h2>{room.players.map((p) => <p key={p.id}>{p.nickname}：第 {p.attempts} 次／最近 {p.last}</p>)}</>}{error && <p className="error">{error}</p>}</section></main>;
}

function Waiting({ room, socket, error, setError }) {
  return <main><section className="form-card"><span className="eyebrow">等待室</span><h1>{room.name || '1A2B PK 房間'}</h1><div className="invite"><strong>邀請網址</strong><code>{location.origin}/r/{room.code}</code></div><h2>玩家</h2>{room.players.map((p) => <p key={p.id}>● {p.nickname}{p.isHost ? '（房主）' : ''}　{p.connected ? (p.ready ? 'Ready' : '未 Ready') : '已離線'}</p>)}<button onClick={() => socket.current.emit('room:ready')}>切換 Ready</button>{room.isHost && <button onClick={() => socket.current.emit('room:start', (r) => r?.error && setError(r.error))}>開始遊戲</button>}{error && <p className="error">{error}</p>}</section></main>;
}

export default function App() {
  const code = location.pathname.match(/^\/r\/([\w-]+)$/)?.[1]?.toUpperCase();
  const [room, setRoom] = useState(null); const [error, setError] = useState('');
  const [session, setSession] = useState(() => code && localStorage.getItem(sessionKey(code)));
  const [form, setForm] = useState({ nickname: '', name: '', password: '', maxPlayers: 4, mode: 'first' });
  const socket = useRef();
  useEffect(() => { if (!code || !session) return; const client = socket.current = io(socketUrl); client.on('room:update', setRoom); client.on('connect', () => client.emit('room:enter', { code, session }, (r) => { if (r.error) { localStorage.removeItem(sessionKey(code)); setSession(null); setError(r.error); } else setRoom(r.room); })); return () => client.disconnect(); }, [code, session]);
  async function join(event) { event.preventDefault(); try { const r = await post(`/api/rooms/${code}/join`, { nickname: form.nickname, password: form.password }); localStorage.setItem(sessionKey(code), r.session); setSession(r.session); setRoom(r.room); } catch (e) { setError(e.message); } }
  async function create(event) { event.preventDefault(); try { const r = await post('/api/rooms', form); localStorage.setItem(sessionKey(r.room.code), r.session); history.replaceState({}, '', `/r/${r.room.code}`); setSession(r.session); setRoom(r.room); } catch (e) { setError(e.message); } }
  if (room?.status === 'playing' || room?.status === 'finished') return <Game room={room} socket={socket} error={error} setError={setError} />;
  if (room) return <Waiting room={room} socket={socket} error={error} setError={setError} />;
  const joining = Boolean(code);
  return <main><section className="hero"><span className="eyebrow">多人 1A2B</span><h1>{joining ? '加入房間' : '建立房間，和朋友即時 PK。'}</h1></section><form className="form-card" onSubmit={joining ? join : create}><Field label="暱稱"><input required value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} /></Field>{!joining && <><Field label="房間名稱（可留空）"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><Field label="玩家上限"><select value={form.maxPlayers} onChange={(e) => setForm({ ...form, maxPlayers: +e.target.value })}>{[2,3,4,5,6,7,8,9,10].map((n) => <option key={n}>{n}</option>)}</select></Field><Field label="遊戲模式"><select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}><option value="first">第一位猜中立即結束</option><option value="all">全部玩家完成</option></select></Field></>}<Field label="房間密碼"><input required type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>{error && <p className="error">{error}</p>}<button>{joining ? '加入等待室' : '建立房間'}</button></form></main>;
}
