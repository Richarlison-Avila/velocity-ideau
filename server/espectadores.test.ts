import type { AddressInfo } from 'node:net'
import { io as connectClient, type Socket } from 'socket.io-client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createGameServer, type GameServer } from './app.js'
import type { PublicRoom } from './rooms.js'

/**
 * A arquibancada pelo servidor de verdade: o que chega a quem assiste, e o
 * que quem assiste não consegue fazer.
 */

const COUNTDOWN_MS = 300

type RoomAck = { ok: boolean; room?: PublicRoom; error?: string }
type Rival = { playerId: string; t: number; progress: number; lateral: number; speed: number; state: string }

let server: GameServer
let port = 0
const clients: Socket[] = []

function connect() {
  return new Promise<Socket>((resolve, reject) => {
    const client = connectClient(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true })
    clients.push(client)
    client.on('connect', () => resolve(client))
    client.on('connect_error', reject)
  })
}

function ask<T>(client: Socket, event: string, payload?: unknown) {
  return new Promise<T>((resolve) => client.emit(event, payload, resolve))
}

function waitFor<T>(client: Socket, event: string, timeout = 3_000) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`evento "${event}" não chegou`)), timeout)
    client.once(event, (payload: T) => {
      clearTimeout(timer)
      resolve(payload)
    })
  })
}

function waitForRoom(client: Socket, matches: (room: PublicRoom) => boolean, timeout = 3_000) {
  return new Promise<PublicRoom>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('a sala não atingiu o estado esperado')), timeout)
    const handler = (room: PublicRoom) => {
      if (!matches(room)) return
      clearTimeout(timer)
      client.off('room:update', handler)
      resolve(room)
    }
    client.on('room:update', handler)
  })
}

const pausa = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Uma sala com os pilotos pedidos, todos conectados, ainda no lobby. */
async function salaCom(ids: string[]) {
  const pilotos = new Map<string, Socket>()
  const primeiro = await connect()
  const criada = await ask<RoomAck>(primeiro, 'room:create', { name: ids[0], playerId: ids[0] })
  const code = criada.room!.code
  pilotos.set(ids[0], primeiro)
  for (const id of ids.slice(1)) {
    const cliente = await connect()
    const entrou = await ask<RoomAck>(cliente, 'room:join', { code, name: id, playerId: id })
    expect(entrou.ok).toBe(true)
    pilotos.set(id, cliente)
  }
  return { code, pilotos }
}

function confirmarTodos(code: string, pilotos: Map<string, Socket>) {
  for (const [id, cliente] of pilotos) cliente.emit('room:set-ready', { code, playerId: id, ready: true })
}

function telemetria(code: string, playerId: string, progress: number) {
  return { code, playerId, t: Date.now(), progress, lateral: 0, speed: 200, state: 'racing' as const }
}

beforeEach(async () => {
  server = createGameServer({ countdownMs: COUNTDOWN_MS, graceMs: 30_000, serveStatic: false })
  await new Promise<void>((resolve) => server.http.listen(0, resolve))
  port = (server.http.address() as AddressInfo).port
})

afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect()
  await server.close()
})

describe('arquibancada pelo servidor', () => {
  it('com o grid cheio, o sétimo não entra no grid, mas assiste — e os pilotos o veem', async () => {
    const { code, pilotos } = await salaCom(['a', 'b', 'c', 'd', 'e', 'f'])
    const setimo = await connect()
    const recusado = await ask<RoomAck>(setimo, 'room:join', { code, name: 'Gil', playerId: 'g' })
    expect(recusado.ok).toBe(false)

    const avisoDoAnfitriao = waitForRoom(pilotos.get('a')!, (room) => room.spectators.length === 1)
    const assistindo = await ask<RoomAck>(setimo, 'room:spectate', { code, name: 'Gil', spectatorId: 'g' })
    expect(assistindo.ok).toBe(true)
    expect(assistindo.room?.players).toHaveLength(6)
    expect((await avisoDoAnfitriao).spectators).toEqual([{ id: 'g', name: 'Gil' }])
  }, 15_000)

  it('o espectador recebe a largada e a telemetria de todos os pilotos', async () => {
    const { code, pilotos } = await salaCom(['a', 'b', 'c'])
    const espectador = await connect()
    await ask<RoomAck>(espectador, 'room:spectate', { code, name: 'Gil', spectatorId: 'g' })

    const largada = waitFor<{ startAt: number; trackSeed: number }>(espectador, 'race:scheduled')
    const correndo = waitForRoom(espectador, (room) => room.status === 'racing')
    confirmarTodos(code, pilotos)
    expect((await largada).trackSeed).toBeTypeOf('number')
    await correndo

    const vistos = new Set<string>()
    espectador.on('race:rival', (rival: Rival) => vistos.add(rival.playerId))
    for (const [id, cliente] of pilotos) cliente.emit('race:telemetry', telemetria(code, id, 5))
    await pausa(300)
    expect([...vistos].sort()).toEqual(['a', 'b', 'c'])
  }, 15_000)

  it('quem chega no meio da prova recebe o instante oficial e a posição de todos', async () => {
    const { code, pilotos } = await salaCom(['a', 'b'])
    const correndo = waitForRoom(pilotos.get('a')!, (room) => room.status === 'racing')
    confirmarTodos(code, pilotos)
    await correndo
    for (const [id, cliente] of pilotos) cliente.emit('race:telemetry', telemetria(code, id, id === 'a' ? 3 : 4))
    await pausa(200)

    const atrasado = await connect()
    const vistos: Rival[] = []
    atrasado.on('race:rival', (rival: Rival) => vistos.push(rival))
    const largada = waitFor<{ startAt: number }>(atrasado, 'race:scheduled')
    const assistindo = await ask<RoomAck>(atrasado, 'room:spectate', { code, name: 'Gil', spectatorId: 'g' })
    expect(assistindo.room?.status).toBe('racing')
    expect((await largada).startAt).toBe(assistindo.room?.startAt)
    await pausa(200)
    expect(vistos.map((rival) => rival.playerId).sort()).toEqual(['a', 'b'])
  }, 15_000)

  it('o espectador não fala por piloto nenhum', async () => {
    const { code, pilotos } = await salaCom(['a', 'b'])
    const espectador = await connect()
    await ask<RoomAck>(espectador, 'room:spectate', { code, name: 'Gil', spectatorId: 'g' })

    // Nem confirma no lugar de um piloto...
    const recusada = await ask<RoomAck>(espectador, 'room:set-ready', { code, playerId: 'a', ready: true })
    expect(recusada.ok).toBe(false)

    // ...nem manda telemetria em nome dele durante a prova.
    const correndo = waitForRoom(pilotos.get('b')!, (room) => room.status === 'racing')
    confirmarTodos(code, pilotos)
    await correndo
    const recebidos: Rival[] = []
    pilotos.get('b')!.on('race:rival', (rival: Rival) => recebidos.push(rival))
    espectador.emit('race:telemetry', telemetria(code, 'a', 1))
    await pausa(250)
    expect(recebidos).toEqual([])
  }, 15_000)

  it('sair da arquibancada durante a contagem não trava a largada', async () => {
    const { code, pilotos } = await salaCom(['a', 'b'])
    const espectador = await connect()
    await ask<RoomAck>(espectador, 'room:spectate', { code, name: 'Gil', spectatorId: 'g' })

    const contagem = waitForRoom(pilotos.get('a')!, (room) => room.status === 'countdown')
    confirmarTodos(code, pilotos)
    await contagem
    const correndo = waitForRoom(pilotos.get('a')!, (room) => room.status === 'racing')
    espectador.emit('room:leave')
    expect((await correndo).status).toBe('racing')
  }, 15_000)

  it('a queda de conexão do espectador o tira da sala sem mexer na prova', async () => {
    const { code, pilotos } = await salaCom(['a', 'b'])
    const espectador = await connect()
    await ask<RoomAck>(espectador, 'room:spectate', { code, name: 'Gil', spectatorId: 'g' })

    const semEle = waitForRoom(pilotos.get('a')!, (room) => room.spectators.length === 0)
    espectador.disconnect()
    const sala = await semEle
    expect(sala.players).toHaveLength(2)
    expect(sala.players.every((player) => player.connected)).toBe(true)
  }, 15_000)

  it('o espectador vê o resultado oficial', async () => {
    const { code, pilotos } = await salaCom(['a', 'b'])
    const espectador = await connect()
    await ask<RoomAck>(espectador, 'room:spectate', { code, name: 'Gil', spectatorId: 'g' })
    const correndo = waitForRoom(espectador, (room) => room.status === 'racing')
    confirmarTodos(code, pilotos)
    await correndo

    const resultado = waitFor<{ entries: Array<{ playerId: string }> }>(espectador, 'race:result')
    pilotos.get('a')!.emit('race:abandon', { code, playerId: 'a' })
    expect((await resultado).entries.map((entry) => entry.playerId).sort()).toEqual(['a', 'b'])
  }, 15_000)

  it('desce da arquibancada quando abre uma vaga, e passa a correr como piloto', async () => {
    const { code, pilotos } = await salaCom(['a', 'b'])
    const torcedor = await connect()
    await ask<RoomAck>(torcedor, 'room:spectate', { code, name: 'Gil', spectatorId: 'g' })
    const entrou = await ask<RoomAck>(torcedor, 'room:join', { code, name: 'Gil', playerId: 'g' })
    expect(entrou.room?.players.map((player) => player.id)).toContain('g')
    expect(entrou.room?.spectators).toEqual([])

    // Agora ele fala pelo próprio piloto.
    const confirmado = await ask<RoomAck>(torcedor, 'room:set-ready', { code, playerId: 'g', ready: true })
    expect(confirmado.ok).toBe(true)
    expect(pilotos.size).toBe(2)
  }, 15_000)
})
