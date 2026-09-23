import type { AddressInfo } from 'node:net'
import { io as connectClient, type Socket } from 'socket.io-client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createGameServer, type GameServer } from './app.js'
import type { PublicRoom } from './rooms.js'
import { GhostTracker, INTERPOLATION_DELAY_MS, type GhostSnapshot } from '../src/game/ghost.js'

/**
 * Teste de ponta a ponta do carro fantasma.
 *
 * Um piloto corre em ritmo conhecido e envia telemetria pelo servidor real.
 * O outro alimenta o mesmo `GhostTracker` usado pelo navegador e amostra a
 * posição quadro a quadro. Comparamos o que apareceria na tela com a posição
 * verdadeira do rival.
 */

const COUNTDOWN_MS = 300
const RIVAL_SPEED_KMH = 252
const RIVAL_SPEED_MS = RIVAL_SPEED_KMH / 3.6

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

function waitForRoom(client: Socket, matches: (room: PublicRoom) => boolean, timeout = 4_000) {
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

/** Posição verdadeira do rival em um instante, pelo ritmo combinado. */
const trueProgress = (t: number, startAt: number) => Math.max(0, ((t - startAt) / 1000) * RIVAL_SPEED_MS)

beforeEach(async () => {
  server = createGameServer({ countdownMs: COUNTDOWN_MS, graceMs: 30_000, serveStatic: false })
  await new Promise<void>((resolve) => server.http.listen(0, resolve))
  port = (server.http.address() as AddressInfo).port
})

afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect()
  await server.close()
})

type Corrida = {
  erroMaximo: number
  maiorRitmo: number
  recuos: number
  amostras: number
  pacotesEnviados: number
}

/**
 * Corre por alguns segundos e devolve a qualidade do fantasma.
 * `atrasarPacote` permite simular rede ruim.
 */
async function medirFantasma(options: {
  duracaoMs: number
  atrasarPacote?: (indice: number) => number
  perderPacote?: (indice: number) => boolean
}): Promise<Corrida> {
  const corredor = await connect()
  const observador = await connect()

  const criada = await ask<{ ok: boolean; room?: PublicRoom }>(corredor, 'room:create', {
    name: 'Corredor',
    playerId: 'corredor',
  })
  const code = criada.room!.code
  await ask(observador, 'room:join', { code, name: 'Observador', playerId: 'observador' })

  const correndo = waitForRoom(observador, (room) => room.status === 'racing')
  corredor.emit('room:set-ready', { code, playerId: 'corredor', ready: true })
  observador.emit('room:set-ready', { code, playerId: 'observador', ready: true })
  const sala = await correndo
  const startAt = sala.startAt!

  const tracker = new GhostTracker()
  observador.on('race:rival', (payload: GhostSnapshot) => tracker.push(payload))

  let pacotesEnviados = 0
  let indice = 0
  const enviar = () => {
    const t = Date.now()
    if (t < startAt) return
    const atual = indice
    indice += 1
    if (options.perderPacote?.(atual)) return

    const pacote = {
      code,
      playerId: 'corredor',
      t,
      progress: trueProgress(t, startAt),
      lateral: Math.sin((t - startAt) / 900) * 0.5,
      speed: RIVAL_SPEED_KMH,
      state: 'racing' as const,
    }
    pacotesEnviados += 1
    const atraso = options.atrasarPacote?.(atual) ?? 0
    if (atraso > 0) setTimeout(() => corredor.emit('race:telemetry', pacote), atraso)
    else corredor.emit('race:telemetry', pacote)
  }

  const envio = setInterval(enviar, 100)

  let erroMaximo = 0
  let maiorRitmo = 0
  let recuos = 0
  let amostras = 0
  let anterior: { progress: number; t: number } | null = null

  const observar = setInterval(() => {
    const agora = Date.now()
    const amostra = tracker.sample(agora)
    if (!amostra) return
    amostras += 1

    // O fantasma é desenhado de propósito um pouco no passado.
    const esperado = trueProgress(agora - INTERPOLATION_DELAY_MS, startAt)
    erroMaximo = Math.max(erroMaximo, Math.abs(amostra.progress - esperado))

    if (anterior !== null) {
      if (amostra.progress < anterior.progress) recuos += 1
      // O salto é medido como ritmo, em metros por segundo, e não em metros
      // por amostra. `setInterval` não entrega 16 ms constantes — no Windows
      // passa de 40 ms sob carga — e medir metros por amostra transformava
      // atraso do temporizador em "salto do fantasma", reprovando o teste em
      // uma execução a cada três sem nada de errado com o fantasma.
      const intervalo = (agora - anterior.t) / 1000
      if (intervalo > 0) maiorRitmo = Math.max(maiorRitmo, (amostra.progress - anterior.progress) / intervalo)
    }
    anterior = { progress: amostra.progress, t: agora }
  }, 16)

  await new Promise((resolve) => setTimeout(resolve, options.duracaoMs))
  clearInterval(envio)
  clearInterval(observar)

  return { erroMaximo, maiorRitmo, recuos, amostras, pacotesEnviados }
}

describe('estado do rival no fantasma', () => {
  it('a chegada do rival atravessa o servidor mesmo colada na última medição', async () => {
    const corredor = await connect()
    const observador = await connect()

    const criada = await ask<{ ok: boolean; room?: PublicRoom }>(corredor, 'room:create', {
      name: 'Corredor',
      playerId: 'corredor',
    })
    const code = criada.room!.code
    await ask(observador, 'room:join', { code, name: 'Observador', playerId: 'observador' })

    const correndo = waitForRoom(observador, (room) => room.status === 'racing')
    corredor.emit('room:set-ready', { code, playerId: 'corredor', ready: true })
    observador.emit('room:set-ready', { code, playerId: 'observador', ready: true })
    await correndo

    const tracker = new GhostTracker()
    observador.on('race:rival', (payload: GhostSnapshot) => tracker.push(payload))

    // O cliente manda a medição periódica e, no mesmo quadro, a chegada:
    // os dois pacotes saem com o mesmo horário e a mesma posição.
    const t = Date.now()
    const base = { code, playerId: 'corredor', lateral: 0, progress: 4_800 }
    corredor.emit('race:telemetry', { ...base, t, speed: 252, state: 'racing' })
    corredor.emit('race:telemetry', { ...base, t, speed: 0, state: 'finished' })

    await new Promise((resolve) => setTimeout(resolve, 400))
    const amostra = tracker.sample(Date.now())
    expect(amostra?.state).toBe('finished')
    expect(amostra?.progress).toBe(4_800)
  }, 15_000)

  it('aceita o salto normal entre duas medições consecutivas', async () => {
    const corredor = await connect()
    const observador = await connect()

    const criada = await ask<{ ok: boolean; room?: PublicRoom }>(corredor, 'room:create', {
      name: 'Corredor',
      playerId: 'corredor',
    })
    const code = criada.room!.code
    await ask(observador, 'room:join', { code, name: 'Observador', playerId: 'observador' })

    const correndo = waitForRoom(observador, (room) => room.status === 'racing')
    corredor.emit('room:set-ready', { code, playerId: 'corredor', ready: true })
    observador.emit('room:set-ready', { code, playerId: 'observador', ready: true })
    await correndo

    const recebidos: GhostSnapshot[] = []
    observador.on('race:rival', (payload: GhostSnapshot) => recebidos.push(payload))

    // Em 100 ms a 314 km/h o carro anda 8,7 m: precisa passar inteiro.
    const base = { code, playerId: 'corredor', lateral: 0, speed: 314, state: 'racing' as const }
    corredor.emit('race:telemetry', { ...base, t: Date.now(), progress: 1_000 })
    await new Promise((resolve) => setTimeout(resolve, 120))
    corredor.emit('race:telemetry', { ...base, t: Date.now(), progress: 1_008.7 })
    await new Promise((resolve) => setTimeout(resolve, 250))

    expect(recebidos).toHaveLength(2)
    expect(recebidos[1].progress).toBeCloseTo(1_008.7, 5)
  }, 15_000)

  it('quem chegou não continua avançando na tela do rival', async () => {
    const tracker = new GhostTracker()
    tracker.push({ t: 1_000, progress: 4_800, lateral: 0, speed: 0, state: 'finished' })
    const depois = tracker.sample(1_000 + INTERPOLATION_DELAY_MS + 5_000)
    expect(depois?.progress).toBe(4_800)
  })
})

describe('o fantasma acompanha o progresso real do rival', () => {
  it('segue a posição verdadeira com rede boa', async () => {
    const corrida = await medirFantasma({ duracaoMs: 3_000 })

    expect(corrida.amostras).toBeGreaterThan(80)
    expect(corrida.pacotesEnviados).toBeGreaterThan(20)
    // Projetado até o presente, o fantasma fica a poucos metros de onde o
    // rival está de fato — antes, desenhado no passado, eram até 12 m.
    expect(corrida.erroMaximo).toBeLessThan(4)
    expect(corrida.recuos).toBe(0)
    // O fantasma nunca pode avançar visivelmente mais rápido do que o carro
    // do rival de fato anda. Medido como ritmo, o valor é o próprio
    // RIVAL_SPEED_MS, então a margem aqui é estreita de propósito.
    expect(corrida.maiorRitmo).toBeLessThan(RIVAL_SPEED_MS * 1.2)
  }, 15_000)

  it('não dá saltos com pacotes chegando fora de ordem', async () => {
    // Um a cada três pacotes chega 180 ms atrasado, depois do seguinte.
    const corrida = await medirFantasma({
      duracaoMs: 3_000,
      atrasarPacote: (indice) => (indice % 3 === 0 ? 180 : 0),
    })

    expect(corrida.recuos).toBe(0)
    // Com a rede degradada a correção pode adiantar o fantasma por um
    // instante; o que não pode é ele dar um salto visível na tela.
    expect(corrida.maiorRitmo).toBeLessThan(RIVAL_SPEED_MS * 1.6)
    expect(corrida.erroMaximo).toBeLessThan(8)
  }, 15_000)

  it('com a rede lenta, continua onde o rival está, e não onde ele estava', async () => {
    // Todo pacote leva 120 ms a mais. Desenhado no passado, o fantasma ficava
    // uns 20 m atrás do carro de verdade durante a prova inteira.
    const corrida = await medirFantasma({ duracaoMs: 3_000, atrasarPacote: () => 120 })

    expect(corrida.recuos).toBe(0)
    expect(corrida.maiorRitmo).toBeLessThan(RIVAL_SPEED_MS * 1.2)
    expect(corrida.erroMaximo).toBeLessThan(4)
  }, 15_000)

  it('atravessa perdas de pacote sem travar nem saltar', async () => {
    // Perde três pacotes seguidos a cada dez: 300 ms sem notícias do rival.
    const corrida = await medirFantasma({
      duracaoMs: 4_000,
      perderPacote: (indice) => indice % 10 < 3,
    })

    expect(corrida.recuos).toBe(0)
    expect(corrida.maiorRitmo).toBeLessThan(RIVAL_SPEED_MS * 1.6)
    expect(corrida.erroMaximo).toBeLessThan(8)
  }, 15_000)
})
