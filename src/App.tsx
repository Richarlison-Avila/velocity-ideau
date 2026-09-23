import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { carById, DEFAULT_CAR, toCarId, type CarId } from './game/cars'
import { carImageUrl } from './game/carSprites'
import { DEFAULT_COUNTDOWN_MS } from './game/countdown'
import { GhostTracker, type GhostSnapshot } from './game/ghost'
import RaceCanvas, { type RaceResult } from './game/RaceCanvas'
import { DIFFICULTIES, DIFFICULTY_LABELS, DIFFICULTY_NOTES, type Difficulty } from './game/rules'
import { formatTime } from './game/track'
import { serverClock, type ClockState } from './multiplayer/clock'
import { identificadorDoPiloto } from './multiplayer/identity'
import Lobby from './multiplayer/Lobby'
import { socket } from './multiplayer/socket'
import PilotSelect from './PilotSelect'
import type {
  LobbyRoom,
  RaceCancelled,
  RaceOutcome,
  RivalTelemetry,
  RoomResponse,
  ScheduledRace,
} from './multiplayer/types'

type Screen = 'menu' | 'garage' | 'lobby' | 'race' | 'result'
type RaceSetup = {
  startAt: number
  countdownMs: number
  trackSeed: number
  difficulty: Difficulty
  mode: 'solo' | 'online'
}
type Connection = 'connected' | 'reconnecting'

const storedPlayerId = identificadorDoPiloto(sessionStorage, globalThis.crypto)

// Uma atualização acidental da página não pode custar a vaga na sala.
const ROOM_KEY = 'ghost-racer-room'
const NAME_KEY = 'ghost-racer-name'

/** A navegação privada pode recusar o armazenamento; o jogo segue sem ele. */
function lerGuardado(chave: string) {
  try {
    return sessionStorage.getItem(chave)
  } catch {
    return null
  }
}

function guardar(chave: string, valor: string) {
  try {
    sessionStorage.setItem(chave, valor)
  } catch {
    // Sem armazenamento, só se perde a recuperação após recarregar a página.
  }
}

function esquecer(chave: string) {
  try {
    sessionStorage.removeItem(chave)
  } catch {
    // Nada a fazer.
  }
}

const storedRoom = lerGuardado(ROOM_KEY)
const storedName = lerGuardado(NAME_KEY) ?? 'Piloto'

/**
 * O carro, ao contrário da sala e do nome, fica guardado entre visitas: é uma
 * preferência do piloto, não da partida. O que vier do armazenamento passa
 * pela mesma validação do servidor — um id que saiu da garagem vira o padrão.
 */
const CAR_KEY = 'ghost-racer-car'

function lerCarro(): CarId {
  try {
    return toCarId(localStorage.getItem(CAR_KEY))
  } catch {
    return DEFAULT_CAR
  }
}

function guardarCarro(car: CarId) {
  try {
    localStorage.setItem(CAR_KEY, car)
  } catch {
    // Sem armazenamento a escolha vale só até recarregar a página.
  }
}

const storedCar = lerCarro()

/** A cor do carro vira variável de CSS para bordas e destaques. */
const destaque = (car: CarId) => ({ '--accent': carById(car).accent }) as CSSProperties

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
  const [outcome, setOutcome] = useState<RaceOutcome | null>(null)
  const [connection, setConnection] = useState<Connection>(socket.connected ? 'connected' : 'reconnecting')
  const [clock, setClock] = useState<ClockState>(serverClock.snapshot)
  /** Dificuldade do modo treino. Na corrida online quem manda é a sala. */
  const [soloDifficulty, setSoloDifficulty] = useState<Difficulty>('normal')
  const [car, setCar] = useState<CarId>(storedCar)
  /** De onde se chegou à garagem, que é para onde ela devolve. */
  const [garageFrom, setGarageFrom] = useState<'menu' | 'lobby'>('menu')

  // Refs para o ciclo do socket, que não deve depender do estado da tela.
  const ghostsRef = useRef(new Map<string, GhostTracker>())
  const roomCodeRef = useRef<string | null>(storedRoom)
  const pilotNameRef = useRef(pilotName)
  const carRef = useRef(car)
  const screenRef = useRef(screen)
  pilotNameRef.current = pilotName
  carRef.current = car
  screenRef.current = screen

  useEffect(() => serverClock.subscribe(setClock), [])

  useEffect(() => {
    const onConnect = () => {
      setConnection('connected')
      void serverClock.sync(socket)
      // Depois de uma queda, volta para a mesma sala com o mesmo identificador.
      const code = roomCodeRef.current
      if (!code) return
      const payload = { code, name: pilotNameRef.current, playerId: storedPlayerId, car: carRef.current }
      socket.emit('room:join', payload, (response: RoomResponse) => {
        if (response.ok && response.room) {
          setRoom(response.room)
          setLobbyError('')
          // Depois de recarregar a página o piloto volta direto para a sala.
          if (screenRef.current === 'menu') setScreen('lobby')
          return
        }
        roomCodeRef.current = null
        esquecer(ROOM_KEY)
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

    // Cada adversário tem seu próprio buffer contra atraso e pacotes fora de ordem.
    const onRival = (payload: RivalTelemetry) => {
      let tracker = ghostsRef.current.get(payload.playerId)
      if (!tracker) {
        tracker = new GhostTracker()
        ghostsRef.current.set(payload.playerId, tracker)
      }
      tracker.push(payload)
    }

    // O anfitrião tirou este piloto do grid: volta ao menu dizendo por quê.
    const onKicked = (payload: { code: string }) => {
      if (roomCodeRef.current !== payload.code) return
      roomCodeRef.current = null
      esquecer(ROOM_KEY)
      setRoom(null)
      setRaceSetup(null)
      setLobbyNotice('')
      setScreen('menu')
      setLobbyError('O anfitrião tirou você da sala.')
      history.replaceState(null, '', location.pathname)
    }

    // Resultado oficial: o mesmo objeto chega nas duas telas.
    const onResult = (payload: RaceOutcome) => {
      setOutcome(payload)
      setScreen('result')
    }

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('room:update', onRoomUpdate)
    socket.on('race:scheduled', onScheduled)
    socket.on('race:cancelled', onCancelled)
    socket.on('race:rival', onRival)
    socket.on('race:result', onResult)
    socket.on('room:kicked', onKicked)
    if (socket.connected) onConnect()

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('room:update', onRoomUpdate)
      socket.off('race:scheduled', onScheduled)
      socket.off('race:cancelled', onCancelled)
      socket.off('race:rival', onRival)
      socket.off('race:result', onResult)
      socket.off('room:kicked', onKicked)
    }
  }, [])

  // A largada é disparada pelo estado oficial da sala, igual nos dois dispositivos.
  useEffect(() => {
    if (!room?.startAt) return
    if (room.status !== 'countdown' && room.status !== 'racing') return
    setRaceSetup((current) => {
      if (current?.startAt === room.startAt && current.mode === 'online') return current
      // Cada largada começa com todos os fantasmas zerados.
      ghostsRef.current.clear()
      // O traçado vem da sala: é o servidor que decide, e o mesmo número chega
      // a todos os pilotos antes da contagem começar.
      return {
        startAt: room.startAt!,
        countdownMs: room.countdownMs,
        trackSeed: room.trackSeed,
        difficulty: room.difficulty,
        mode: 'online',
      }
    })
    setLobbyNotice('')
    setResult(null)
    setOutcome(null)
    // Quem estava na garagem, vindo do lobby, também vai para a largada: a
    // confirmação dele continua valendo enquanto escolhe.
    setScreen((current) => (current === 'result' || current === 'lobby' || current === 'garage' ? 'race' : current))
  }, [room?.startAt, room?.status, room?.countdownMs])

  const selectedName = () => {
    const name = draftName.trim().slice(0, 16) || pilotName
    setPilotName(name)
    pilotNameRef.current = name
    guardar(NAME_KEY, name)
    return name
  }

  const openRoom = (nextRoom: LobbyRoom) => {
    roomCodeRef.current = nextRoom.code
    guardar(ROOM_KEY, nextRoom.code)
    setRoom(nextRoom)
    setLobbyError('')
    setLobbyNotice('')
    setScreen('lobby')
    history.replaceState(null, '', `?room=${nextRoom.code}`)
  }

  const createRoom = () => {
    socket.emit('room:create', { name: selectedName(), playerId: storedPlayerId, car }, (response: RoomResponse) => {
      if (response.ok && response.room) openRoom(response.room)
      else setLobbyError(response.error ?? 'Não foi possível criar a sala.')
    })
  }

  const enterRoom = () => {
    const code = joinCode.trim().toUpperCase()
    if (!code) return setLobbyError('Digite o código da sala.')
    socket.emit('room:join', { code, name: selectedName(), playerId: storedPlayerId, car }, (response: RoomResponse) => {
      if (response.ok && response.room) openRoom(response.room)
      else setLobbyError(response.error ?? 'Não foi possível entrar na sala.')
    })
  }

  const openGarage = (from: 'menu' | 'lobby') => {
    setGarageFrom(from)
    setScreen('garage')
  }

  const leaveGarage = useCallback(() => {
    setScreen(garageFrom === 'lobby' && roomCodeRef.current ? 'lobby' : 'menu')
  }, [garageFrom])

  const chooseCar = useCallback(
    (next: CarId) => {
      setCar(next)
      carRef.current = next
      guardarCarro(next)
      // Na sala, o servidor precisa saber: é com este carro que os rivais vão
      // desenhar o fantasma.
      const code = roomCodeRef.current
      if (garageFrom === 'lobby' && code) {
        socket.emit('room:set-car', { code, playerId: storedPlayerId, car: next }, (response: RoomResponse) => {
          if (response.ok && response.room) setRoom(response.room)
          else setLobbyNotice(response.error ?? 'Não foi possível trocar o carro.')
        })
      }
      leaveGarage()
    },
    [garageFrom, leaveGarage],
  )

  const startSoloRace = () => {
    selectedName()
    setResult(null)
    // No treino não há com quem sincronizar: cada volta estreia um traçado.
    setRaceSetup({
      startAt: Date.now() + DEFAULT_COUNTDOWN_MS,
      countdownMs: DEFAULT_COUNTDOWN_MS,
      trackSeed: Math.floor(Math.random() * 0xffffffff),
      difficulty: soloDifficulty,
      mode: 'solo',
    })
    setRaceKey((value) => value + 1)
    setScreen('race')
  }

  const leaveLobby = () => {
    roomCodeRef.current = null
    esquecer(ROOM_KEY)
    setRoom(null)
    setRaceSetup(null)
    setLobbyNotice('')
    setScreen('menu')
    history.replaceState(null, '', location.pathname)
  }

  const backToLobby = () => {
    setResult(null)
    setOutcome(null)
    setRaceSetup(null)
    if (room) socket.emit('room:set-ready', { code: room.code, playerId: storedPlayerId, ready: false })
    setScreen(room ? 'lobby' : 'menu')
  }

  const askRematch = () => {
    if (room) socket.emit('race:rematch', { code: room.code, playerId: storedPlayerId })
  }

  const abandonRace = () => {
    if (!room) return
    // Em grids maiores os demais continuam correndo. Esta tela passa a esperar
    // o resultado oficial sem manter o carro abandonado em movimento.
    setResult({ time: 0, topSpeed: 0, collisions: 0, lateStart: 0 })
    setScreen('result')
    socket.emit('race:abandon', { code: room.code, playerId: storedPlayerId })
  }

  const finishRace = useCallback((raceResult: RaceResult) => {
    setResult(raceResult)
    // Na corrida online, quem decide as posições é o servidor: aqui só avisamos
    // a chegada e esperamos o resultado oficial chegar a todas as telas.
    const code = roomCodeRef.current
    if (code && socket.connected) {
      socket.emit('race:finish', {
        code,
        playerId: storedPlayerId,
        time: raceResult.time,
        topSpeed: raceResult.topSpeed,
        collisions: raceResult.collisions,
      })
    }
    setScreen('result')
  }, [])

  const sendTelemetry = useCallback((snapshot: GhostSnapshot) => {
    const code = roomCodeRef.current
    if (!code || !socket.connected) return
    socket.emit('race:telemetry', { code, playerId: storedPlayerId, ...snapshot })
  }, [])

  const connectionNotice =
    connection === 'reconnecting' ? 'CONEXÃO INSTÁVEL — RECONECTANDO' : null

  if (screen === 'garage') {
    const rivalCars = garageFrom === 'lobby'
      ? room?.players.filter((player) => player.id !== storedPlayerId).map((player) => player.car) ?? []
      : []
    return (
      <PilotSelect
        selected={car}
        rivalCars={rivalCars}
        backLabel={garageFrom === 'lobby' ? 'VOLTAR AO LOBBY' : 'VOLTAR AO PADDOCK'}
        onConfirm={chooseCar}
        onBack={leaveGarage}
      />
    )
  }

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
        onChangeCar={() => openGarage('lobby')}
      />
    )
  }

  if (screen === 'race' && raceSetup) {
    const online = raceSetup.mode === 'online'
    const me = room?.players.find((player) => player.id === storedPlayerId)
    const rivals = online
      ? (room?.players ?? []).filter((player) => player.id !== storedPlayerId).map((player) => {
          let ghost = ghostsRef.current.get(player.id)
          if (!ghost) {
            ghost = new GhostTracker()
            ghostsRef.current.set(player.id, ghost)
          }
          return { ...player, ghost }
        })
      : []
    return (
      <RaceCanvas
        key={`${raceSetup.mode}-${raceSetup.startAt}-${raceSetup.difficulty}-${raceKey}`}
        pilotName={pilotName}
        // Online vale o carro que o servidor registrou: é o mesmo que os rivais veem.
        car={online ? (me?.car ?? car) : car}
        rivals={rivals}
        startAt={raceSetup.startAt}
        countdownMs={raceSetup.countdownMs}
        trackSeed={raceSetup.trackSeed}
        difficulty={raceSetup.difficulty}
        now={online ? serverClock.now : undefined}
        mode={raceSetup.mode}
        connectionNotice={online ? connectionNotice : null}
        onTelemetry={online ? sendTelemetry : undefined}
        onAbandon={online ? abandonRace : undefined}
        onFinish={finishRace}
      />
    )
  }

  if (screen === 'result' && (result || outcome)) {
    const online = Boolean(room)
    const me = outcome?.entries.find((entry) => entry.playerId === storedPlayerId)
    const venci = Boolean(outcome && outcome.winnerId === storedPlayerId)
    const pedidoFeito = room?.players.find((player) => player.id === storedPlayerId)?.rematch ?? false
    const outros = room?.players.filter((player) => player.id !== storedPlayerId) ?? []
    const pedidosDeRevanche = outros.filter((player) => player.rematch).length
    const gridConectado = (room?.players.length ?? 0) >= 2 && room!.players.every((player) => player.connected)
    const minhaPosicao = outcome ? outcome.entries.findIndex((entry) => entry.playerId === storedPlayerId) + 1 : 0
    const aindaCorrendo = room?.players.filter((player) => !player.finished).length ?? 0

    const manchete = !online
      ? 'Prova concluída.'
      : !outcome
        ? 'Chegada registrada.'
        : me?.outcome === 'abandoned'
          ? 'Você abandonou.'
          : venci
            ? 'Vitória.'
            : outcome.winnerId
              ? 'Derrota.'
              : 'Prova encerrada.'

    return (
      <main className="screen result-screen">
        <div className="ambient-grid" />
        <section className="result-card">
          <p className="eyebrow">BANDEIRA QUADRICULADA</p>
          <div className={`result-mark ${venci ? 'winner' : ''}`}>
            {online && outcome ? String(minhaPosicao).padStart(2, '0') : '01'}
          </div>
          <h1>{manchete}</h1>
          <p className="result-pilot">{pilotName}</p>

          {online && outcome ? (
            <>
              <div className="scoreboard">
                {outcome.entries.map((entry, posicao) => {
                  // Quem já deixou a sala não tem mais carro registrado.
                  const carro = room?.players.find((player) => player.id === entry.playerId)?.car
                  return (
                    <div
                      key={entry.playerId}
                      className={`score-row ${entry.playerId === storedPlayerId ? 'me' : ''} ${
                        entry.playerId === outcome.winnerId ? 'winner' : ''
                      }`}
                    >
                      <b>P{posicao + 1}</b>
                      {carro ? <img className="score-car" src={carImageUrl(carro)} alt="" /> : <span />}
                      <strong>{entry.name}</strong>
                      <i>
                        {entry.outcome === 'finished' && entry.time !== null
                          ? formatTime(entry.time)
                          : entry.outcome === 'abandoned'
                            ? 'ABANDONOU'
                            : 'NÃO COMPLETOU'}
                      </i>
                    </div>
                  )
                })}
              </div>
              <p className="result-note">
                {outcome.gap !== null
                  ? `DIFERENÇA DE ${outcome.gap.toFixed(3).replace('.', ',')} S · RESULTADO CONFERIDO PELO SERVIDOR`
                  : 'RESULTADO CONFERIDO PELO SERVIDOR'}
              </p>
              {me && me.outcome === 'finished' && (
                <div className="result-stats">
                  <div><span>SEU TEMPO</span><strong>{formatTime(me.time ?? 0)}</strong></div>
                  <div><span>VELOCIDADE MÁX.</span><strong>{Math.round(me.topSpeed)} <small>KM/H</small></strong></div>
                  <div><span>IMPACTOS</span><strong>{me.collisions}</strong></div>
                </div>
              )}
            </>
          ) : online ? (
            <p className="result-note waiting">
              AGUARDANDO {aindaCorrendo} {aindaCorrendo === 1 ? 'PILOTO' : 'PILOTOS'} CONCLUIR A PROVA…
            </p>
          ) : (
            <div className="result-stats">
              <div><span>TEMPO TOTAL</span><strong>{formatTime(result!.time)}</strong></div>
              <div><span>VELOCIDADE MÁX.</span><strong>{Math.round(result!.topSpeed)} <small>KM/H</small></strong></div>
              <div><span>IMPACTOS</span><strong>{result!.collisions}</strong></div>
            </div>
          )}

          {result && result.lateStart > 0.4 && (
            <p className="result-note">LARGADA PERDIDA POR {result.lateStart.toFixed(1)} S NESTE DISPOSITIVO</p>
          )}

          {online && outcome ? (
            gridConectado ? (
              <>
                <button className="primary-button" disabled={pedidoFeito} onClick={askRematch}>
                  {pedidoFeito ? 'AGUARDANDO OS DEMAIS' : 'REVANCHE'} <span>↗</span>
                </button>
                {pedidosDeRevanche > 0 && !pedidoFeito && (
                  <p className="result-note rematch">{pedidosDeRevanche} DE {outros.length} RIVAIS JÁ PEDIRAM REVANCHE</p>
                )}
              </>
            ) : (
              <p className="result-note waiting">O GRID ESTÁ INCOMPLETO — VOLTE AO LOBBY PARA REORGANIZAR A SALA</p>
            )
          ) : online ? null : (
            <button className="primary-button" onClick={startSoloRace}>CORRER NOVAMENTE <span>↗</span></button>
          )}

          {(!online || outcome) && (
            <button className="text-button" onClick={online ? backToLobby : () => { setRaceSetup(null); setScreen('menu') }}>
              {online ? 'VOLTAR AO LOBBY' : 'VOLTAR AO PADDOCK'}
            </button>
          )}
        </section>
      </main>
    )
  }

  return (
    <main className="screen menu-screen">
      <div className="ambient-grid" />
      <header className="site-header">
        <div className="logo"><i /><span>CORRIDA<br /><b>FANTASMA</b></span></div>
        <div className="header-meta">
          <div className="institutional-mark">
            <img src="/iedau.jpeg" alt="Faculdades IDEAU" />
            <span>PROJETO<br />ACADÊMICO</span>
          </div>
          <span className="build-tag">PROTÓTIPO // 002</span>
        </div>
      </header>

      <div className="menu-content">
        <section className="menu-hero">
          <div className="hero-heading">
            <p className="eyebrow">CORRIDA MULTIPLAYER EM TEMPO REAL</p>
            <h1>DOMINE O<br /><em>ASFALTO.</em></h1>
            <p className="hero-copy">Uma volta decisiva, largada sincronizada e até seis pilotos disputando o mesmo traçado.</p>
          </div>

          <button type="button" className="hero-car" style={destaque(car)} onClick={() => openGarage('menu')}>
            <span className="hero-car-number" aria-hidden="true">{carById(car).number}</span>
            <img src={carImageUrl(car)} alt={`Carro de ${carById(car).driver}`} />
            <span className="hero-car-caption">
              <small>PILOTO SELECIONADO</small>
              <strong>{carById(car).driver}</strong>
              <em>{carById(car).team} · #{carById(car).number}</em>
            </span>
            <span className="hero-car-action">TROCAR <b>↗</b></span>
          </button>

          <dl className="race-facts">
            <div><dt>FORMATO</dt><dd>1 VOLTA</dd></div>
            <div><dt>GRID</dt><dd>2—6 PILOTOS</dd></div>
            <div><dt>SINCRONIA</dt><dd>{clock.synced ? `±${Math.round(clock.roundTrip / 2)} MS` : 'CONECTANDO'}</dd></div>
          </dl>
        </section>

        <section className="start-panel" aria-labelledby="start-title">
          <header className="start-panel-header">
            <span className="panel-step">01</span>
            <div>
              <p className="eyebrow">PREPARE-SE PARA A LARGADA</p>
              <h2 id="start-title">ENTRE NA PISTA</h2>
            </div>
            <span className={`server-status ${connection === 'connected' ? 'online' : ''}`}>
              <i /> {connection === 'connected' ? 'SERVIDOR ONLINE' : 'CONECTANDO'}
            </span>
          </header>

          <div className="identity-field">
            <label htmlFor="pilot-name">NOME DO PILOTO</label>
            <input id="pilot-name" value={draftName} maxLength={16} onChange={(event) => setDraftName(event.target.value)} placeholder={pilotName} autoComplete="nickname" />
          </div>

          {connection !== 'connected' && <p className="form-notice">PROCURANDO O SERVIDOR DA PARTIDA…</p>}
          {lobbyError && <p className="form-error">{lobbyError}</p>}

          <div className="mode-list">
            <section className="mode-card online-mode">
              <header className="mode-heading">
                <span>01</span>
                <div>
                  <p>ATÉ SEIS PILOTOS</p>
                  <h3>CORRIDA ONLINE</h3>
                </div>
              </header>
              <p className="mode-copy">Crie um grid e envie o convite, ou use o código de uma sala existente.</p>
              <button className="primary-button create-room-button" onClick={createRoom} disabled={connection !== 'connected'}>
                CRIAR NOVA SALA <span>↗</span>
              </button>
              <div className="join-divider"><span>JÁ TEM UM CÓDIGO?</span></div>
              <div className="join-control">
                <input value={joinCode} maxLength={5} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} placeholder="ABCDE" aria-label="Código da sala" />
                <button onClick={enterRoom} disabled={connection !== 'connected'}>ENTRAR <span>↗</span></button>
              </div>
            </section>

            <section className="mode-card training-mode">
              <header className="mode-heading">
                <span>02</span>
                <div>
                  <p>SEM SALA · SEM ESPERA</p>
                  <h3>TREINO SOLO</h3>
                </div>
              </header>
              <p className="mode-copy">Conheça a pista, ajuste o ritmo e prepare-se para disputar o grid.</p>
              <fieldset className="difficulty-picker">
                <legend>NÍVEL DO TREINO</legend>
                {DIFFICULTIES.map((nivel) => (
                  <button
                    key={nivel}
                    type="button"
                    className={soloDifficulty === nivel ? 'on' : ''}
                    aria-pressed={soloDifficulty === nivel}
                    onClick={() => setSoloDifficulty(nivel)}
                  >
                    {DIFFICULTY_LABELS[nivel]}
                  </button>
                ))}
              </fieldset>
              <p className="difficulty-note">{DIFFICULTY_NOTES[soloDifficulty]}</p>
              <button className="solo-button" onClick={startSoloRace}>INICIAR TREINO <span>↗</span></button>
            </section>
          </div>
        </section>
      </div>

      <footer className="menu-footer">
        <span>LARGADA SINCRONIZADA · FANTASMAS EM TEMPO REAL</span>
        <span className="developer-credit">Desenvolvido por: <strong>Richarlison Ávila e Rafael Severo</strong></span>
      </footer>
    </main>
  )
}

export default App
