import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const api = import.meta.env.VITE_API_URL || '';
const socketUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';
const sessionKey = (code) => `1a2b:${code}`;
const styleName = (style) => style === 'traditional' ? '傳統回合' : '競速挑戰';
const modeName = (mode) => mode === 'all' ? '全員完成' : '率先猜中';

async function post(path, body) {
  const response = await fetch(`${api}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error); error.code = data.code; throw error; }
  return data;
}

function Field({ label, children, note }) { return <label className="field"><span>{label}</span>{children}{note}</label>; }
function Badge({ children, muted = false }) { return <span className={`badge ${muted ? 'badge-muted' : ''}`}>{children}</span>; }

function Game({ room, socket, error, setError }) {
  const [guess, setGuess] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!room.roundDeadline) return undefined; const timer = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer); }, [room.roundDeadline]);
  const finished = room.status === 'finished';
  const traditional = room.playStyle === 'traditional';
  const secondsLeft = room.roundDeadline ? Math.max(0, Math.ceil((room.roundDeadline - now) / 1000)) : 0;
  const ranking = [...room.players].sort((a, b) => (a.rank || 99) - (b.rank || 99) || b.best - a.best);
  const own = room.players.find((player) => player.id === socket.current?.data?.session) || null;
  function submit(event) {
    event.preventDefault();
    if (!room.canGuess) return;
    socket.current?.emit('game:guess', guess, (result) => {
      if (result?.error) setError(result.error);
      else { setError(''); setGuess(''); }
    });
  }
  return <main className="game-page">
    <header className="game-header"><div><span className="eyebrow">1A2B / LIVE MATCH</span><h1>{finished ? '本局結果' : '猜出秘密數字'}</h1><p>房間 {room.code} · {styleName(room.playStyle)} · {modeName(room.mode)}</p></div><div className="header-mark">{finished ? '✓' : '4'}</div></header>
    {finished ? <section className="result-hero"><span className="eyebrow">THE ANSWER</span><strong>{room.answer}</strong><p>{room.mode === 'first' ? `勝利者：${ranking[0]?.nickname || '—'}` : '所有玩家已完成挑戰'}</p></section>
      : <section className="status-strip"><div><span className="status-dot" /> 對戰進行中</div><div>{traditional ? `第 ${room.round} 輪` : '自由競速'}</div>{traditional && <div className={secondsLeft <= 5 ? 'urgent' : ''}>剩餘 {secondsLeft} 秒</div>}</section>}
    <div className="game-grid"><div className="main-column">
      {!finished && <section className="panel guess-panel"><div className="section-heading"><div><span className="eyebrow">YOUR TURN</span><h2>我的操作區</h2></div><Badge>{traditional ? `第 ${room.round} 輪` : '不限次數'}</Badge></div>
        <p>{room.canGuess ? '輸入四個不重複的數字，看看離答案還有多遠。' : own?.done ? '你已猜中，等待本局結束。' : traditional ? '本輪已送出或尚未輪到你，請等待下一輪。' : '請稍候。'}</p>
        <form className="guess-form" onSubmit={submit}><input aria-label="輸入 4 個不重複數字" value={guess} onChange={(event) => setGuess(event.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength="4" placeholder="0 0 0 0" disabled={!room.canGuess} required /><button disabled={!room.canGuess}>送出猜測 <span>→</span></button></form>{error && <p className="error">{error}</p>}
      </section>}
      <section className="panel"><div className="section-heading"><div><span className="eyebrow">PRIVATE LOG</span><h2>我的猜測紀錄</h2></div><Badge muted>{room.guesses.filter((item) => !item.missed).length} 次</Badge></div>
        {room.guesses.length === 0 ? <p className="empty-state">還沒有紀錄，第一步就從這裡開始。</p> : <div className="history-list">{room.guesses.map((item, index) => <div className="history-row" key={index}><span className="history-index">{String(index + 1).padStart(2, '0')}</span><div><strong>{item.missed ? '未猜測數字' : item.guess}</strong><small>{traditional ? `第 ${item.round} 輪` : `第 ${index + 1} 次`}</small></div><span className="score">{item.missed ? '—' : `${item.A}A ${item.B}B`}</span></div>)}</div>}
        {!finished && <p className="privacy-note">🔒 只有你看得到自己的猜測數字；對局結束後才會公開。</p>}
      </section>
      {finished && <section className="panel"><div className="section-heading"><div><span className="eyebrow">FULL RECORD</span><h2>所有玩家的猜測紀錄</h2></div></div>{room.players.map((player) => <div className="player-history" key={player.id}><h3>{player.nickname}</h3>{player.history.length ? player.history.map((item, index) => <div className="history-row" key={index}><span className="history-index">{String(index + 1).padStart(2, '0')}</span><div><strong>{item.missed ? '未猜測數字' : item.guess}</strong><small>{traditional ? `第 ${item.round} 輪` : `第 ${index + 1} 次`}</small></div><span className="score">{item.missed ? '—' : `${item.A}A ${item.B}B`}</span></div>) : <p>沒有猜測紀錄。</p>}</div>)}<button className="secondary-button" onClick={() => location.assign('/')}>再玩一局</button></section>}
    </div><aside className="side-column">
      <section className="panel"><div className="section-heading"><div><span className="eyebrow">STANDINGS</span><h2>{finished ? '最終排名' : '目前領先榜'}</h2></div></div>{ranking.map((player, index) => <div className="leader-row" key={player.id}><span className={`rank-number rank-${index + 1}`}>{player.rank || index + 1}</span><div><strong>{player.nickname}</strong><small>{finished ? `${player.attempts} 次猜測` : player.done ? '已猜中' : `最高 ${Math.floor(player.best / 10)}A${player.best % 10}B`}</small></div></div>)}</section>
      <section className="panel"><div className="section-heading"><div><span className="eyebrow">PLAYERS</span><h2>玩家 PK</h2></div><Badge muted>{room.players.length} 人</Badge></div>{room.players.map((player) => <div className="player-row" key={player.id}><span className="player-avatar">{player.nickname.slice(0, 1)}</span><div><strong>{player.nickname}</strong><small>{player.done ? '已完成' : traditional && player.roundSubmitted && !finished ? '本輪已送出' : `猜測 ${player.attempts} 次 · 最近 ${player.last}`}</small></div><span className={`connection ${player.connected ? '' : 'offline'}`} title={player.connected ? '在線' : '離線'} /></div>)}</section>
    </aside></div>
  </main>;
}

function Waiting({ room, socket, error, setError }) {
  return <main className="narrow-page"><div className="hero"><span className="eyebrow">WAITING ROOM</span><h1>{room.name || '1A2B PK 房間'}</h1><p>{styleName(room.playStyle)} · {modeName(room.mode)} · {room.allowMidJoin ? '可中途加入' : '開始後不可加入'}</p></div><section className="panel"><div className="section-heading"><h2>邀請朋友</h2><Badge>{room.code}</Badge></div><div className="invite"><span>私人邀請網址</span><code>{location.origin}/r/{room.code}</code><button type="button" onClick={() => navigator.clipboard.writeText(`${location.origin}/r/${room.code}`)}>複製網址</button></div><h2>玩家 · {room.players.length}/{room.maxPlayers}</h2>{room.players.map((player) => <div className="player-row" key={player.id}><span className="player-avatar">{player.nickname.slice(0, 1)}</span><div><strong>{player.nickname}{player.isHost ? ' · 房主' : ''}</strong><small>{player.connected ? player.ready ? 'Ready' : '未 Ready' : '已離線'}</small></div></div>)}<div className="actions"><button className="secondary-button" onClick={() => socket.current?.emit('room:ready')}>切換 Ready</button>{room.isHost && <button onClick={() => socket.current?.emit('room:start', (result) => result?.error && setError(result.error))}>開始遊戲 →</button>}</div>{error && <p className="error">{error}</p>}</section></main>;
}

export default function App() {
  const code = location.pathname.match(/^\/r\/([\w-]+)$/)?.[1]?.toUpperCase();
  const [room, setRoom] = useState(null), [error, setError] = useState(''), [nameError, setNameError] = useState('');
  const [session, setSession] = useState(() => code && localStorage.getItem(sessionKey(code)));
  const [form, setForm] = useState({ nickname: '', name: '', password: '', maxPlayers: 4, mode: 'first', playStyle: 'race', allowMidJoin: false, turnSeconds: 20 });
  const socket = useRef();
  useEffect(() => {
    if (!code || !session) return undefined;
    const client = socket.current = io(socketUrl);
    client.data = { session };
    client.on('room:update', setRoom);
    client.on('connect', () => client.emit('room:enter', { code, session }, (result) => {
      if (result.error) { localStorage.removeItem(sessionKey(code)); setSession(null); setError(result.error); }
      else setRoom(result.room);
    }));
    return () => client.disconnect();
  }, [code, session]);
  async function join(event) {
    event.preventDefault(); setError(''); setNameError('');
    try { const result = await post(`/api/rooms/${code}/join`, { nickname: form.nickname, password: form.password }); localStorage.setItem(sessionKey(code), result.session); setSession(result.session); setRoom(result.room); }
    catch (cause) { if (cause.code === 'DUPLICATE_NICKNAME') setNameError('暱稱重複'); else setError(cause.message); }
  }
  async function create(event) {
    event.preventDefault(); setError('');
    try { const result = await post('/api/rooms', form); localStorage.setItem(sessionKey(result.room.code), result.session); history.replaceState({}, '', `/r/${result.room.code}`); setSession(result.session); setRoom(result.room); }
    catch (cause) { setError(cause.message); }
  }
  if (room?.status === 'playing' || room?.status === 'finished') return <Game room={room} socket={socket} error={error} setError={setError} />;
  if (room) return <Waiting room={room} socket={socket} error={error} setError={setError} />;
  const joining = Boolean(code);
  return <main className="narrow-page"><div className="hero"><span className="eyebrow">1A2B / ONLINE PK</span><h1>{joining ? '加入房間，一起破解。' : '建立房間，和朋友即時 PK。'}</h1><p>一個秘密答案，一場腦力競賽。分享網址，立即開玩。</p></div><form className="panel room-form" onSubmit={joining ? join : create}>
    <Field label="暱稱" note={nameError && <span className="field-error">暱稱重複</span>}><input required maxLength="20" value={form.nickname} onChange={(event) => { setForm({ ...form, nickname: event.target.value }); setNameError(''); }} /></Field>
    {!joining && <><Field label="房間名稱（可留空）"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field><div className="form-pair"><Field label="玩家上限"><select value={form.maxPlayers} onChange={(event) => setForm({ ...form, maxPlayers: Number(event.target.value) })}>{[2,3,4,5,6,7,8,9,10].map((number) => <option key={number}>{number}</option>)}</select></Field><Field label="結束方式"><select value={form.mode} onChange={(event) => setForm({ ...form, mode: event.target.value })}><option value="first">第一位猜中立即結束</option><option value="all">全部玩家完成</option></select></Field></div><Field label="玩法"><select value={form.playStyle} onChange={(event) => setForm({ ...form, playStyle: event.target.value })}><option value="race">競速 · 自由猜測</option><option value="traditional">傳統 · 同步回合</option></select></Field>{form.playStyle === 'traditional' && <Field label="每輪猜測時間"><select value={form.turnSeconds} onChange={(event) => setForm({ ...form, turnSeconds: Number(event.target.value) })}><option value="15">15 秒</option><option value="20">20 秒</option><option value="30">30 秒</option><option value="60">1 分鐘</option></select></Field>}<label className="check-field"><input type="checkbox" checked={form.allowMidJoin} onChange={(event) => setForm({ ...form, allowMidJoin: event.target.checked })} /><span><strong>允許中途加入</strong><small>傳統玩法的新玩家從下一輪開始；競速玩法可立即開始。</small></span></label></>}
    <Field label="房間密碼"><input required type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></Field>{error && <p className="error">{error}</p>}<button>{joining ? '加入等待室 →' : '建立房間 →'}</button>
  </form></main>;
}
