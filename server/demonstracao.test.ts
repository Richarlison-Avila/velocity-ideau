import type { AddressInfo } from 'node:net'
import { io as connectClient, type Socket } from 'socket.io-client'
import { afterEach, describe, expect, it } from 'vitest'
import { createGameServer, type GameServer } from './app.js'
import type { PublicRoom, RaceOutcome } from './rooms.js'
import { GhostTracker, INTERPOLATION_DELAY_MS, type GhostSnapshot } from '../src/game/ghost.js'
import { noLimiteDoAsfalto, segurandoAFaixa, type Piloto } from '../src/game/piloto.js'
import { createRaceState, stepRace } from '../src/game/simulation.js'
import { TRACK_LENGTH } from '../src/game/track.js'

/**
 * Aceitação do MVP: o roteiro da demonstração do workshop, de ponta a ponta.
 *
 * Usa a física de verdade do jogo, o servidor de verdade e dois clientes
 * Socket.IO, cobrindo os critérios finais da seção 16 do plano. Rodar este
 * teste na véspera do evento diz se o caminho inteiro da apresentação está de
 * pé — da entrada na sala até a revanche.
 *
 * As corridas duram mais de um minuto, então são simuladas fora do relógio e
 * a largada oficial é colocada no passado. O que passa pela rede é o mesmo
 * protocolo que o navegador usa.
 */

/**
 * Os dois pilotos da demonstração.
 *
 * Desde que a curva empurra o carro, uma corrida sem ninguém no volante
 * termina na grama e não representa a prova que o público vai ver. O piloto
 * atento com boost faz o papel de quem já pegou o jeito; o que só corrige na
 * borda do asfalto faz o papel do visitante que pegou o celular agora.
 */
const ATENTO_COM_BOOST: Piloto = segurandoAFaixa(0, true)
const INICIANTE: Piloto = noLimiteDoAsfalto()

let server: GameServer
let port = 0
const clients: Socket[] = []

type Corrida = { tempo: number; topSpeed: number; colisoes: number }

/** Roda uma prova inteira com a física do jogo e devolve o desempenho. */
function correr(piloto: Piloto): Corrida {
  const state = createRaceState()
  let tempo = 0
  while (!state.finished && tempo < 300) {
    stepRace(state, piloto(state), 1 / 60)
    tempo += 1 / 60
  }
  return { tempo, topSpeed: state.topSpeed, colisoes: state.collisions }
}

async function subirServidor(countdownMs: number) {
  server = createGameServer({ countdownMs, graceMs: 30_000, serveStatic: false, openRooms: ['DEMO1'] })
  await new Promise<void>((resolve) => server.http.listen(0, resolve))
  port = (server.http.address() as AddressInfo).port
}

function conectar() {
  return new Promise<Socket>((resolve, reject) => {
    const client = connectClient(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true })
    clients.push(client)
    client.on('connect', () => resolve(client))
    client.on('connect_error', reject)
  })
}

function perguntar<T>(client: Socket, event: string, payload?: unknown) {
  return new Promise<T>((resolve) => client.emit(event, payload, resolve))
}

function esperarEvento<T>(client: Socket, event: string, timeout = 8_000) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`o evento "${event}" não chegou`)), timeout)
    client.once(event, (payload: T) => {
      clearTimeout(timer)
      resolve(payload)
    })
  })
}

function esperarSala(client: Socket, combina: (room: PublicRoom) => boolean, timeout = 8_000) {
  return new Promise<PublicRoom>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('a sala não atingiu o estado esperado')), timeout)
    const handler = (room: PublicRoom) => {
      if (!combina(room)) return
      clearTimeout(timer)
      client.off('room:update', handler)
      resolve(room)
    }
    client.on('room:update', handler)
  })
}

const dormir = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))

afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect()
  await server?.close()
})

describe('roteiro da demonstração', () => {
  it('duas pessoas entram na mesma sala, correm, veem o mesmo vencedor e jogam de novo', async () => {
    // Passo 0: as duas provas, com a física real do jogo.
    const rapido = correr(ATENTO_COM_BOOST)
    const lento = correr(INICIANTE)
    const diferenca = lento.tempo - rapido.tempo

    // O plano pede provas de 60 a 90 segundos.
    expect(rapido.tempo).toBeGreaterThan(60)
    expect(lento.tempo).toBeLessThan(90)
    expect(diferenca).toBeGreaterThan(1)

    // A largada fica no passado para a prova já poder ser concluída.
    await subirServidor(-(rapido.tempo * 1_000 + 300))

    // Passo 1 e 2: os dois pilotos entram na sala de demonstração.
    const ana = await conectar()
    const beto = await conectar()
    await perguntar(ana, 'room:join', { code: 'DEMO1', name: 'Ana', playerId: 'ana' })
    const grid = await perguntar<{ ok: boolean; room?: PublicRoom }>(beto, 'room:join', {
      code: 'DEMO1',
      name: 'Beto',
      playerId: 'beto',
    })
    expect(grid.room?.players.map((player) => player.name)).toEqual(['Ana', 'Beto'])

    // Passo 3: os dois confirmam e recebem a mesma largada.
    const agendadaParaAna = esperarEvento<{ startAt: number }>(ana, 'race:scheduled')
    const agendadaParaBeto = esperarEvento<{ startAt: number }>(beto, 'race:scheduled')
    const correndo = esperarSala(ana, (room) => room.status === 'racing')
    ana.emit('room:set-ready', { code: 'DEMO1', playerId: 'ana', ready: true })
    beto.emit('room:set-ready', { code: 'DEMO1', playerId: 'beto', ready: true })

    const [paraAna, paraBeto] = await Promise.all([agendadaParaAna, agendadaParaBeto])
    expect(paraAna.startAt).toBe(paraBeto.startAt)
    await correndo
    const startAt = paraAna.startAt

    // Passo 4: cada um enxerga o adversário como fantasma.
    const fantasmaDaAna = new GhostTracker()
    ana.on('race:rival', (payload: GhostSnapshot) => fantasmaDaAna.push(payload))

    const chegouTelemetria = esperarEvento<GhostSnapshot>(ana, 'race:rival')
    beto.emit('race:telemetry', {
      code: 'DEMO1',
      playerId: 'beto',
      t: Date.now(),
      progress: 1_200,
      lateral: 0.3,
      speed: 252,
      state: 'racing',
    })
    await chegouTelemetria

    // O fantasma é desenhado um pouco no passado e projeta poucos milímetros
    // à frente entre uma medição e outra, então a comparação tem folga.
    const visto = fantasmaDaAna.sample(Date.now() + INTERPOLATION_DELAY_MS)
    expect(visto?.progress).toBeCloseTo(1_200, 0)
    expect(visto?.lateral).toBeCloseTo(0.3, 5)

    // Passo 5: cada piloto avisa a chegada no instante em que cruza a linha.
    ana.emit('race:finish', {
      code: 'DEMO1',
      playerId: 'ana',
      time: rapido.tempo,
      topSpeed: rapido.topSpeed,
      collisions: rapido.colisoes,
    })

    const resultadoDaAna = esperarEvento<RaceOutcome>(ana, 'race:result', 20_000)
    const resultadoDoBeto = esperarEvento<RaceOutcome>(beto, 'race:result', 20_000)

    await dormir(startAt + lento.tempo * 1_000 + 300 - Date.now())
    beto.emit('race:finish', {
      code: 'DEMO1',
      playerId: 'beto',
      time: lento.tempo,
      topSpeed: lento.topSpeed,
      collisions: lento.colisoes,
    })

    // Passo 6: o mesmo resultado nas duas telas.
    const [oficialDaAna, oficialDoBeto] = await Promise.all([resultadoDaAna, resultadoDoBeto])
    expect(oficialDaAna).toEqual(oficialDoBeto)
    expect(oficialDaAna.winnerId).toBe('ana')
    expect(oficialDaAna.reason).toBe('time')
    expect(oficialDaAna.entries.map((entry) => entry.playerId)).toEqual(['ana', 'beto'])

    const tempoDaAna = oficialDaAna.entries[0].time!
    const tempoDoBeto = oficialDaAna.entries[1].time!
    expect(tempoDaAna).toBeCloseTo(rapido.tempo, 0)
    expect(tempoDoBeto).toBeCloseTo(lento.tempo, 0)
    expect(oficialDaAna.gap!).toBeCloseTo(diferenca, 0)

    // Passo 7: revanche na mesma sala, sem ninguém recarregar a página.
    const novaLargada = esperarEvento<{ startAt: number }>(ana, 'race:scheduled')
    ana.emit('race:rematch', { code: 'DEMO1', playerId: 'ana' })
    beto.emit('race:rematch', { code: 'DEMO1', playerId: 'beto' })

    const revanche = await novaLargada
    expect(revanche.startAt).not.toBe(startAt)
    expect(server.rooms.get('DEMO1')?.players.every((player) => !player.finished)).toBe(true)
    expect(server.rooms.outcomeFor('DEMO1')).toBeNull()
  }, 60_000)

  it('a prova tem o comprimento previsto no plano', () => {
    const iniciante = correr(INICIANTE)
    expect(TRACK_LENGTH).toBe(4_800)
    // Sessenta a noventa segundos, como pede a seção 3 do plano.
    expect(iniciante.tempo).toBeGreaterThan(60)
    expect(iniciante.tempo).toBeLessThan(90)
    // E um iniciante que não desvia de nada ainda consegue terminar.
    expect(iniciante.colisoes).toBeGreaterThan(0)
  })
})
