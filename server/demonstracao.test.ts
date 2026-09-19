import type { AddressInfo } from 'node:net'
import { io as connectClient, type Socket } from 'socket.io-client'
import { afterEach, describe, expect, it } from 'vitest'
import { createGameServer, type GameServer } from './app.js'
import type { PublicRoom, RaceOutcome } from './rooms.js'
import { GhostTracker, INTERPOLATION_DELAY_MS, type GhostSnapshot } from '../src/game/ghost.js'
import { createTrackLayout, curvatureLoad } from '../src/game/layout.js'
import { noLimiteDoAsfalto, segurandoAFaixa, type Piloto } from '../src/game/piloto.js'
import { DIFFICULTIES, type Difficulty } from '../src/game/rules.js'
import { createRaceState, stepRace, type RaceContext } from '../src/game/simulation.js'
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
 * Desde que a curva empurra o carro, uma prova sem ninguém no volante termina
 * na grama e não representa o que o público vai ver. O piloto atento com boost
 * faz o papel de quem já pegou o jeito; o que corrige só na borda do asfalto
 * faz o papel do visitante que pegou o celular agora — e é ele que define o
 * piso: se este completa a prova no tempo previsto, qualquer pessoa completa.
 */
const ATENTO_COM_BOOST: Piloto = segurandoAFaixa(0, true)
const INICIANTE: Piloto = noLimiteDoAsfalto()

let server: GameServer
let port = 0
const clients: Socket[] = []

type Corrida = { tempo: number; topSpeed: number; colisoes: number; foraDaPista: number }

/** Semente usada nas provas simuladas deste arquivo. */
const SEMENTE_DA_DEMO = 20_250

/**
 * Roda uma prova inteira com a física do jogo e devolve o desempenho.
 *
 * Corre numa pista gerada de verdade, e não na pista reta que o contexto
 * padrão representa: é a curva que decide se o tempo de prova previsto no
 * plano continua valendo, e a demonstração do evento não acontece numa reta.
 */
function correr(piloto: Piloto, difficulty: Difficulty = 'normal', semente = SEMENTE_DA_DEMO): Corrida {
  const layout = createTrackLayout(semente)
  const state = createRaceState(difficulty)
  const context: RaceContext = { curvature: 0, slipstream: 0 }
  let tempo = 0
  let quadrosForaDaPista = 0
  let quadros = 0
  while (!state.finished && tempo < 300) {
    context.curvature = curvatureLoad(layout.curvature(state.progress))
    stepRace(state, piloto(state), 1 / 60, context)
    tempo += 1 / 60
    quadros += 1
    if (state.offRoad) quadrosForaDaPista += 1
  }
  return {
    tempo,
    topSpeed: state.topSpeed,
    colisoes: state.collisions,
    foraDaPista: quadrosForaDaPista / Math.max(1, quadros),
  }
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

  /**
   * A curva entrou na física e o traçado é sorteado por corrida, então o tempo
   * de prova passou a depender da semente. Esta é a garantia que impede uma
   * pista sorteada de estourar a janela do plano — ou de deixar a demonstração
   * curta demais — em qualquer nível.
   */
  it('cabe na janela do plano em qualquer semente e qualquer nível', () => {
    for (const nivel of DIFFICULTIES) {
      for (const semente of [1, 7, 42, 20_250, 99_999]) {
        const prova = correr(INICIANTE, nivel, semente)
        expect(
          prova.tempo,
          `nível ${nivel}, semente ${semente}: ${prova.tempo.toFixed(1)} s`,
        ).toBeGreaterThan(60)
        expect(
          prova.tempo,
          `nível ${nivel}, semente ${semente}: ${prova.tempo.toFixed(1)} s`,
        ).toBeLessThan(90)
        // Quem corrige na borda não deve passar a prova na grama: se isto
        // falhar, a força da curva está cobrando mais do que o esterço paga.
        expect(prova.foraDaPista, `nível ${nivel}, semente ${semente}`).toBeLessThan(0.1)
      }
    }
  })

  /**
   * A curva age na prova inteira, e não só num trecho escolhido.
   *
   * Não se mede isso pelo tempo: um piloto que só segura o meio tem esterço
   * sobrando e corrige a curva sem perder quase nada — a força cobra margem de
   * comando, não segundos. O que se mede é o deslocamento: pedindo o centro da
   * pista, o carro fica mais longe do centro num traçado com curvas do que num
   * traçado reto. Se isto parar de valer, a curva voltou a ser enfeite.
   */
  it('a curva desloca o carro de onde o piloto aponta', () => {
    const desvioMedio = (comCurva: boolean, semente: number) => {
      const layout = createTrackLayout(semente)
      const state = createRaceState()
      const context: RaceContext = { curvature: 0, slipstream: 0 }
      const piloto = segurandoAFaixa(0)
      let soma = 0
      let quadros = 0
      while (!state.finished && quadros < 18_000) {
        context.curvature = comCurva ? curvatureLoad(layout.curvature(state.progress)) : 0
        stepRace(state, piloto(state), 1 / 60, context)
        soma += Math.abs(state.lateral)
        quadros += 1
      }
      return soma / quadros
    }

    for (const semente of [1, 7, 42, 20_250, 99_999]) {
      const reta = desvioMedio(false, semente)
      const curva = desvioMedio(true, semente)
      expect(curva, `semente ${semente}`).toBeGreaterThan(reta * 2)
    }
  })
})
