// A validação da chegada precisa da mesma pista que o jogo desenha, então a
// definição vem do módulo do jogo em vez de ser copiada para cá.
import { rulesFor, toDifficulty, type Difficulty } from '../src/game/rules.js'
import { speedForState } from '../src/game/simulation.js'
import { LATERAL_LIMIT, TRACK_LENGTH } from '../src/game/track.js'

export type RoomStatus = 'waiting' | 'ready' | 'countdown' | 'racing' | 'finished'

export type PublicPlayer = {
  id: string
  name: string
  ready: boolean
  connected: boolean
  /** Já cruzou a linha de chegada nesta corrida. */
  finished: boolean
  /** Já pediu revanche. */
  rematch: boolean
}

export type PublicRoom = {
  code: string
  players: PublicPlayer[]
  status: RoomStatus
  /** Instante oficial da largada, no relógio do servidor. */
  startAt: number | null
  /** Duração total da sequência de luzes, usada pelos clientes. */
  countdownMs: number
  /**
   * Semente oficial do traçado desta corrida.
   *
   * A curva e o cenário são gerados a partir dela, então os dois pilotos
   * precisam receber exatamente o mesmo número — senão cada um correria em uma
   * pista diferente. Quem manda é o servidor: o cliente nunca sorteia.
   */
  trackSeed: number
  /**
   * Dificuldade oficial da sala.
   *
   * Vale para os dois pilotos e decide a física da prova, então é estado do
   * servidor como o horário da largada. Um cliente que simulasse com regras
   * próprias estaria correndo outra corrida.
   */
  difficulty: Difficulty
  /**
   * Quem criou a sala e decide a dificuldade.
   *
   * Vai para os clientes porque a interface precisa saber de quem é a
   * escolha — mostrar um seletor a quem não manda nele seria mentir.
   */
  hostId: string | null
}

export type RivalState = 'racing' | 'finished'

export type Telemetry = {
  /** Instante da medição, no relógio do servidor. */
  t: number
  progress: number
  lateral: number
  speed: number
  state: RivalState
}

type Player = {
  id: string
  name: string
  ready: boolean
  socketId: string
  disconnectedAt: number | null
  telemetry: Telemetry | null
  finish: FinishEntry | null
  rematch: boolean
}

type RaceState = 'idle' | 'countdown' | 'racing' | 'finished'

type Room = {
  code: string
  players: Player[]
  createdAt: number
  state: RaceState
  startAt: number | null
  /** Semente do traçado desta corrida, renovada a cada nova largada. */
  trackSeed: number
  /** Dificuldade escolhida no lobby, congelada quando a contagem começa. */
  difficulty: Difficulty
  /** Quem criou a sala. Passa adiante se ele sair. */
  hostId: string | null
  /** Resultado oficial da última corrida, idêntico para os dois pilotos. */
  outcome: RaceOutcome | null
}

export type RoomUpdate = {
  code: string
  room: PublicRoom | null
  /** Indica que a saída interrompeu uma contagem já agendada. */
  cancelledCountdown: boolean
}

export class RoomError extends Error {
  constructor(public code: 'ROOM_NOT_FOUND' | 'ROOM_FULL' | 'NOT_IN_ROOM' | 'NOT_HOST', message: string) {
    super(message)
  }
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Tempo entre o agendamento e a largada: 900 ms de preparo mais cinco luzes de 900 ms. */
export const COUNTDOWN_MS = 5_400

/** Janela para o piloto voltar depois de uma queda de conexão. */
export const RECONNECT_GRACE_MS = 12_000

/** Teto de velocidade aceito na telemetria: acima disso o avanço é impossível. */
export const MAX_PLAUSIBLE_SPEED_MS = 120
/** Folga em metros para não punir variação normal de rede. */
export const PROGRESS_TOLERANCE_M = 8
// O limite lateral é geometria da pista: vem do mesmo lugar que o jogo desenha,
// para o servidor não recortar uma faixa diferente da que o piloto enxerga.
export { LATERAL_LIMIT } from '../src/game/track.js'
/** Diferença máxima aceita entre o horário da medição e o do servidor. */
export const CLOCK_TOLERANCE_MS = 5_000

/**
 * Tempo mínimo fisicamente possível para a prova, por dificuldade: a pista
 * inteira na velocidade máxima daquele nível. Qualquer chegada mais rápida é
 * impossível.
 *
 * Precisa ser por dificuldade, e não um número só. Com o teto do nível mais
 * rápido, uma chegada impossível no normal passaria; com o teto do mais
 * lento, uma chegada legítima no profissional seria recusada.
 */
export function minRaceSeconds(difficulty: Difficulty) {
  return TRACK_LENGTH / (speedForState(false, 0, true, rulesFor(difficulty)) / 3.6)
}

/** Tempo mínimo do nível de referência, mantido para quem não passa a sala. */
export const MIN_RACE_SECONDS = minRaceSeconds('normal')

/** Folga para a viagem do aviso de chegada até o servidor. */
export const FINISH_TOLERANCE_SECONDS = 2

export type FinishOutcome = 'finished' | 'abandoned' | 'unfinished'

export type FinishEntry = {
  playerId: string
  name: string
  /** Tempo de prova em segundos, ou null para quem não completou. */
  time: number | null
  topSpeed: number
  collisions: number
  outcome: FinishOutcome
}

export type RaceOutcome = {
  code: string
  /** Quem venceu, ou null se ninguém completou. */
  winnerId: string | null
  /** Como a corrida foi decidida. */
  reason: 'time' | 'abandon'
  /** Diferença entre primeiro e segundo, em segundos, quando os dois completaram. */
  gap: number | null
  /** Ordenado: vencedor primeiro. */
  entries: FinishEntry[]
}

export type FinishReport = {
  time: number
  topSpeed: number
  collisions: number
}

export type RoomStoreOptions = {
  now?: () => number
  countdownMs?: number
  /**
   * Códigos que se criam sozinhos quando alguém entra.
   *
   * No workshop a sala de demonstração precisa existir antes de o
   * apresentador abrir o jogo, para o QR code do slide sempre funcionar.
   */
  openRooms?: string[]
  /** Sorteio da semente do traçado. Os testes injetam uma sequência previsível. */
  nextSeed?: () => number
}

export class RoomStore {
  private rooms = new Map<string, Room>()
  private now: () => number
  private countdownMs: number
  private openRooms: Set<string>
  private nextSeed: () => number

  constructor(options: RoomStoreOptions = {}) {
    this.now = options.now ?? (() => Date.now())
    this.countdownMs = options.countdownMs ?? COUNTDOWN_MS
    this.openRooms = new Set((options.openRooms ?? []).map((code) => code.trim().toUpperCase()).filter(Boolean))
    this.nextSeed = options.nextSeed ?? (() => Math.floor(Math.random() * 0xffffffff))
  }

  /** Códigos que sempre aceitam entrada, mesmo sem ninguém dentro. */
  get demoRooms(): readonly string[] {
    return [...this.openRooms]
  }

  create(socketId: string, playerId: string, rawName: string) {
    const code = this.createCode()
    this.rooms.set(code, {
      code,
      createdAt: this.now(),
      state: 'idle',
      startAt: null,
      trackSeed: this.nextSeed(),
      difficulty: 'normal',
      hostId: playerId,
      outcome: null,
      players: [this.createPlayer(playerId, socketId, rawName)],
    })
    return this.get(code)!
  }

  join(codeInput: string, socketId: string, playerId: string, rawName: string) {
    const room = this.ensureOpenRoom(codeInput) ?? this.requireRoom(codeInput)

    const returning = room.players.find((player) => player.id === playerId)
    if (returning) {
      returning.socketId = socketId
      returning.disconnectedAt = null
      returning.name = this.cleanName(rawName)
      return this.toPublic(room)
    }

    if (room.players.length >= 2) throw new RoomError('ROOM_FULL', 'Esta sala já está cheia.')
    room.players.push(this.createPlayer(playerId, socketId, rawName))
    this.ensureHost(room)
    return this.toPublic(room)
  }

  setReady(codeInput: string, playerId: string, ready: boolean) {
    const room = this.requireRoom(codeInput)
    const player = room.players.find((candidate) => candidate.id === playerId)
    if (!player) throw new RoomError('NOT_IN_ROOM', 'Você não está nesta sala.')

    // Voltar ao lobby depois da corrida libera a sala para uma nova largada.
    if (room.state === 'racing' || room.state === 'finished') this.resetRace(room)

    player.ready = ready
    if (room.state === 'countdown' && !this.everyoneReady(room)) this.resetRace(room)
    return this.toPublic(room)
  }

  /**
   * Troca a dificuldade da sala.
   *
   * Só antes da contagem: mudar a regra com a largada já marcada seria trocar
   * a prova debaixo de quem já confirmou. E confirmar de novo é obrigatório —
   * a escolha volta a zero para os dois, porque ninguém deve largar numa
   * dificuldade que não viu.
   */
  setDifficulty(codeInput: string, playerId: string, difficulty: unknown) {
    const room = this.requireRoom(codeInput)
    if (!room.players.some((candidate) => candidate.id === playerId)) {
      throw new RoomError('NOT_IN_ROOM', 'Você não está nesta sala.')
    }
    // Só quem criou a sala escolhe. Com os dois podendo trocar, a decisão
    // viraria um cabo de guerra e ninguém saberia em que prova vai largar.
    if (room.hostId !== playerId) {
      throw new RoomError('NOT_HOST', 'Só quem criou a sala escolhe a dificuldade.')
    }
    if (room.state === 'countdown' || room.state === 'racing') return this.toPublic(room)

    const escolhida = toDifficulty(difficulty)
    if (escolhida === room.difficulty) return this.toPublic(room)

    if (room.state === 'finished') this.resetRace(room)
    room.difficulty = escolhida
    for (const candidate of room.players) candidate.ready = false
    return this.toPublic(room)
  }

  /** Quem manda na sala agora. */
  hostOf(codeInput: string) {
    return this.rooms.get(this.normalize(codeInput))?.hostId ?? null
  }

  /** Dificuldade oficial da sala, para o servidor validar a chegada. */
  difficultyOf(codeInput: string): Difficulty {
    return this.rooms.get(this.normalize(codeInput))?.difficulty ?? 'normal'
  }

  /** Define o instante oficial da largada. Retorna null se a sala ainda não puder largar. */
  scheduleStart(codeInput: string) {
    const room = this.requireRoom(codeInput)
    if (room.state !== 'idle' || !this.everyoneReady(room)) return null
    room.state = 'countdown'
    room.startAt = this.now() + this.countdownMs
    // Cada largada estreia um traçado. Como a semente é renovada aqui, e só
    // aqui, ela fica congelada durante a contagem, a corrida e qualquer
    // reconexão no meio da prova — e a revanche, que passa por este mesmo
    // caminho, ganha uma pista nova para os dois ao mesmo tempo.
    room.trackSeed = this.nextSeed()
    return this.toPublic(room)
  }

  cancelStart(codeInput: string, options: { clearReady?: boolean } = {}) {
    const room = this.rooms.get(this.normalize(codeInput))
    if (!room || room.state !== 'countdown') return null
    this.resetRace(room, options.clearReady ?? true)
    return this.toPublic(room)
  }

  /** Transição executada pelo servidor no instante agendado. */
  beginRace(codeInput: string) {
    const room = this.rooms.get(this.normalize(codeInput))
    if (!room || room.state !== 'countdown') return null
    room.state = 'racing'
    for (const player of room.players) player.telemetry = null
    return this.toPublic(room)
  }

  /**
   * Valida a telemetria antes de repassá-la ao adversário.
   *
   * Descarta medições fora de ordem, corrige horários incoerentes e limita o
   * avanço ao que é fisicamente possível, para que um cliente com problema —
   * ou adulterado — não teleporte o próprio fantasma na tela do rival.
   */
  acceptTelemetry(codeInput: string, playerId: string, input: Telemetry): Telemetry | null {
    const room = this.rooms.get(this.normalize(codeInput))
    if (!room || room.state !== 'racing') return null
    const player = room.players.find((candidate) => candidate.id === playerId)
    if (!player) return null

    if (![input.t, input.progress, input.lateral, input.speed].every(Number.isFinite)) return null

    const now = this.now()
    const previous = player.telemetry
    let t = Math.abs(input.t - now) > CLOCK_TOLERANCE_MS ? now : input.t

    // Pacote genuinamente atrasado: o adversário já viu uma posição mais nova.
    if (previous && t < previous.t) return null
    // Dois envios no mesmo milissegundo — caso da chegada — não podem sumir.
    if (previous && t === previous.t) t = previous.t + 1

    let progress = Math.max(0, input.progress)
    if (previous) {
      const elapsed = Math.max(0, (t - previous.t) / 1000)
      const ceiling = previous.progress + MAX_PLAUSIBLE_SPEED_MS * elapsed + PROGRESS_TOLERANCE_M
      progress = Math.min(Math.max(progress, previous.progress), ceiling)
    }

    const accepted: Telemetry = {
      t,
      progress,
      lateral: Math.max(-LATERAL_LIMIT, Math.min(LATERAL_LIMIT, input.lateral)),
      speed: Math.max(0, Math.min(MAX_PLAUSIBLE_SPEED_MS * 3.6, input.speed)),
      state: input.state === 'finished' ? 'finished' : 'racing',
    }
    player.telemetry = accepted
    return accepted
  }

  /**
   * Registra a passagem pela linha de chegada.
   *
   * O cliente informa o próprio tempo, mas quem manda é o servidor: o valor é
   * preso entre o mínimo fisicamente possível e o tempo já decorrido desde a
   * largada oficial, com uma folga para a viagem da mensagem. Assim um relógio
   * errado — ou um cliente adulterado — não consegue reivindicar uma volta
   * impossível.
   */
  recordFinish(codeInput: string, playerId: string, report: FinishReport) {
    const room = this.rooms.get(this.normalize(codeInput))
    if (!room || room.state !== 'racing' || room.startAt === null) return null
    const player = room.players.find((candidate) => candidate.id === playerId)
    if (!player || player.finish) return null

    // O piso vem da dificuldade da própria sala: no profissional o carro é
    // mais rápido, e um tempo legítimo lá seria recusado pelo piso do normal.
    const minimo = minRaceSeconds(room.difficulty)
    const elapsed = (this.now() - room.startAt) / 1000
    if (elapsed < minimo) return null

    const reported = Number.isFinite(report.time) ? report.time : elapsed
    const floor = Math.max(minimo, elapsed - FINISH_TOLERANCE_SECONDS)
    player.finish = {
      playerId,
      name: player.name,
      time: Math.min(Math.max(reported, floor), elapsed),
      topSpeed: Number.isFinite(report.topSpeed) ? Math.max(0, report.topSpeed) : 0,
      collisions: Number.isFinite(report.collisions) ? Math.max(0, Math.trunc(report.collisions)) : 0,
      outcome: 'finished',
    }

    // Fecha o resultado antes de fotografar a sala, senão o estado enviado
    // aos clientes ainda diria que a corrida está em andamento.
    const outcome = this.settleIfComplete(room)
    return { room: this.toPublic(room), outcome }
  }

  /**
   * Encerra a corrida a favor de quem ficou, quando o rival não volta a tempo
   * ou desiste no meio da prova.
   */
  abandonRace(codeInput: string, playerId: string) {
    const room = this.rooms.get(this.normalize(codeInput))
    if (!room || room.state !== 'racing') return null
    const player = room.players.find((candidate) => candidate.id === playerId)
    if (!player) return null

    player.finish = {
      playerId,
      name: player.name,
      time: null,
      topSpeed: player.telemetry?.speed ?? 0,
      collisions: 0,
      outcome: 'abandoned',
    }
    for (const rival of room.players) {
      if (rival.id === playerId || rival.finish) continue
      rival.finish = {
        playerId: rival.id,
        name: rival.name,
        time: null,
        topSpeed: rival.telemetry?.speed ?? 0,
        collisions: 0,
        outcome: 'unfinished',
      }
    }

    // Fecha o resultado antes de fotografar a sala, senão o estado enviado
    // aos clientes ainda diria que a corrida está em andamento.
    const outcome = this.settleIfComplete(room)
    return { room: this.toPublic(room), outcome }
  }

  /** Resultado oficial da última corrida, igual para os dois pilotos. */
  outcomeFor(codeInput: string) {
    return this.rooms.get(this.normalize(codeInput))?.outcome ?? null
  }

  /** Pedido de revanche. Com os dois pedidos, a sala volta a ficar pronta. */
  requestRematch(codeInput: string, playerId: string) {
    const room = this.requireRoom(codeInput)
    const player = room.players.find((candidate) => candidate.id === playerId)
    if (!player) throw new RoomError('NOT_IN_ROOM', 'Você não está nesta sala.')
    if (room.state !== 'finished') return this.toPublic(room)

    player.rematch = true
    const todos =
      room.players.length === 2 &&
      room.players.every((candidate) => candidate.rematch && candidate.disconnectedAt === null)

    if (todos) {
      this.resetRace(room, false)
      for (const candidate of room.players) candidate.ready = true
    }
    return this.toPublic(room)
  }

  /** Última telemetria conhecida de quem não é o jogador informado. */
  rivalTelemetry(codeInput: string, playerId: string) {
    const room = this.rooms.get(this.normalize(codeInput))
    const rival = room?.players.find((candidate) => candidate.id !== playerId)
    return rival?.telemetry ?? null
  }

  /** Saída explícita: remove o piloto imediatamente. */
  leaveBySocket(socketId: string) {
    const updates: RoomUpdate[] = []
    for (const [code, room] of this.rooms) {
      if (!room.players.some((player) => player.socketId === socketId)) continue
      room.players = room.players.filter((player) => player.socketId !== socketId)
      updates.push(this.afterDeparture(code, room))
    }
    return updates
  }

  /** Queda de conexão: o piloto continua na sala até a janela de retorno expirar. */
  markDisconnected(socketId: string) {
    const updates: Array<RoomUpdate & { playerId: string }> = []
    for (const [code, room] of this.rooms) {
      const player = room.players.find((candidate) => candidate.socketId === socketId)
      if (!player) continue
      player.disconnectedAt = this.now()
      player.ready = false
      const cancelledCountdown = room.state === 'countdown'
      if (cancelledCountdown) this.resetRace(room)
      updates.push({ code, room: this.toPublic(room), playerId: player.id, cancelledCountdown })
    }
    return updates
  }

  /** Remove quem não voltou dentro da janela de reconexão. */
  dropIfStillDisconnected(codeInput: string, playerId: string): RoomUpdate | null {
    const room = this.rooms.get(this.normalize(codeInput))
    const player = room?.players.find((candidate) => candidate.id === playerId)
    if (!room || !player || player.disconnectedAt === null) return null
    room.players = room.players.filter((candidate) => candidate.id !== playerId)
    return this.afterDeparture(room.code, room)
  }

  get(codeInput: string) {
    const room = this.rooms.get(this.normalize(codeInput))
    return room ? this.toPublic(room) : null
  }

  get size() {
    return this.rooms.size
  }

  private afterDeparture(code: string, room: Room): RoomUpdate {
    const cancelledCountdown = room.state === 'countdown'
    if (room.players.length === 0) {
      this.rooms.delete(code)
      return { code, room: null, cancelledCountdown }
    }
    this.ensureHost(room)
    if (room.state !== 'idle') this.resetRace(room)
    return { code, room: this.toPublic(room), cancelledCountdown }
  }

  /**
   * Fecha a corrida quando os dois pilotos já têm um desfecho e monta o
   * resultado uma única vez, para que as duas telas recebam exatamente o mesmo.
   */
  private settleIfComplete(room: Room): RaceOutcome | null {
    if (room.players.length < 2) return null
    if (!room.players.every((player) => player.finish)) return null

    const entries = room.players.map((player) => player.finish!)
    const abandono = entries.some((entry) => entry.outcome === 'abandoned')
    const completos = entries.filter((entry) => entry.outcome === 'finished' && entry.time !== null)

    const ordenado = [...entries].sort((a, b) => {
      if (a.outcome === 'finished' && b.outcome !== 'finished') return -1
      if (b.outcome === 'finished' && a.outcome !== 'finished') return 1
      if (a.outcome === 'unfinished' && b.outcome === 'abandoned') return -1
      if (b.outcome === 'unfinished' && a.outcome === 'abandoned') return 1
      return (a.time ?? Infinity) - (b.time ?? Infinity)
    })

    const vencedor = ordenado[0]
    room.state = 'finished'
    room.outcome = {
      code: room.code,
      winnerId: vencedor.outcome === 'abandoned' ? null : vencedor.playerId,
      reason: abandono ? 'abandon' : 'time',
      gap: completos.length === 2 ? Math.abs(completos[0].time! - completos[1].time!) : null,
      entries: ordenado,
    }
    return room.outcome
  }

  private resetRace(room: Room, clearReady = true) {
    room.state = 'idle'
    room.startAt = null
    room.outcome = null
    for (const player of room.players) {
      player.telemetry = null
      player.finish = null
      player.rematch = false
      if (clearReady) player.ready = false
    }
  }

  /**
   * Garante que a sala sempre tenha um anfitrião presente.
   *
   * Se o criador sai de vez, quem ficou assume — sem isso a dificuldade
   * ficaria trancada no valor que ele deixou. Uma queda de conexão não
   * transfere nada: ele continua dono enquanto a janela de retorno correr.
   */
  private ensureHost(room: Room) {
    if (room.players.some((player) => player.id === room.hostId)) return
    room.hostId = room.players[0]?.id ?? null
  }

  private everyoneReady(room: Room) {
    return (
      room.players.length === 2 &&
      room.players.every((player) => player.ready && player.disconnectedAt === null)
    )
  }

  /** Abre na hora uma sala de demonstração que ainda não existe. */
  private ensureOpenRoom(codeInput: string) {
    const code = this.normalize(codeInput)
    if (!this.openRooms.has(code) || this.rooms.has(code)) return null
    const room: Room = {
      code,
      createdAt: this.now(),
      state: 'idle',
      startAt: null,
      trackSeed: this.nextSeed(),
      difficulty: 'normal',
      // A sala de demonstração nasce vazia: o primeiro a entrar é o anfitrião.
      hostId: null,
      outcome: null,
      players: [],
    }
    this.rooms.set(code, room)
    return room
  }

  private requireRoom(codeInput: string) {
    const room = this.rooms.get(this.normalize(codeInput))
    if (!room) throw new RoomError('ROOM_NOT_FOUND', 'Sala não encontrada.')
    return room
  }

  private createPlayer(id: string, socketId: string, rawName: string): Player {
    return {
      id,
      socketId,
      name: this.cleanName(rawName),
      ready: false,
      disconnectedAt: null,
      telemetry: null,
      finish: null,
      rematch: false,
    }
  }

  private normalize(code: string) {
    return code.trim().toUpperCase()
  }

  private cleanName(name: string) {
    return name.trim().slice(0, 16) || 'Piloto'
  }

  private createCode() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      let code = ''
      for (let index = 0; index < 5; index += 1) {
        code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
      }
      if (!this.rooms.has(code)) return code
    }
    throw new Error('Não foi possível gerar um código de sala.')
  }

  private toPublic(room: Room): PublicRoom {
    const players = room.players.map(({ id, name, ready, disconnectedAt, finish, rematch }) => ({
      id,
      name,
      ready,
      connected: disconnectedAt === null,
      finished: finish !== null,
      rematch,
    }))
    const status: RoomStatus =
      room.state === 'finished'
        ? 'finished'
        : room.state === 'racing'
          ? 'racing'
          : room.state === 'countdown'
            ? 'countdown'
            : this.everyoneReady(room)
              ? 'ready'
              : 'waiting'
    return {
      code: room.code,
      players,
      status,
      startAt: room.startAt,
      countdownMs: this.countdownMs,
      trackSeed: room.trackSeed,
      difficulty: room.difficulty,
      hostId: room.hostId,
    }
  }
}
