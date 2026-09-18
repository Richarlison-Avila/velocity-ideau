import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_COUNTDOWN_MS } from './game/countdown'
import RaceCanvas, { type RaceResult } from './game/RaceCanvas'
import { formatTime } from './game/track'
import { serverClock, type ClockState } from './multiplayer/clock'
import Lobby from './multiplayer/Lobby'
import { socket } from './multiplayer/socket'
import type { LobbyRoom, RaceCancelled, RoomResponse, ScheduledRace } from './multiplayer/types'

type Screen = 'menu' | 'lobby' | 'race' | 'result'
type RaceSetup = { startAt: number; countdownMs: number; mode: 'solo' | 'online' }
type Connection = 'connected' | 'reconnecting'

const storedPlayerId = sessionStorage.getItem('ghost-racer-id') ?? crypto.randomUUID()
sessionStorage.setItem('ghost-racer-id', storedPlayerId)

// Uma atualização acidental da página não pode custar a vaga na sala.
const ROOM_KEY = 'ghost-racer-room'
const NAME_KEY = 'ghost-racer-name'
const storedRoom = sessionStorage.getItem(ROOM_KEY)
const storedName = sessionStorage.getItem(NAME_KEY) ?? 'Piloto'

function App() {
  const [screen, setScreen] = useState<Screen>('menu')
  const [pilotName, setPilotName] = useState(storedName)
  const [draftName, setDraftName] = useState('')
  const [joinCode, setJoinCode] = useState(() => new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '')
  const [room, setRoom] = useState<LobbyRoom | null>(null)
  const [lobbyError, setLobbyError] = useState('')
  const [lobbyNotice, setLobbyNotice] = useState('')
  const [raceKey, setRaceKey] = useState(0)
  const [raceSetup, setRaceSetup] = useState<RaceSetup | null>(null)
  const [result, setResult] = useState<RaceResult | null>(null)
  const [connection, setConnection] = useState<Connection>(socket.connected ? 'connected' : 'reconnecting')
  const [clock, setClock] = useState<ClockState>(serverClock.snapshot)

  // Refs para o ciclo do socket, que não deve depender do estado da tela.
  const roomCodeRef = useRef<string | null>(storedRoom)
  const pilotNameRef = useRef(pilotName)
  const screenRef = useRef(screen)
  pilotNameRef.current = pilotName
  screenRef.current = screen

  useEffect(() => serverClock.subscribe(setClock), [])

  useEffect(() => {
    const onConnect = () => {
      setConnection('connected')
      void serverClock.sync(socket)
      // Depois de uma queda, volta para a mesma sala com o mesmo identificador.
      const code = roomCodeRef.current
      if (!code) return
      socket.emit('room:join', { code, name: pilotNameRef.current, playerId: storedPlayerId }, (response: RoomResponse) => {
        if (response.ok && response.room) {
          setRoom(response.room)
          setLobbyError('')
          // Depois de recarregar a página o piloto volta direto para a sala.
          if (screenRef.current === 'menu') setScreen('lobby')
          return
        }
        roomCodeRef.current = null
        sessionStorage.removeItem(ROOM_KEY)
        setRoom(null)
        setRaceSetup(null)
        setScreen('menu')
        setLobbyError(response.error ?? 'A sala não está mais disponível.')
      })
    }

    const onDisconnect = () => setConnection('reconnecting')
    const onRoomUpdate = (nextRoom: LobbyRoom) => setRoom(nextRoom)

    const onScheduled = (payload: ScheduledRace) => {
      // O horário enviado pelo servidor impede que um relógio atrasado largue tarde.
      serverClock.guard(payload.serverTime)
    }

    const onCancelled = (payload: RaceCancelled) => {
      setRaceSetup(null)
      setLobbyNotice(payload.reason)
      if (screenRef.current === 'race') setScreen('lobby')
    }

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('room:update', onRoomUpdate)
    socket.on('race:scheduled', onScheduled)
    socket.on('race:cancelled', onCancelled)
    if (socket.connected) onConnect()

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('room:update', onRoomUpdate)
      socket.off('race:scheduled', onScheduled)
      socket.off('race:cancelled', onCancelled)
    }
  }, [])

  // A largada é disparada pelo estado oficial da sala, igual nos dois dispositivos.
  useEffect(() => {
    if (!room?.startAt) return
    if (room.status !== 'countdown' && room.status !== 'racing') return
    setRaceSetup((current) => {
      if (current?.startAt === room.startAt && current.mode === 'online') return current
      return { startAt: room.startAt!, countdownMs: room.countdownMs, mode: 'online' }
    })
    setLobbyNotice('')
    setResult(null)
    setScreen((current) => (current === 'result' || current === 'lobby' ? 'race' : current))
  }, [room?.startAt, room?.status, room?.countdownMs])

  const selectedName = () => {
    const name = draftName.trim().slice(0, 16) || pilotName
    setPilotName(name)
    pilotNameRef.current = name
    sessionStorage.setItem(NAME_KEY, name)
    return name
  }

  const openRoom = (nextRoom: LobbyRoom) => {
    roomCodeRef.current = nextRoom.code
    sessionStorage.setItem(ROOM_KEY, nextRoom.code)
    setRoom(nextRoom)
    setLobbyError('')
    setLobbyNotice('')
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

  const startSoloRace = () => {
    selectedName()
    setResult(null)
    setRaceSetup({ startAt: Date.now() + DEFAULT_COUNTDOWN_MS, countdownMs: DEFAULT_COUNTDOWN_MS, mode: 'solo' })
    setRaceKey((value) => value + 1)
    setScreen('race')
  }

  const leaveLobby = () => {
    roomCodeRef.current = null
    sessionStorage.removeItem(ROOM_KEY)
    setRoom(null)
    setRaceSetup(null)
    setLobbyNotice('')
    setScreen('menu')
    history.replaceState(null, '', location.pathname)
  }

  const backToLobby = () => {
    setResult(null)
    setRaceSetup(null)
    if (room) socket.emit('room:set-ready', { code: room.code, playerId: storedPlayerId, ready: false })
    setScreen(room ? 'lobby' : 'menu')
  }

  const finishRace = useCallback((raceResult: RaceResult) => {
    setResult(raceResult)
    setScreen('result')
  }, [])

  const connectionNotice =
    connection === 'reconnecting' ? 'CONEXÃO INSTÁVEL — RECONECTANDO' : null

  if (screen === 'lobby' && room) {
    return (
      <Lobby
        room={room}
        playerId={storedPlayerId}
        clock={clock}
        connection={connection}
        notice={lobbyNotice}
        onRoomChange={setRoom}
        onLeave={leaveLobby}
        onError={setLobbyError}
      />
    )
  }

  if (screen === 'race' && raceSetup) {
    return (
      <RaceCanvas
        key={`${raceSetup.mode}-${raceSetup.startAt}-${raceKey}`}
        pilotName={pilotName}
        startAt={raceSetup.startAt}
        countdownMs={raceSetup.countdownMs}
        now={raceSetup.mode === 'online' ? serverClock.now : undefined}
        mode={raceSetup.mode}
        connectionNotice={raceSetup.mode === 'online' ? connectionNotice : null}
        onFinish={finishRace}
      />
    )
  }

  if (screen === 'result' && result) {
    const online = Boolean(room)
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
          {result.lateStart > 0.4 && (
            <p className="result-note">LARGADA PERDIDA POR {result.lateStart.toFixed(1)} S NESTE DISPOSITIVO</p>
          )}
          {online ? (
            <>
              <button className="primary-button" onClick={backToLobby}>VOLTAR AO LOBBY <span>↗</span></button>
              <p className="result-note">O RESULTADO OFICIAL COMPARADO ENTRE OS DOIS PILOTOS CHEGA NA FASE 6.</p>
            </>
          ) : (
            <button className="primary-button" onClick={startSoloRace}>CORRER NOVAMENTE <span>↗</span></button>
          )}
          <button className="text-button" onClick={() => { setRaceSetup(null); setScreen(online ? 'lobby' : 'menu') }}>
            {online ? 'VER A SALA' : 'VOLTAR AO PADDOCK'}
          </button>
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
            <button className="primary-button" onClick={createRoom} disabled={connection !== 'connected'}>CRIAR SALA <span>↗</span></button>
            <div className="join-control">
              <input value={joinCode} maxLength={5} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} placeholder="CÓDIGO" aria-label="Código da sala" />
              <button onClick={enterRoom} disabled={connection !== 'connected'}>ENTRAR</button>
            </div>
          </div>
          {connection !== 'connected' && <p className="form-notice">PROCURANDO O SERVIDOR DA PARTIDA…</p>}
          {lobbyError && <p className="form-error">{lobbyError}</p>}
          <button className="solo-button" onClick={startSoloRace}>CORRER NO MODO TREINO</button>
        </div>
      </section>

      <aside className="briefing-card">
        <span className="card-number">02</span>
        <p className="eyebrow">LARGADA SINCRONIZADA</p>
        <h2>2 PILOTOS<br />1 LARGADA</h2>
        <dl>
          <div><dt>CAPACIDADE</dt><dd>2 PILOTOS</dd></div>
          <div><dt>CONVITE</dt><dd>LINK, QR OU CÓDIGO</dd></div>
          <div><dt>RELÓGIO</dt><dd>{clock.synced ? `±${Math.round(clock.roundTrip / 2)} MS` : 'SINCRONIZANDO'}</dd></div>
        </dl>
        <p className="brief-note">O servidor marca um horário futuro comum. As cinco luzes aparecem ao mesmo tempo nos dois aparelhos e apagam no instante da largada.</p>
      </aside>

      <footer className="menu-footer">
        <span>FASE 4 // LARGADA SINCRONIZADA</span>
        <span>PRÓXIMA ETAPA: CARRO FANTASMA</span>
      </footer>
    </main>
  )
}

export default App
