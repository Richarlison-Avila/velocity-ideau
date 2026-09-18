import type { AddressInfo } from 'node:net'
import { io as connectClient, type Socket } from 'socket.io-client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createGameServer, type GameServer } from './app.js'
import type { PublicRoom } from './rooms.js'

const COUNTDOWN_MS = 400
const GRACE_MS = 600

type RoomAck = { ok: boolean; room?: PublicRoom; error?: string }
type Scheduled = { code: string; startAt: number; countdownMs: number; serverTime: number }

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

/** Cria a sala com dois pilotos conectados e devolve os dois clientes. */
async function gridCompleto() {
  const ana = await connect()
  const beto = await connect()
  const criada = await ask<RoomAck>(ana, 'room:create', { name: 'Ana', playerId: 'ana' })
  const code = criada.room!.code
  await ask<RoomAck>(beto, 'room:join', { code, name: 'Beto', playerId: 'beto' })
  return { ana, beto, code }
}

beforeEach(async () => {
  server = createGameServer({ countdownMs: COUNTDOWN_MS, graceMs: GRACE_MS, serveStatic: false })
  await new Promise<void>((resolve) => server.http.listen(0, resolve))
  port = (server.http.address() as AddressInfo).port
})

afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect()
  await server.close()
})

describe('sala pelo socket', () => {
  it('reúne os dois pilotos na mesma sala', async () => {
    const { ana, code } = await gridCompleto()
    const visaoDaAna = await waitForRoom(ana, (room) => room.players.length === 2, 1_000).catch(() => server.rooms.get(code)!)
    expect(visaoDaAna.players.map((player) => player.name)).toEqual(['Ana', 'Beto'])
    expect(visaoDaAna.players.every((player) => player.connected)).toBe(true)
  })

  it('recusa um terceiro piloto e uma sala inexistente', async () => {
    const { code } = await gridCompleto()
    const caio = await connect()

    const cheia = await ask<RoomAck>(caio, 'room:join', { code, name: 'Caio', playerId: 'caio' })
    expect(cheia.ok).toBe(false)
    expect(cheia.error).toContain('cheia')

    const inexistente = await ask<RoomAck>(caio, 'room:join', { code: 'ZZZZZ', name: 'Caio', playerId: 'caio' })
    expect(inexistente.ok).toBe(false)
    expect(inexistente.error).toContain('não encontrada')
  })

  it('avisa o rival quando alguém sai antes da largada', async () => {
    const { ana, beto } = await gridCompleto()
    const sozinha = waitForRoom(ana, (room) => room.players.length === 1)
    beto.emit('room:leave')
    expect((await sozinha).players.map((player) => player.name)).toEqual(['Ana'])
  })
})

describe('largada sincronizada pelo socket', () => {
  it('responde ao pedido de sincronização de relógio', async () => {
    const ana = await connect()
    const clientSentAt = Date.now()
    const resposta = await ask<{ serverTime: number; clientSentAt: number }>(ana, 'time:sync', { clientSentAt })
    expect(resposta.clientSentAt).toBe(clientSentAt)
    expect(Math.abs(resposta.serverTime - Date.now())).toBeLessThan(1_000)
  })

  it('entrega exatamente o mesmo instante de largada para os dois pilotos', async () => {
    const { ana, beto, code } = await gridCompleto()
    const agendadaParaAna = waitFor<Scheduled>(ana, 'race:scheduled')
    const agendadaParaBeto = waitFor<Scheduled>(beto, 'race:scheduled')

    ana.emit('room:set-ready', { code, playerId: 'ana', ready: true })
    beto.emit('room:set-ready', { code, playerId: 'beto', ready: true })

    const [paraAna, paraBeto] = await Promise.all([agendadaParaAna, agendadaParaBeto])
    expect(paraAna.startAt).toBe(paraBeto.startAt)
    expect(paraAna.countdownMs).toBe(paraBeto.countdownMs)
    expect(paraAna.startAt).toBeGreaterThan(Date.now())
  })

  it('só agenda depois que os dois confirmam', async () => {
    const { ana, beto, code } = await gridCompleto()
    ana.emit('room:set-ready', { code, playerId: 'ana', ready: true })
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(server.rooms.get(code)?.status).toBe('waiting')
    expect(server.rooms.get(code)?.startAt).toBeNull()

    const agendada = waitFor<Scheduled>(beto, 'race:scheduled')
    beto.emit('room:set-ready', { code, playerId: 'beto', ready: true })
    await agendada
    expect(server.rooms.get(code)?.status).toBe('countdown')
  })

  it('inicia a corrida no instante combinado', async () => {
    const { ana, beto, code } = await gridCompleto()
    const correndoParaAna = waitForRoom(ana, (room) => room.status === 'racing')
    const correndoParaBeto = waitForRoom(beto, (room) => room.status === 'racing')
    const agendada = waitFor<Scheduled>(ana, 'race:scheduled')

    ana.emit('room:set-ready', { code, playerId: 'ana', ready: true })
    beto.emit('room:set-ready', { code, playerId: 'beto', ready: true })

    const { startAt } = await agendada
    const [salaDaAna, salaDoBeto] = await Promise.all([correndoParaAna, correndoParaBeto])
    const atraso = Date.now() - startAt

    expect(salaDaAna.startAt).toBe(startAt)
    expect(salaDoBeto.startAt).toBe(startAt)
    expect(atraso).toBeGreaterThanOrEqual(0)
    expect(atraso).toBeLessThan(250)
  })

  it('cancela a largada nos dois aparelhos quando um piloto desiste', async () => {
    const { ana, beto, code } = await gridCompleto()
    const agendada = waitFor<Scheduled>(ana, 'race:scheduled')
    ana.emit('room:set-ready', { code, playerId: 'ana', ready: true })
    beto.emit('room:set-ready', { code, playerId: 'beto', ready: true })
    await agendada

    const canceladaParaAna = waitFor<{ reason: string }>(ana, 'race:cancelled')
    const canceladaParaBeto = waitFor<{ reason: string }>(beto, 'race:cancelled')
    beto.emit('room:set-ready', { code, playerId: 'beto', ready: false })

    await Promise.all([canceladaParaAna, canceladaParaBeto])
    await new Promise((resolve) => setTimeout(resolve, COUNTDOWN_MS + 150))
    expect(server.rooms.get(code)?.status).toBe('waiting')
    expect(server.rooms.get(code)?.startAt).toBeNull()
  })
})

describe('telemetria e carro fantasma pelo socket', () => {
  type Rival = { playerId: string; t: number; progress: number; lateral: number; speed: number; state: string }

  /** Coloca os dois pilotos correndo de verdade, já passado o instante da largada. */
  async function emCorrida() {
    const { ana, beto, code } = await gridCompleto()
    const agendada = waitFor<Scheduled>(ana, 'race:scheduled')
    ana.emit('room:set-ready', { code, playerId: 'ana', ready: true })
    beto.emit('room:set-ready', { code, playerId: 'beto', ready: true })
    await agendada
    await waitForRoom(ana, (room) => room.status === 'racing')
    return { ana, beto, code }
  }

  const medicao = (code: string, playerId: string, progress: number, extra: Record<string, unknown> = {}) => ({
    code,
    playerId,
    t: Date.now(),
    progress,
    lateral: 0,
    speed: 252,
    state: 'racing',
    ...extra,
  })

  it('repassa a telemetria de um piloto para o adversário', async () => {
    const { ana, beto, code } = await emCorrida()
    const recebida = waitFor<Rival>(beto, 'race:rival')
    ana.emit('race:telemetry', medicao(code, 'ana', 340, { lateral: 0.4 }))

    const rival = await recebida
    expect(rival.progress).toBe(340)
    expect(rival.lateral).toBeCloseTo(0.4, 5)
    expect(rival.playerId).toBe('ana')
  })

  it('não devolve a própria telemetria para quem a enviou', async () => {
    const { ana, beto, code } = await emCorrida()
    let voltou = false
    ana.on('race:rival', () => {
      voltou = true
    })

    const recebida = waitFor<Rival>(beto, 'race:rival')
    ana.emit('race:telemetry', medicao(code, 'ana', 120))
    await recebida
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(voltou).toBe(false)
  })

  it('os dois pilotos enxergam o fantasma um do outro', async () => {
    const { ana, beto, code } = await emCorrida()
    const paraBeto = waitFor<Rival>(beto, 'race:rival')
    const paraAna = waitFor<Rival>(ana, 'race:rival')

    ana.emit('race:telemetry', medicao(code, 'ana', 300))
    beto.emit('race:telemetry', medicao(code, 'beto', 320))

    expect((await paraBeto).progress).toBe(300)
    expect((await paraAna).progress).toBe(320)
  })

  it('avisa o rival quando o piloto cruza a chegada', async () => {
    const { ana, beto, code } = await emCorrida()
    const recebida = waitFor<Rival>(beto, 'race:rival')
    ana.emit('race:telemetry', medicao(code, 'ana', 4_800, { speed: 0, state: 'finished' }))

    const rival = await recebida
    expect(rival.state).toBe('finished')
    expect(rival.speed).toBe(0)
  })

  it('recusa um avanço impossível em vez de teleportar o fantasma', async () => {
    const { ana, beto, code } = await emCorrida()

    const primeira = waitFor<Rival>(beto, 'race:rival')
    ana.emit('race:telemetry', medicao(code, 'ana', 100))
    await primeira

    const segunda = waitFor<Rival>(beto, 'race:rival')
    await new Promise((resolve) => setTimeout(resolve, 60))
    ana.emit('race:telemetry', medicao(code, 'ana', 4_700))

    expect((await segunda).progress).toBeLessThan(200)
  })

  it('ignora telemetria enviada antes da largada', async () => {
    const { ana, beto, code } = await gridCompleto()
    let recebeu = false
    beto.on('race:rival', () => {
      recebeu = true
    })

    ana.emit('race:telemetry', medicao(code, 'ana', 500))
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(recebeu).toBe(false)
  })

  it('entrega a última posição do rival a quem reconecta durante a corrida', async () => {
    const { ana, beto, code } = await emCorrida()
    const recebida = waitFor<Rival>(beto, 'race:rival')
    ana.emit('race:telemetry', medicao(code, 'ana', 1_250))
    await recebida

    beto.disconnect()
    const betoDeVolta = await connect()
    const fantasma = waitFor<Rival>(betoDeVolta, 'race:rival')
    await ask<RoomAck>(betoDeVolta, 'room:join', { code, name: 'Beto', playerId: 'beto' })

    expect((await fantasma).progress).toBe(1_250)
  })
})

describe('perda momentânea de conexão pelo socket', () => {
  it('cancela a contagem e mantém a vaga quando o rival cai', async () => {
    const { ana, beto, code } = await gridCompleto()
    const agendada = waitFor<Scheduled>(ana, 'race:scheduled')
    ana.emit('room:set-ready', { code, playerId: 'ana', ready: true })
    beto.emit('room:set-ready', { code, playerId: 'beto', ready: true })
    await agendada

    const cancelada = waitFor<{ reason: string }>(ana, 'race:cancelled')
    const semSinal = waitForRoom(ana, (room) => room.players.some((player) => !player.connected))
    beto.disconnect()

    expect((await cancelada).reason).toContain('conexão')
    const sala = await semSinal
    expect(sala.players).toHaveLength(2)
    expect(sala.status).toBe('waiting')
  })

  it('a volta rápida do piloto não cria um terceiro carro', async () => {
    const { ana, beto, code } = await gridCompleto()
    const semSinal = waitForRoom(ana, (room) => room.players.some((player) => !player.connected))
    beto.disconnect()
    await semSinal

    const betoDeVolta = await connect()
    const resposta = await ask<RoomAck>(betoDeVolta, 'room:join', { code, name: 'Beto', playerId: 'beto' })

    expect(resposta.ok).toBe(true)
    expect(resposta.room?.players).toHaveLength(2)
    expect(resposta.room?.players.every((player) => player.connected)).toBe(true)

    // A janela de retorno expira sem remover quem já voltou.
    await new Promise((resolve) => setTimeout(resolve, GRACE_MS + 200))
    expect(server.rooms.get(code)?.players).toHaveLength(2)
  })

  it('libera a vaga de quem não volta dentro da janela', async () => {
    const { ana, beto, code } = await gridCompleto()
    const sozinha = waitForRoom(ana, (room) => room.players.length === 1, 3_000)
    beto.disconnect()
    expect((await sozinha).players.map((player) => player.name)).toEqual(['Ana'])
    expect(server.rooms.get(code)?.players).toHaveLength(1)
  })

  it('devolve o instante oficial para quem volta durante a corrida', async () => {
    const { ana, beto, code } = await gridCompleto()
    const agendada = waitFor<Scheduled>(ana, 'race:scheduled')
    ana.emit('room:set-ready', { code, playerId: 'ana', ready: true })
    beto.emit('room:set-ready', { code, playerId: 'beto', ready: true })
    const { startAt } = await agendada

    await waitForRoom(ana, (room) => room.status === 'racing')
    beto.disconnect()

    const betoDeVolta = await connect()
    const reagendada = waitFor<Scheduled>(betoDeVolta, 'race:scheduled')
    const resposta = await ask<RoomAck>(betoDeVolta, 'room:join', { code, name: 'Beto', playerId: 'beto' })

    expect(resposta.room?.status).toBe('racing')
    expect((await reagendada).startAt).toBe(startAt)
  })
})
