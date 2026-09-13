import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const api = import.meta.env.VITE_API_URL || '';
const socketUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';
const sessionKey = (code) => `1a2b:${code}`;
const inviteUrl = (room) => `${location.origin}/r/${room.code}?invite=${encodeURIComponent(room.inviteToken)}`;
const styleName = (style) => style === 'traditional' ? '傳統回合' : '競速挑戰';
const modeName = (mode) => mode === 'all' ? '全員完成' : '率先猜中';
let audioContext;
function enableAudio() {
  try { audioContext ||= new window.AudioContext(); audioContext.resume(); } catch { /* Browser audio is optional. */ }
}
function clickSound() {
  enableAudio();
  if (!audioContext) return;
  const oscillator = audioContext.createOscillator(), volume = audioContext.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(560, audioContext.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(820, audioContext.currentTime + 0.07);
  volume.gain.setValueAtTime(0.0001, audioContext.currentTime);
  volume.gain.exponentialRampToValueAtTime(0.065, audioContext.currentTime + 0.01);
  volume.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.1);
  oscillator.connect(volume).connect(audioContext.destination);
  oscillator.start(); oscillator.stop(audioContext.currentTime + 0.11);
}
function tickSound(urgent) {
  if (!audioContext || audioContext.state !== 'running') return;
  const oscillator = audioContext.createOscillator(), volume = audioContext.createGain();
  oscillator.type = 'sine'; oscillator.frequency.value = urgent ? 900 : 620;
  volume.gain.setValueAtTime(0.0001, audioContext.currentTime);
  volume.gain.exponentialRampToValueAtTime(0.144, audioContext.currentTime + 0.01);
  volume.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.12);
  oscillator.connect(volume).connect(audioContext.destination);
  oscillator.start(); oscillator.stop(audioContext.currentTime + 0.13);
}

async function post(path, body) {
  const response = await fetch(`${api}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error); error.code = data.code; throw error; }
  return data;
}

function Field({ label, children, note }) { return <label className="field"><span>{label}</span>{children}{note}</label>; }
function Badge({ children, muted = false }) { return <span className={`badge ${muted ? 'badge-muted' : ''}`}>{children}</span>; }
const avatars = [1, 2, 3, 4, 5, 6];
function Avatar({ id, name, className = '' }) {
  return <span className={`avatar-art ${className}`}><img src={`/avatars/avatar-${avatars.includes(id) ? id : 1}.png`} alt={`${name || '玩家'}的頭像`} /></span>;
}
function AvatarPicker({ selected, onSelect }) {
  return <fieldset className="avatar-picker"><legend>選擇你的探險家</legend><p>六位原創角色，選一位代表你加入挑戰。</p><div className="avatar-options">{avatars.map((id) => <button type="button" className={`avatar-option ${selected === id ? 'selected' : ''}`} aria-label={`${id <= 3 ? '男生' : '女生'}角色 ${id <= 3 ? id : id - 3}`} aria-pressed={selected === id} key={id} onClick={() => onSelect(id)}><Avatar id={id} name={`角色 ${id}`} /><span>{id <= 3 ? `男生 ${id}` : `女生 ${id - 3}`}</span></button>)}</div></fieldset>;
}

function Game({ room, socket, error, setError, onLeave }) {
  const [guess, setGuess] = useState('');
  const [now, setNow] = useState(Date.now());
  const [soundOn, setSoundOn] = useState(true);
  const lastTick = useRef('');
  useEffect(() => { if (!room.roundDeadline) return undefined; const timer = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer); }, [room.roundDeadline]);
  const finished = room.status === 'finished';
  const traditional = room.playStyle === 'traditional';
  const secondsLeft = room.roundDeadline ? Math.max(0, Math.ceil((room.roundDeadline - now) / 1000)) : 0;
  useEffect(() => {
    if (!traditional || finished || !soundOn || secondsLeft < 1 || secondsLeft > 5) return;
    const key = `${room.round}:${secondsLeft}`;
    if (lastTick.current !== key) { lastTick.current = key; tickSound(secondsLeft === 1); }
  }, [traditional, finished, soundOn, secondsLeft, room.round]);
  const ranking = [...room.players].sort((a, b) => Number(a.exited) - Number(b.exited) || (a.rank || 99) - (b.rank || 99) || b.best - a.best);
  const own = room.players.find((player) => player.id === room.viewerId) || null;
  function submit(event) {
    event.preventDefault();
    if (!room.canGuess) return;
    socket.current?.emit('game:guess', guess, (result) => {
      if (result?.error) setError(result.error);
      else { setError(''); setGuess(''); }
    });
  }
  return <main className="game-page expedition-page">
    <header className="game-header"><div><span className="eyebrow">1A2B / LIVE MATCH</span><h1>{finished ? '本局結果' : '猜出秘密數字'}</h1><p>{room.solo ? '單人挑戰' : `房間 ${room.code} · ${styleName(room.playStyle)} · ${modeName(room.mode)}`} · {room.digits} 位數</p></div><button type="button" className="exit-button" onClick={onLeave}>退出遊戲</button></header>
    {finished ? <section className="result-hero"><span className="eyebrow">THE ANSWER</span><strong>{room.answer}</strong><p>{room.solo ? '恭喜你猜中答案！' : room.mode === 'first' ? `勝利者：${ranking[0]?.nickname || '—'}` : '所有玩家已完成挑戰'}</p></section>
      : traditional ? <section className="clock-panel"><div><span className="status-dot" /> 第 {room.round} 輪 · 對戰進行中</div><div className={`countdown-clock ${secondsLeft <= 5 ? 'urgent' : ''}`} style={{ '--progress': `${Math.max(0, secondsLeft / room.turnSeconds) * 100}%` }} role="timer" aria-label={`剩餘 ${secondsLeft} 秒`}><span>{String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:{String(secondsLeft % 60).padStart(2, '0')}</span></div><button type="button" className="sound-toggle" onClick={() => { enableAudio(); setSoundOn((value) => !value); }}>{soundOn ? '🔊 倒數音效開啟' : '🔇 倒數音效關閉'}</button></section> : <section className="status-strip"><div><span className="status-dot" /> 對戰進行中</div><div>自由競速</div></section>}
    <div className={`game-grid ${room.solo ? 'solo-grid' : ''}`}><div className="main-column">
      {!finished && <section className="panel guess-panel"><div className="section-heading"><div><span className="eyebrow">YOUR TURN</span><h2>我的操作區</h2></div><Badge>{traditional ? `第 ${room.round} 輪` : '不限次數'}</Badge></div>
        <p>{room.canGuess ? `輸入 ${room.digits} 個不重複的數字，看看離答案還有多遠。` : own?.done ? '你已猜中，等待本局結束。' : traditional ? '本輪已送出或尚未輪到你，請等待下一輪。' : '請稍候。'}</p>
        <form className="guess-form" onSubmit={submit}><input aria-label={`輸入 ${room.digits} 個不重複數字`} value={guess} onChange={(event) => setGuess(event.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength={room.digits} placeholder={Array(room.digits).fill('0').join(' ')} disabled={!room.canGuess} required /><button disabled={!room.canGuess}>送出猜測 <span>→</span></button></form>{error && <p className="error">{error}</p>}
      </section>}
      <section className="panel"><div className="section-heading"><div><span className="eyebrow">PRIVATE LOG</span><h2>我的猜測紀錄</h2></div><Badge muted>{room.guesses.filter((item) => !item.missed).length} 次</Badge></div>
        {room.guesses.length === 0 ? <p className="empty-state">還沒有紀錄，第一步就從這裡開始。</p> : <div className="history-list">{room.guesses.map((item, index) => <div className="history-row" key={index}><span className="history-index">{String(index + 1).padStart(2, '0')}</span><div><strong>{item.missed ? '未猜測數字' : item.guess}</strong><small>{traditional ? `第 ${item.round} 輪` : `第 ${index + 1} 次`}</small></div><span className="score">{item.missed ? '—' : `${item.A}A ${item.B}B`}</span></div>)}</div>}
        {!finished && <p className="privacy-note">🔒 只有你看得到自己的猜測數字；對局結束後才會公開。</p>}
      </section>
      {finished && <section className="panel"><div className="section-heading"><div><span className="eyebrow">FULL RECORD</span><h2>所有玩家的猜測紀錄</h2></div></div>{room.players.map((player) => <div className="player-history" key={player.id}><h3>{player.nickname}</h3>{player.history.length ? player.history.map((item, index) => <div className="history-row" key={index}><span className="history-index">{String(index + 1).padStart(2, '0')}</span><div><strong>{item.missed ? '未猜測數字' : item.guess}</strong><small>{traditional ? `第 ${item.round} 輪` : `第 ${index + 1} 次`}</small></div><span className="score">{item.missed ? '—' : `${item.A}A ${item.B}B`}</span></div>) : <p>沒有猜測紀錄。</p>}</div>)}<button className="secondary-button" onClick={() => location.assign('/')}>再玩一局</button></section>}
    </div>{!room.solo && <aside className="side-column">
      <section className="panel"><div className="section-heading"><div><span className="eyebrow">STANDINGS</span><h2>{finished ? '最終排名' : '目前領先榜'}</h2></div></div>{ranking.map((player, index) => <div className="leader-row" key={player.id}><span className={`rank-number rank-${index + 1}`}>{player.exited ? '—' : player.rank || index + 1}</span><Avatar id={player.avatar} name={player.nickname} /><div><strong>{player.nickname}</strong><small>{player.exited ? `已退出 · ${player.attempts} 次猜測` : finished ? `${player.attempts} 次猜測` : player.done ? '已猜中' : `最高 ${Math.floor(player.best / 10)}A${player.best % 10}B`}</small></div></div>)}</section>
    </aside>}</div>
  </main>;
}

function Waiting({ room, socket, error, setError, onLeave }) {
  const own = room.players.find((player) => player.id === room.viewerId);
  const canStart = room.isHost && room.players.length >= 2 && room.players.every((player) => player.connected && (player.isHost || player.ready));
  return <main className="narrow-page expedition-page"><div className="hero"><span className="eyebrow">WAITING ROOM</span><h1>{room.name || '1A2B PK 房間'}</h1><p>{styleName(room.playStyle)} · {modeName(room.mode)} · {room.digits} 位數 · {room.allowMidJoin ? '可中途加入' : '開始後不可加入'}</p></div><section className="panel"><div className="room-code-display"><span>房號</span><strong>{room.code}</strong><small>口頭告訴朋友房號時，對方仍需輸入房間密碼。</small></div><div className="section-heading"><h2>邀請朋友</h2></div><div className="invite"><span>私人邀請網址 · 使用完整網址可免密碼加入</span><code>{inviteUrl(room)}</code><button type="button" onClick={() => navigator.clipboard.writeText(inviteUrl(room))}>複製邀請網址</button></div><h2>玩家 · {room.players.length}/{room.maxPlayers}</h2>{room.players.map((player) => <div className="player-row" key={player.id}><Avatar id={player.avatar} name={player.nickname} /><div><strong>{player.nickname}{player.isHost ? ' · 房主' : ''}{player.isBot ? ' · 電腦' : ''}</strong><small>{player.isBot ? `電腦難度：${{ low: '低', medium: '中', high: '高' }[player.difficulty]}` : player.isHost ? '房主' : player.connected ? player.ready ? 'READY' : '未 READY' : '已離線'}</small></div></div>)}<div className="actions">{!room.isHost && <button className="secondary-button" aria-pressed={Boolean(own?.ready)} onClick={() => { enableAudio(); socket.current?.emit('room:ready', (result) => result?.error && setError(result.error)); }}>{own?.ready ? '取消 READY' : 'READY'}</button>}{room.isHost && <button disabled={!canStart} onClick={() => { enableAudio(); socket.current?.emit('room:start', (result) => result?.error && setError(result.error)); }}>開始遊戲 →</button>}</div>{room.isHost && !canStart && <p className="waiting-note">至少兩位玩家在線，且所有非房主真人玩家按下 READY 後即可開始。</p>}<button type="button" className="exit-button waiting-exit" onClick={onLeave}>退出房間</button>{error && <p className="error">{error}</p>}</section></main>;
}

export default function App() {
  useEffect(() => {
    const onClick = (event) => { if (event.target.closest('button:not(:disabled)')) clickSound(); };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);
  const code = location.pathname.match(/^\/r\/([\w-]+)$/)?.[1]?.toUpperCase();
  const inviteToken = new URLSearchParams(location.search).get('invite') || '';
  const [room, setRoom] = useState(null), [error, setError] = useState(''), [nameError, setNameError] = useState(''), [submitting, setSubmitting] = useState(false);
  const [session, setSession] = useState(() => code && localStorage.getItem(sessionKey(code)));
  const [entry, setEntry] = useState(code ? 'join' : 'choice');
  const [roomCode, setRoomCode] = useState('');
  const [status, setStatus] = useState(null);
  const [form, setForm] = useState({ nickname: '', avatar: 1, name: '', password: '', maxPlayers: 4, mode: 'first', playStyle: 'race', digits: 4, botCount: 0, botDifficulty: 'medium', allowMidJoin: false, turnSeconds: 20 });
  const socket = useRef();
  useEffect(() => {
    if (code || entry !== 'choice') return undefined;
    let active = true;
    const refresh = async () => {
      try { const response = await fetch(`${api}/api/status`, { signal: AbortSignal.timeout(15000) }); if (response.ok && active) setStatus(await response.json()); }
      catch { if (active) setStatus(null); }
    };
    refresh(); const timer = setInterval(refresh, 30000);
    return () => { active = false; clearInterval(timer); };
  }, [code, entry]);
  useEffect(() => {
    if (!code || !session) return undefined;
    const client = socket.current = io(socketUrl);
    client.data = { session };
    client.on('room:update', setRoom);
    client.on('room:left', () => { localStorage.removeItem(sessionKey(code)); location.assign('/'); });
    client.on('connect', () => client.emit('room:enter', { code, session }, (result) => {
      if (result.error) { localStorage.removeItem(sessionKey(code)); setSession(null); setError(result.error); }
      else setRoom(result.room);
    }));
    return () => client.disconnect();
  }, [code, session]);
  async function join(event) {
    event.preventDefault(); if (submitting) return; setSubmitting(true); setError(''); setNameError('');
    try { const result = await post(`/api/rooms/${code}/join`, { nickname: form.nickname, avatar: form.avatar, password: form.password, inviteToken }); localStorage.setItem(sessionKey(code), result.session); setSession(result.session); setRoom(result.room); }
    catch (cause) { if (cause.code === 'DUPLICATE_NICKNAME') setNameError('暱稱重複'); else setError(cause.name === 'TimeoutError' ? '伺服器啟動逾時，請稍後再試。' : cause.message || '連線失敗，請稍後再試。'); }
    finally { setSubmitting(false); }
  }
  async function create(event) {
    event.preventDefault(); if (submitting) return; setSubmitting(true); setError('');
    try { const result = await post('/api/rooms', entry === 'solo' ? { nickname: form.nickname, avatar: form.avatar, digits: form.digits, solo: true } : form); localStorage.setItem(sessionKey(result.room.code), result.session); history.replaceState({}, '', result.room.solo ? `/r/${result.room.code}` : `/r/${result.room.code}?invite=${encodeURIComponent(result.room.inviteToken)}`); setSession(result.session); setRoom(result.room); }
    catch (cause) { setError(cause.name === 'TimeoutError' ? '伺服器啟動逾時，請稍後再試。' : cause.message || '連線失敗，請稍後再試。'); }
    finally { setSubmitting(false); }
  }
  function leave() {
    socket.current?.emit('room:leave', (result) => {
      if (result?.error) setError(result.error);
      else { localStorage.removeItem(sessionKey(code)); location.assign('/'); }
    });
  }
  if (room?.status === 'playing' || room?.status === 'finished') return <Game room={room} socket={socket} error={error} setError={setError} onLeave={leave} />;
  if (room) return <Waiting room={room} socket={socket} error={error} setError={setError} onLeave={leave} />;
  if (!code && entry === 'choice') return <main className="narrow-page expedition-page"><div className="hero"><span className="eyebrow">1A2B / ONLINE PK</span><h1>集結朋友，破解秘密數字。</h1><p>單人練習，或建立房間與朋友、電腦展開對決。</p></div><section className="entry-options"><button type="button" className="entry-card" onClick={() => setEntry('solo')}><strong>單人模式</strong><span>一人即可開始，挑戰秘密數字 →</span></button><button type="button" className="entry-card" onClick={() => setEntry('create')}><strong>建立房間</strong><span>設定玩法、邀請朋友或加入電腦 →</span></button><button type="button" className="entry-card" onClick={() => setEntry('join-code')}><strong>加入房間</strong><span>已有房號？輸入後選擇角色加入 →</span></button></section><section className="occupancy-panel" aria-live="polite"><strong>目前遊玩狀態</strong>{status ? <p>{status.activeRooms} 間進行中的房間 · {status.connectedHumans} 位線上真人 · {status.bots} 位電腦</p> : <p>目前無法取得即時房／人數，不影響建立房間。</p>}<small>每間房最多 10 人；目前沒有規定最多可開幾間房。</small></section></main>;
  if (!code && entry === 'join-code') return <main className="narrow-page expedition-page"><div className="hero"><span className="eyebrow">JOIN A ROOM</span><h1>加入朋友的房間。</h1><p>請輸入邀請網址最後的房號。</p></div><form className="panel room-form" onSubmit={(event) => { event.preventDefault(); location.assign(`/r/${roomCode.trim().toUpperCase()}`); }}><Field label="房號"><input required autoFocus maxLength="12" value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} placeholder="例如 ABC123" /></Field><button className="room-submit">下一步 →</button><button type="button" className="secondary-button" onClick={() => setEntry('choice')}>返回</button></form></main>;
  const joining = Boolean(code);
  const solo = !joining && entry === 'solo';
  return <main className="narrow-page expedition-page"><div className="hero"><span className="eyebrow">1A2B / ONLINE PK</span><h1>{joining ? '選好角色，加入挑戰。' : solo ? '開始單人挑戰。' : '建立你的挑戰房間。'}</h1><p>{joining && inviteToken ? '這是免密碼邀請連結，輸入暱稱並選好角色即可加入。' : solo ? '自己練習猜數字，答案仍由伺服器保密產生。' : '選一位探險家，分享房間網址，展開你的 1A2B 對決。'}</p></div><form className="panel room-form" onSubmit={joining ? join : create}>
    <Field label="暱稱" note={nameError && <span className="field-error">暱稱重複</span>}><input required maxLength="20" value={form.nickname} onChange={(event) => { setForm({ ...form, nickname: event.target.value }); setNameError(''); }} /></Field>
    {!solo && (!joining || !inviteToken) && <Field label="房間密碼"><input required type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></Field>}
    <AvatarPicker selected={form.avatar} onSelect={(avatar) => setForm({ ...form, avatar })} />
    {!joining && <Field label="猜測數字位數"><select value={form.digits} onChange={(event) => setForm({ ...form, digits: Number(event.target.value) })}>{[4, 5, 6, 7].map((number) => <option key={number} value={number}>{number} 位數</option>)}</select></Field>}
    {!joining && !solo && <><Field label="房間名稱（可留空）"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field><div className="form-pair"><Field label="玩家上限（含電腦）"><select value={form.maxPlayers} onChange={(event) => setForm({ ...form, maxPlayers: Number(event.target.value), botCount: Math.min(form.botCount, Number(event.target.value) - 1) })}>{[2,3,4,5,6,7,8,9,10].map((number) => <option key={number}>{number}</option>)}</select></Field><Field label="結束方式"><select value={form.mode} onChange={(event) => setForm({ ...form, mode: event.target.value })}><option value="first">第一位猜中立即結束</option><option value="all">全部玩家完成</option></select></Field></div><div className="form-pair"><Field label="電腦人數"><select value={form.botCount} onChange={(event) => setForm({ ...form, botCount: Number(event.target.value) })}>{Array.from({ length: form.maxPlayers }, (_, number) => <option key={number} value={number}>{number} 位</option>)}</select></Field>{form.botCount > 0 && <Field label="電腦難度"><select value={form.botDifficulty} onChange={(event) => setForm({ ...form, botDifficulty: event.target.value })}><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></Field>}</div><Field label="玩法"><select value={form.playStyle} onChange={(event) => setForm({ ...form, playStyle: event.target.value })}><option value="race">競速 · 自由猜測</option><option value="traditional">傳統 · 同步回合</option></select></Field>{form.playStyle === 'traditional' && <Field label="每輪猜測時間"><select value={form.turnSeconds} onChange={(event) => setForm({ ...form, turnSeconds: Number(event.target.value) })}><option value="15">15 秒</option><option value="20">20 秒</option><option value="30">30 秒</option><option value="60">1 分鐘</option></select></Field>}<label className="check-field"><input type="checkbox" checked={form.allowMidJoin} onChange={(event) => setForm({ ...form, allowMidJoin: event.target.checked })} /><span><strong>允許中途加入</strong><small>傳統玩法的新玩家從下一輪開始；競速玩法可立即開始。</small></span></label></>}
    {error && <p className="error" role="alert">{error}</p>}{submitting && <p className="submit-status" role="status">正在連線，免費伺服器喚醒時可能需要約 1 分鐘…</p>}<button disabled={submitting} className="room-submit">{submitting ? '正在建立連線…' : joining ? '加入等待室 →' : solo ? '開始單人遊戲 →' : '建立房間 →'}</button>{!joining && <button type="button" className="secondary-button" onClick={() => setEntry('choice')}>返回選擇</button>}
  </form></main>;
}
