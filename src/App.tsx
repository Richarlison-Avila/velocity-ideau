import { useCallback, useEffect, useState } from 'react'
import RaceCanvas, { type RaceResult } from './game/RaceCanvas'
import { formatTime } from './game/track'
import Lobby from './multiplayer/Lobby'
import { socket } from './multiplayer/socket'
import type { LobbyRoom, RoomResponse } from './multiplayer/types'

type Screen = 'menu' | 'lobby' | 'race' | 'result'

const storedPlayerId = sessionStorage.getItem('ghost-racer-id') ?? crypto.randomUUID()
sessionStorage.setItem('ghost-racer-id', storedPlayerId)

function App() {
  const [screen, setScreen] = useState<Screen>('menu')
  const [pilotName, setPilotName] = useState('Piloto')
  const [draftName, setDraftName] = useState('')
  const [joinCode, setJoinCode] = useState(() => new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '')
  const [room, setRoom] = useState<LobbyRoom | null>(null)
  const [lobbyError, setLobbyError] = useState('')
  const [raceKey, setRaceKey] = useState(0)
  const [result, setResult] = useState<RaceResult | null>(null)

  useEffect(() => {
    const updateRoom = (nextRoom: LobbyRoom) => setRoom(nextRoom)
    socket.on('room:update', updateRoom)
    return () => { socket.off('room:update', updateRoom) }
  }, [])

  const selectedName = () => {
    const name = draftName.trim().slice(0, 16) || pilotName
    setPilotName(name)
    return name
  }

  const openRoom = (nextRoom: LobbyRoom) => {
    setRoom(nextRoom)
    setLobbyError('')
    setScreen('lobby')
    history.replaceState(null, '', `?room=${nextRoom.code}`)
  }

  const createRoom = () => {
    socket.emit('room:create', { name: selectedName(), playerId: storedPlayerId }, (response: RoomResponse) => {
      if (response.ok && response.room) openRoom(response.room)
      else setLobbyError(response.error ?? 'Não foi possível criar a sala.')
    })
  }

  const enterRoom = () => {
    const code = joinCode.trim().toUpperCase()
    if (!code) return setLobbyError('Digite o código da sala.')
    socket.emit('room:join', { code, name: selectedName(), playerId: storedPlayerId }, (response: RoomResponse) => {
      if (response.ok && response.room) openRoom(response.room)
      else setLobbyError(response.error ?? 'Não foi possível entrar na sala.')
    })
  }

  const startRace = () => {
    selectedName()
    setResult(null)
    setRaceKey((value) => value + 1)
    setScreen('race')
  }

  const leaveLobby = () => {
    setRoom(null)
    setScreen('menu')
    history.replaceState(null, '', location.pathname)
  }

  const finishRace = useCallback((raceResult: RaceResult) => {
    setResult(raceResult)
    setScreen('result')
  }, [])

  if (screen === 'lobby' && room) {
    return <Lobby room={room} playerId={storedPlayerId} onRoomChange={setRoom} onLeave={leaveLobby} onError={setLobbyError} />
  }

  if (screen === 'race') {
    return <RaceCanvas key={raceKey} pilotName={pilotName} onFinish={finishRace} />
  }

  if (screen === 'result' && result) {
    return (
      <main className="screen result-screen">
        <div className="ambient-grid" />
        <section className="result-card">
          <p className="eyebrow">BANDEIRA QUADRICULADA</p>
          <div className="result-mark">01</div>
          <h1>Prova concluída.</h1>
          <p className="result-pilot">{pilotName}</p>
          <div className="result-stats">
            <div><span>TEMPO TOTAL</span><strong>{formatTime(result.time)}</strong></div>
            <div><span>VELOCIDADE MÁX.</span><strong>{Math.round(result.topSpeed)} <small>KM/H</small></strong></div>
            <div><span>IMPACTOS</span><strong>{result.collisions}</strong></div>
          </div>
          <button className="primary-button" onClick={startRace}>CORRER NOVAMENTE <span>↗</span></button>
          <button className="text-button" onClick={() => setScreen('menu')}>VOLTAR AO PADDOCK</button>
        </section>
      </main>
    )
  }

  return (
    <main className="screen menu-screen">
      <div className="ambient-grid" />
      <header className="site-header">
        <div className="logo"><i /><span>CORRIDA<br /><b>FANTASMA</b></span></div>
        <span className="build-tag">PROTÓTIPO // 002</span>
      </header>

      <section className="hero">
        <p className="eyebrow">UMA VOLTA. DOIS PILOTOS. NENHUMA DESCULPA.</p>
        <h1>DOMINE<br />O <em>ASFALTO.</em></h1>
        <p className="hero-copy">Crie uma sala e desafie outro piloto, ou entre com o código recebido. O modo treino continua disponível para correr sozinho.</p>

        <div className="start-form">
          <label htmlFor="pilot-name">NOME DO PILOTO</label>
          <input id="pilot-name" value={draftName} maxLength={16} onChange={(event) => setDraftName(event.target.value)} placeholder="Digite seu nome" autoComplete="nickname" />
          <div className="multiplayer-actions">
            <button className="primary-button" onClick={createRoom}>CRIAR SALA <span>↗</span></button>
            <div className="join-control">
              <input value={joinCode} maxLength={5} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} placeholder="CÓDIGO" aria-label="Código da sala" />
              <button onClick={enterRoom}>ENTRAR</button>
            </div>
          </div>
          {lobbyError && <p className="form-error">{lobbyError}</p>}
          <button className="solo-button" onClick={startRace}>CORRER NO MODO TREINO</button>
        </div>
      </section>

      <aside className="briefing-card">
        <span className="card-number">02</span>
        <p className="eyebrow">LOBBY ONLINE</p>
        <h2>2 PILOTOS<br />1 SALA</h2>
        <dl>
          <div><dt>CAPACIDADE</dt><dd>2 PILOTOS</dd></div>
          <div><dt>CONVITE</dt><dd>LINK, QR OU CÓDIGO</dd></div>
          <div><dt>ESTADO</dt><dd>TEMPO REAL</dd></div>
        </dl>
        <p className="brief-note">Na próxima fase, a confirmação dos dois pilotos disparará a sequência de largada sincronizada.</p>
      </aside>

      <footer className="menu-footer">
        <span>FASE 3 // LOBBY E SALAS</span>
        <span>PRÓXIMA ETAPA: LARGADA SINCRONIZADA</span>
      </footer>
    </main>
  )
}

export default App
