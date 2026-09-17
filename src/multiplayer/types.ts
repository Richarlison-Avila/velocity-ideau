export type LobbyPlayer = {
  id: string
  name: string
  ready: boolean
}

export type LobbyRoom = {
  code: string
  players: LobbyPlayer[]
  status: 'waiting' | 'ready'
}

export type RoomResponse = {
  ok: boolean
  room?: LobbyRoom
  error?: string
}
