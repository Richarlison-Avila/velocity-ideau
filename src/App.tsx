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
  /** Dificuldade do modo treino. No duelo quem manda é a sala. */
  const [soloDifficulty, setSoloDifficulty] = useState<Difficulty>('normal')
  const [car, setCar] = useState<CarId>(storedCar)
  /** De onde se chegou à garagem, que é para onde ela devolve. */
  const [garageFrom, setGarageFrom] = useState<'menu' | 'lobby'>('menu')

  // Refs para o ciclo do socket, que não deve depender do estado da tela.
  const ghostRef = useRef(new GhostTracker())
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

    // Telemetria do adversário: o buffer trata atraso e chegada fora de ordem.
    const onRival = (payload: RivalTelemetry) => ghostRef.current.push(payload)

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
    if (socket.connected) onConnect()

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('room:update', onRoomUpdate)
      socket.off('race:scheduled', onScheduled)
      socket.off('race:cancelled', onCancelled)
      socket.off('race:rival', onRival)
      socket.off('race:result', onResult)
    }
  }, [])

  // A largada é disparada pelo estado oficial da sala, igual nos dois dispositivos.
  useEffect(() => {
    if (!room?.startAt) return
    if (room.status !== 'countdown' && room.status !== 'racing') return
    setRaceSetup((current) => {
      if (current?.startAt === room.startAt && current.mode === 'online') return current
      // Cada largada começa com o fantasma zerado.
      ghostRef.current.reset()
      // O traçado vem da sala: é o servidor que decide, e o mesmo número chega
      // aos dois pilotos antes da contagem começar.
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
      // Na sala, o servidor precisa saber: é com este carro que o rival vai
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
    if (room) socket.emit('race:abandon', { code: room.code, playerId: storedPlayerId })
  }

  const finishRace = useCallback((raceResult: RaceResult) => {
    setResult(raceResult)
    // No duelo, quem decide o vencedor é o servidor: aqui só avisamos a chegada
    // e esperamos o resultado oficial chegar às duas telas.
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
    const rival = garageFrom === 'lobby' ? room?.players.find((player) => player.id !== storedPlayerId) : undefined
    return (
      <PilotSelect
        selected={car}
        rivalCar={rival?.car ?? null}
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
    const rival = room?.players.find((player) => player.id !== storedPlayerId)
    return (
      <RaceCanvas
        key={`${raceSetup.mode}-${raceSetup.startAt}-${raceSetup.difficulty}-${raceKey}`}
        pilotName={pilotName}
        // No duelo vale o carro que o servidor registrou: é o mesmo que o rival vê.
        car={online ? (me?.car ?? car) : car}
        rivalCar={online ? (rival?.car ?? null) : null}
        startAt={raceSetup.startAt}
        countdownMs={raceSetup.countdownMs}
        trackSeed={raceSetup.trackSeed}
        difficulty={raceSetup.difficulty}
        now={online ? serverClock.now : undefined}
        mode={raceSetup.mode}
        connectionNotice={online ? connectionNotice : null}
        ghost={online ? ghostRef.current : null}
        rivalName={rival?.name ?? 'RIVAL'}
        rivalConnected={rival?.connected ?? false}
        onTelemetry={online ? sendTelemetry : undefined}
        onAbandon={online ? abandonRace : undefined}
        onFinish={finishRace}
      />
    )
  }

  if (screen === 'result' && (result || outcome)) {
    const online = Boolean(room)
    const me = outcome?.entries.find((entry) => entry.playerId === storedPlayerId)
    const rival = outcome?.entries.find((entry) => entry.playerId !== storedPlayerId)
    const venci = Boolean(outcome && outcome.winnerId === storedPlayerId)
    const pedidoFeito = room?.players.find((player) => player.id === storedPlayerId)?.rematch ?? false
    const rivalPediu = room?.players.find((player) => player.id !== storedPlayerId)?.rematch ?? false
    // Sem rival na sala não há revanche possível: a vaga precisa ser preenchida.
    const temRival = (room?.players.length ?? 0) === 2

    const manchete = !online
      ? 'Prova concluída.'
      : !outcome
        ? 'Chegada registrada.'
        : outcome.reason === 'abandon'
          ? venci ? 'Vitória por abandono.' : 'Você abandonou.'
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
          <div className={`result-mark ${venci ? 'winner' : ''}`}>{online && outcome ? (venci ? '01' : '02') : '01'}</div>
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
              AGUARDANDO {rival?.name ?? 'O RIVAL'} CRUZAR A LINHA DE CHEGADA…
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
            temRival ? (
              <>
                <button className="primary-button" disabled={pedidoFeito} onClick={askRematch}>
                  {pedidoFeito ? 'AGUARDANDO O RIVAL' : 'REVANCHE'} <span>↗</span>
                </button>
                {rivalPediu && !pedidoFeito && <p className="result-note rematch">O RIVAL JÁ PEDIU REVANCHE</p>}
              </>
            ) : (
              <p className="result-note waiting">O RIVAL DEIXOU A SALA — CHAME OUTRO PILOTO PELO LOBBY</p>
            )
          ) : online ? null : (
            <button className="primary-button" onClick={startSoloRace}>CORRER NOVAMENTE <span>↗</span></button>
          )}

          <button className="text-button" onClick={online ? backToLobby : () => { setRaceSetup(null); setScreen('menu') }}>
            {online ? 'VOLTAR AO LOBBY' : 'VOLTAR AO PADDOCK'}
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
          <button type="button" className="car-choice" style={destaque(car)} onClick={() => openGarage('menu')}>
            <img src={carImageUrl(car)} alt="" />
            <span>
              <small>SEU CARRO</small>
              <strong>{carById(car).driver}</strong>
              <em>{carById(car).team} · #{carById(car).number}</em>
            </span>
            <span className="car-choice-action">ESCOLHER PILOTO ↗</span>
          </button>
          <div className="multiplayer-actions">
            <button className="primary-button" onClick={createRoom} disabled={connection !== 'connected'}>CRIAR SALA <span>↗</span></button>
            <div className="join-control">
              <input value={joinCode} maxLength={5} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} placeholder="CÓDIGO" aria-label="Código da sala" />
              <button onClick={enterRoom} disabled={connection !== 'connected'}>ENTRAR</button>
            </div>
          </div>
          {connection !== 'connected' && <p className="form-notice">PROCURANDO O SERVIDOR DA PARTIDA…</p>}
          {lobbyError && <p className="form-error">{lobbyError}</p>}
          <fieldset className="difficulty-picker">
            <legend>DIFICULDADE</legend>
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
        <span>FASE 6 // RESULTADO E REVANCHE</span>
        <span>PRÓXIMA ETAPA: PUBLICAÇÃO</span>
      </footer>
    </main>
  )
}

export default App
