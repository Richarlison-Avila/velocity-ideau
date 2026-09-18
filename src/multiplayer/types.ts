export type LobbyPlayer = {
  id: string
  name: string
  ready: boolean
  connected: boolean
}

export type LobbyStatus = 'waiting' | 'ready' | 'countdown' | 'racing'

export type LobbyRoom = {
  code: string
  players: LobbyPlayer[]
  status: LobbyStatus
  /** Instante oficial da largada, no relógio do servidor. */
  startAt: number | null
  /** Duração total da sequência de luzes definida pelo servidor. */
  countdownMs: number
}

export type RoomResponse = {
  ok: boolean
  room?: LobbyRoom | null
  error?: string
}

export type ScheduledRace = {
  code: string
  startAt: number
  countdownMs: number
  serverTime: number
}

export type RaceCancelled = {
  code: string
  reason: string
}
