export type PublicPlayer = {
  id: string
  name: string
  ready: boolean
}

export type PublicRoom = {
  code: string
  players: PublicPlayer[]
  status: 'waiting' | 'ready'
}

type Player = PublicPlayer & { socketId: string }
type Room = { code: string; players: Player[]; createdAt: number }

export class RoomError extends Error {
  constructor(public code: 'ROOM_NOT_FOUND' | 'ROOM_FULL' | 'NOT_IN_ROOM', message: string) {
    super(message)
  }
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export class RoomStore {
  private rooms = new Map<string, Room>()

  create(socketId: string, playerId: string, rawName: string) {
    const code = this.createCode()
    this.rooms.set(code, {
      code,
      createdAt: Date.now(),
      players: [{ id: playerId, socketId, name: this.cleanName(rawName), ready: false }],
    })
    return this.get(code)!
  }

  join(codeInput: string, socketId: string, playerId: string, rawName: string) {
    const code = codeInput.trim().toUpperCase()
    const room = this.rooms.get(code)
    if (!room) throw new RoomError('ROOM_NOT_FOUND', 'Sala não encontrada.')

    const returning = room.players.find((player) => player.id === playerId)
    if (returning) {
      returning.socketId = socketId
      returning.name = this.cleanName(rawName)
      return this.toPublic(room)
    }

    if (room.players.length >= 2) throw new RoomError('ROOM_FULL', 'Esta sala já está cheia.')
    room.players.push({ id: playerId, socketId, name: this.cleanName(rawName), ready: false })
    return this.toPublic(room)
  }

  setReady(codeInput: string, playerId: string, ready: boolean) {
    const room = this.rooms.get(codeInput.toUpperCase())
    const player = room?.players.find((candidate) => candidate.id === playerId)
    if (!room || !player) throw new RoomError('NOT_IN_ROOM', 'Você não está nesta sala.')
    player.ready = ready
    return this.toPublic(room)
  }

  leaveBySocket(socketId: string) {
    const updates: Array<{ code: string; room: PublicRoom | null }> = []
    for (const [code, room] of this.rooms) {
      const nextPlayers = room.players.filter((player) => player.socketId !== socketId)
      if (nextPlayers.length === room.players.length) continue
      if (nextPlayers.length === 0) {
        this.rooms.delete(code)
        updates.push({ code, room: null })
      } else {
        room.players = nextPlayers
        updates.push({ code, room: this.toPublic(room) })
      }
    }
    return updates
  }

  get(codeInput: string) {
    const room = this.rooms.get(codeInput.trim().toUpperCase())
    return room ? this.toPublic(room) : null
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
    const players = room.players.map(({ id, name, ready }) => ({ id, name, ready }))
    return {
      code: room.code,
      players,
      status: players.length === 2 && players.every((player) => player.ready) ? 'ready' : 'waiting',
    }
  }
}
