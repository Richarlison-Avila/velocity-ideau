import type { AddressInfo } from 'node:net'
import { io as connectClient, type Socket } from 'socket.io-client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CONTAGEM_DO_CONTRARRELOGIO_MS, diaDe, DIFICULDADE_OFICIAL, sementeDoDia } from '../src/game/contrarrelogio.js'
import { correrSemTela } from '../src/game/corridaSimulada.js'
import { GravadorDeVolta } from '../src/game/gravador.js'
import { desviando } from '../src/game/piloto.js'
import { GravadorDeEntradas, quantizarPasso } from '../src/game/registroDeEntradas.js'
import type { RaceInput } from '../src/game/simulation.js'
import { createGameServer, type GameServer } from './app.js'
import type { PublicRoom } from './rooms.js'

/**
 * Integridade pelo socket: quem fala por quem, e o caminho do perfil e da
 * Pista do Dia de ponta a ponta.
 */

const COUNTDOWN_MS = 200
const AGORA_INICIAL = Date.parse('2026-09-23T18:00:00Z')

type Resposta = { ok: boolean; error?: string } & Record<string, unknown>

let server: GameServer
let port = 0
let agora = AGORA_INICIAL
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

beforeEach(async () => {
  agora = AGORA_INICIAL
  server = createGameServer({ countdownMs: COUNTDOWN_MS, graceMs: 5_000, serveStatic: false, now: () => agora })
  await new Promise<void>((resolve) => server.http.listen(0, resolve))
  port = (server.http.address() as AddressInfo).port
})

afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect()
  await server.close()
})

describe('quem fala por quem', () => {
  it('uma conexão não confirma, desiste nem troca o carro em nome de outro piloto', async () => {
    const ana = await connect()
    const beto = await connect()
    const criada = await ask<{ ok: boolean; room: PublicRoom }>(ana, 'room:create', { name: 'Ana', playerId: 'ana' })
    const code = criada.room.code
    await ask(beto, 'room:join', { code, name: 'Beto', playerId: 'beto' })

    const fingindo = await ask<Resposta>(beto, 'room:set-ready', { code, playerId: 'ana', ready: true })
    expect(fingindo.ok).toBe(false)
    expect(server.rooms.get(code)?.players.find((player) => player.id === 'ana')?.ready).toBe(false)

    const carro = await ask<Resposta>(beto, 'room:set-car', { code, playerId: 'ana', car: 'prost' })
    expect(carro.ok).toBe(false)

    // A própria confirmação continua funcionando.
    expect((await ask<Resposta>(beto, 'room:set-ready', { code, playerId: 'beto', ready: true })).ok).toBe(true)
  })

  it('durante a prova, telemetria e abandono em nome do rival são ignorados', async () => {
    const ana = await connect()
    const beto = await connect()
    const criada = await ask<{ ok: boolean; room: PublicRoom }>(ana, 'room:create', { name: 'Ana', playerId: 'ana' })
    const code = criada.room.code
    await ask(beto, 'room:join', { code, name: 'Beto', playerId: 'beto' })
    await ask(ana, 'room:set-ready', { code, playerId: 'ana', ready: true })
    await ask(beto, 'room:set-ready', { code, playerId: 'beto', ready: true })
    agora += COUNTDOWN_MS + 50
    await new Promise((resolve) => setTimeout(resolve, COUNTDOWN_MS + 150))
    expect(server.rooms.get(code)?.status).toBe('racing')

    beto.emit('race:abandon', { code, playerId: 'ana' })
    beto.emit('race:telemetry', { code, playerId: 'ana', t: agora, progress: 999, lateral: 0, speed: 200, state: 'racing' })
    const chegadaFalsa = await ask<Resposta>(beto, 'race:finish', { code, playerId: 'ana', time: 60, topSpeed: 300, collisions: 0 })
    expect(chegadaFalsa.ok).toBe(false)
    expect(server.rooms.outcomeFor(code)).toBeNull()
    expect(server.rooms.rivalTelemetries(code, 'beto')).toEqual([])
  })

  it('a chegada cedo demais é recusada com aviso, em vez de sumir calada', async () => {
    const ana = await connect()
    const beto = await connect()
    const criada = await ask<{ ok: boolean; room: PublicRoom }>(ana, 'room:create', { name: 'Ana', playerId: 'ana' })
    const code = criada.room.code
    await ask(beto, 'room:join', { code, name: 'Beto', playerId: 'beto' })
    await ask(ana, 'room:set-ready', { code, playerId: 'ana', ready: true })
    await ask(beto, 'room:set-ready', { code, playerId: 'beto', ready: true })
    agora += COUNTDOWN_MS + 50
    await new Promise((resolve) => setTimeout(resolve, COUNTDOWN_MS + 150))
    const cedo = await ask<Resposta>(ana, 'race:finish', { code, playerId: 'ana', time: 20, topSpeed: 300, collisions: 0 })
    expect(cedo.ok).toBe(false)
    expect(cedo.error).toContain('recusada')
  })
})

describe('perfil e Pista do Dia pelo socket', () => {
  it('cria o perfil, entra de novo com o segredo e recusa o segredo errado', async () => {
    const aparelho = await connect()
    const criado = await ask<Resposta>(aparelho, 'perfil:criar', { apelido: '  Ana   Paula da Silva Souza ' })
    expect(criado.ok).toBe(true)
    const perfil = criado.perfil as { id: string; apelido: string }
    expect(perfil.apelido).toBe('Ana Paula da Sil')
    expect(typeof criado.segredo).toBe('string')

    const outroAparelho = await connect()
    expect((await ask<Resposta>(outroAparelho, 'perfil:entrar', { id: perfil.id, segredo: criado.segredo })).ok).toBe(true)
    expect((await ask<Resposta>(outroAparelho, 'perfil:entrar', { id: perfil.id, segredo: 'chute' })).ok).toBe(false)
  })

  it('sem perfil não há tentativa; com perfil, a volta entra no quadro', async () => {
    const aparelho = await connect()
    expect((await ask<Resposta>(aparelho, 'tt:iniciar')).ok).toBe(false)
    await ask<Resposta>(aparelho, 'perfil:criar', { apelido: 'Ana' })

    const aberta = await ask<Resposta>(aparelho, 'tt:iniciar')
    expect(aberta.ok).toBe(true)
    expect(aberta.seed).toBe(sementeDoDia(diaDe(new Date(agora))))

    // A volta vai com os comandos de cada quadro, como o jogo manda: o servidor
    // a refaz com a mesma física antes de pôr no quadro.
    const passo = quantizarPasso(1 / 60)
    const gravador = new GravadorDeVolta()
    const entradas = new GravadorDeEntradas()
    let ultimo: RaceInput = { left: false, right: false, boost: false }
    const prova = correrSemTela(
      () => {
        const piloto = desviando(true)
        return (state) => (ultimo = piloto(state))
      },
      {
        seed: aberta.seed as number,
        difficulty: DIFICULDADE_OFICIAL,
        quadro: passo,
        aCadaQuadro: (state, _eventos, tempo) => {
          entradas.registrar(passo, ultimo)
          gravador.gravar(tempo * 1000, state)
        },
      },
    )
    agora += CONTAGEM_DO_CONTRARRELOGIO_MS + prova.tempo * 1000 + 200
    const veredito = await ask<Resposta>(aparelho, 'tt:terminar', {
      tentativa: aberta.tentativa,
      tempo: prova.tempo,
      gravacao: gravador.terminar(prova.tempo * 1000, prova.state),
      dispositivo: 'teclado',
      entradas: entradas.terminar(),
    })
    expect(veredito.ok).toBe(true)
    expect(veredito.estado).toBe('valido')

    const quadro = await ask<Resposta>(aparelho, 'tt:quadro')
    const conteudo = quadro.quadro as { linhas: Array<{ apelido: string }>; voce: { posicao: number } | null }
    expect(conteudo.linhas.map((linha) => linha.apelido)).toEqual(['Ana'])
    expect(conteudo.voce?.posicao).toBe(1)
  })
})
