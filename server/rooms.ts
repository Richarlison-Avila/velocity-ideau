export type RoomStatus = 'waiting' | 'ready' | 'countdown' | 'racing'

export type PublicPlayer = {
  id: string
  name: string
  ready: boolean
  connected: boolean
}

export type PublicRoom = {
  code: string
  players: PublicPlayer[]
  status: RoomStatus
  /** Instante oficial da largada, no relógio do servidor. */
  startAt: number | null
  /** Duração total da sequência de luzes, usada pelos clientes. */
  countdownMs: number
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
}

type RaceState = 'idle' | 'countdown' | 'racing'

type Room = {
  code: string
  players: Player[]
  createdAt: number
  state: RaceState
  startAt: number | null
}

export type RoomUpdate = {
  code: string
  room: PublicRoom | null
  /** Indica que a saída interrompeu uma contagem já agendada. */
  cancelledCountdown: boolean
}

export class RoomError extends Error {
  constructor(public code: 'ROOM_NOT_FOUND' | 'ROOM_FULL' | 'NOT_IN_ROOM', message: string) {
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
/** Limite lateral da pista, usado para descartar valores fora da faixa. */
export const LATERAL_LIMIT = 1.28
/** Diferença máxima aceita entre o horário da medição e o do servidor. */
export const CLOCK_TOLERANCE_MS = 5_000

export type RoomStoreOptions = {
  now?: () => number
  countdownMs?: number
}

export class RoomStore {
  private rooms = new Map<string, Room>()
  private now: () => number
  private countdownMs: number

  constructor(options: RoomStoreOptions = {}) {
    this.now = options.now ?? (() => Date.now())
    this.countdownMs = options.countdownMs ?? COUNTDOWN_MS
  }

  create(socketId: string, playerId: string, rawName: string) {
    const code = this.createCode()
    this.rooms.set(code, {
      code,
      createdAt: this.now(),
      state: 'idle',
      startAt: null,
      players: [this.createPlayer(playerId, socketId, rawName)],
    })
    return this.get(code)!
  }

  join(codeInput: string, socketId: string, playerId: string, rawName: string) {
    const room = this.requireRoom(codeInput)

    const returning = room.players.find((player) => player.id === playerId)
    if (returning) {
      returning.socketId = socketId
      returning.disconnectedAt = null
      returning.name = this.cleanName(rawName)
      return this.toPublic(room)
    }

    if (room.players.length >= 2) throw new RoomError('ROOM_FULL', 'Esta sala já está cheia.')
    room.players.push(this.createPlayer(playerId, socketId, rawName))
    return this.toPublic(room)
  }

  setReady(codeInput: string, playerId: string, ready: boolean) {
    const room = this.requireRoom(codeInput)
    const player = room.players.find((candidate) => candidate.id === playerId)
    if (!player) throw new RoomError('NOT_IN_ROOM', 'Você não está nesta sala.')

    // Voltar ao lobby depois da corrida libera a sala para uma nova largada.
    if (room.state === 'racing') this.resetRace(room)

    player.ready = ready
    if (room.state === 'countdown' && !this.everyoneReady(room)) this.resetRace(room)
    return this.toPublic(room)
  }

  /** Define o instante oficial da largada. Retorna null se a sala ainda não puder largar. */
  scheduleStart(codeInput: string) {
    const room = this.requireRoom(codeInput)
    if (room.state !== 'idle' || !this.everyoneReady(room)) return null
    room.state = 'countdown'
    room.startAt = this.now() + this.countdownMs
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
    if (room.state !== 'idle') this.resetRace(room)
    return { code, room: this.toPublic(room), cancelledCountdown }
  }

  private resetRace(room: Room, clearReady = true) {
    room.state = 'idle'
    room.startAt = null
    for (const player of room.players) {
      player.telemetry = null
      if (clearReady) player.ready = false
    }
  }

  private everyoneReady(room: Room) {
    return (
      room.players.length === 2 &&
      room.players.every((player) => player.ready && player.disconnectedAt === null)
    )
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
    const players = room.players.map(({ id, name, ready, disconnectedAt }) => ({
      id,
      name,
      ready,
      connected: disconnectedAt === null,
    }))
    const status: RoomStatus =
      room.state === 'racing'
        ? 'racing'
        : room.state === 'countdown'
          ? 'countdown'
          : this.everyoneReady(room)
            ? 'ready'
            : 'waiting'
    return { code: room.code, players, status, startAt: room.startAt, countdownMs: this.countdownMs }
  }
}
