import { describe, expect, it } from 'vitest'
import { RoomError, RoomStore } from './rooms.js'

describe('salas multiplayer', () => {
  it('cria uma sala e aceita exatamente dois pilotos', () => {
    const rooms = new RoomStore()
    const room = rooms.create('socket-a', 'a', 'Ana')
    expect(room.code).toHaveLength(5)
    expect(rooms.join(room.code, 'socket-b', 'b', 'Beto').players).toHaveLength(2)
    expect(() => rooms.join(room.code, 'socket-c', 'c', 'Caio')).toThrow(RoomError)
  })

  it('fica pronta somente quando os dois confirmam', () => {
    const rooms = new RoomStore()
    const room = rooms.create('socket-a', 'a', 'Ana')
    rooms.join(room.code, 'socket-b', 'b', 'Beto')
    expect(rooms.setReady(room.code, 'a', true).status).toBe('waiting')
    expect(rooms.setReady(room.code, 'b', true).status).toBe('ready')
  })

  it('remove quem sai antes da largada', () => {
    const rooms = new RoomStore()
    const room = rooms.create('socket-a', 'a', 'Ana')
    rooms.join(room.code, 'socket-b', 'b', 'Beto')
    rooms.leaveBySocket('socket-b')
    expect(rooms.get(room.code)?.players.map((player) => player.name)).toEqual(['Ana'])
  })
})
