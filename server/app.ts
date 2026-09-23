import { existsSync } from 'node:fs'
import { createServer, type Server as HttpServer } from 'node:http'
import { resolve } from 'node:path'
import express from 'express'
import { Server, type Socket } from 'socket.io'
import { DIFICULDADE_OFICIAL } from '../src/game/contrarrelogio.js'
import { toCarId } from '../src/game/cars.js'
import { duracaoDaGravacao, gravacaoValida, ReproducaoDeVolta, type GravacaoDeVolta } from '../src/game/gravador.js'
import { TRACK_LENGTH } from '../src/game/track.js'
import { PistaDoDia } from './contrarrelogio.js'
import { Copa, INTERVALO_ENTRE_RODADAS_MS, type OpcoesDaCopa, type ResultadoDaRodada } from './copa/copa.js'
import { RepositorioEmMemoria, type Repositorio } from './dados/index.js'
import { apelidoLimpo, hashDoSegredo, LimiteDePerfis, novoSegredo } from './perfis.js'
import { PoolDeSementes } from './ranqueada/pool.js'
import { Ranqueada } from './ranqueada/servico.js'
import {
  COUNTDOWN_MS,
  RECONNECT_GRACE_MS,
  RoomError,
  RoomStore,
  type FinishReport,
  type PublicRoom,
  type RaceOutcome,
  type Telemetry,
} from './rooms.js'

export type GameServerOptions = {
  countdownMs?: number
  graceMs?: number
  /** Serve o site construído quando a pasta dist existe. */
  serveStatic?: boolean
  /** Códigos de sala que se criam sozinhos, para a demonstração do workshop. */
  openRooms?: string[]
  /** Onde moram perfis e tempos. Sem ele, na memória: some quando o servidor para. */
  repositorio?: Repositorio
  /** Relógio da Pista do Dia e da ranqueada, para os testes controlarem o dia e a temporada. */
  now?: () => number
  /** Sorteio das pistas da ranqueada. Sem ele, o pool curado da semana. */
  sementesRanqueadas?: { sortear(): number }
  /** Quanto a fila espera encher uma sala antes de largar com quem tem. */
  esperaDaFila?: number
  /** Limite de tempo da prova ranqueada, depois da largada. */
  limiteDaRanqueadaMs?: number
  /** Quanto alguém espera sozinho na fila até correr contra fantasmas. */
  esperaComFantasmas?: number
  /** Horário e ritmo da Copa do Dia. Os testes a abrem agora, com rodadas curtas. */
  copa?: OpcoesDaCopa & { intervaloMs?: number }
}

export type GameServer = {
  http: HttpServer
  io: Server
  rooms: RoomStore
  repositorio: Repositorio
  pistaDoDia: PistaDoDia
  ranqueada: Ranqueada
  copa: Copa
  close: () => Promise<void>
}

/** Três minutos: o dobro da prova mais lenta que o plano admite. */
const LIMITE_DA_RANQUEADA_MS = 180_000

type Ack = (response: { ok: boolean; room?: PublicRoom | null; error?: string }) => void
/** Resposta genérica dos eventos de perfil e da Pista do Dia. */
type Resposta = (response: { ok: boolean; error?: string } & Record<string, unknown>) => void

/** O que o servidor sabe de cada conexão: quem ela é na sala e qual perfil a abriu. */
type DadosDoSocket = { playerId?: string; perfilId?: string }

/**
 * O piloto de uma mensagem precisa ser o da conexão que a enviou.
 *
 * Antes, cada evento confiava no `playerId` que vinha dentro dele, e qualquer
 * cliente podia enviar telemetria, chegada ou abandono em nome de outro. A
 * conexão ganha o piloto ao criar ou entrar numa sala — é ali que o servidor o
 * conhece —, e dali em diante só fala por ele.
 */
function falaPor(socket: Socket, playerId: unknown) {
  return typeof playerId === 'string' && (socket.data as DadosDoSocket).playerId === playerId
}

const RECUSADO = 'Esta conexão não fala por este piloto.'

export function createGameServer(options: GameServerOptions = {}): GameServer {
  const countdownMs = options.countdownMs ?? COUNTDOWN_MS
  const graceMs = options.graceMs ?? RECONNECT_GRACE_MS

  const app = express()
  const http = createServer(app)
  const io = new Server(http, { cors: { origin: true, credentials: true } })
  const rooms = new RoomStore({ countdownMs, openRooms: options.openRooms })
  const repositorio = options.repositorio ?? new RepositorioEmMemoria()
  const pistaDoDia = new PistaDoDia(repositorio, options.now)
  const limiteDePerfis = new LimiteDePerfis()
  const ranqueada = new Ranqueada(repositorio, {
    agora: options.now,
    esperaDaFila: options.esperaDaFila,
    esperaComFantasmas: options.esperaComFantasmas,
  })
  const copa = new Copa(repositorio, { agora: options.now, ...options.copa })
  const intervaloDaCopa = options.copa?.intervaloMs ?? INTERVALO_ENTRE_RODADAS_MS
  /** Timers entre uma rodada da copa e a próxima. */
  const copaTimers = new Set<NodeJS.Timeout>()
  const sementesRanqueadas = options.sementesRanqueadas ?? new PoolDeSementes(options.now)
  const limiteDaRanqueada = options.limiteDaRanqueadaMs ?? LIMITE_DA_RANQUEADA_MS
  /** Timers que encerram a prova ranqueada de quem não chegou a tempo. */
  const limiteTimers = new Map<string, NodeJS.Timeout>()
  /** As voltas que correm como fantasmas em cada sala ranqueada de quem ficou sozinho. */
  const fantasmasDaSala = new Map<string, Array<{ id: string; tempo: number; gravacao: GravacaoDeVolta; chegou: boolean }>>()
  /** Timers que reproduzem os fantasmas como telemetria. */
  const fantasmaTimers = new Map<string, NodeJS.Timeout>()
  /** Quem procurou fantasmas e não achou: tenta de novo mais tarde, e não a cada segundo. */
  const semFantasmasAte = new Map<string, number>()

  const pararFantasmas = (code: string) => {
    const timer = fantasmaTimers.get(code)
    if (timer) clearInterval(timer)
    fantasmaTimers.delete(code)
    fantasmasDaSala.delete(code)
  }

  /** Timers que disparam a largada no instante agendado, por sala. */
  const startTimers = new Map<string, NodeJS.Timeout>()
  /** Timers que removem quem não voltou depois da queda de conexão. */
  const graceTimers = new Map<string, NodeJS.Timeout>()

  app.get('/health', (_request, response) =>
    response.json({ ok: true, now: Date.now(), salasDemo: rooms.demoRooms }),
  )

  const graceKey = (code: string, playerId: string) => `${code}:${playerId}`

  const clearStartTimer = (code: string) => {
    const timer = startTimers.get(code)
    if (!timer) return
    clearTimeout(timer)
    startTimers.delete(code)
  }

  const publish = (code: string, room: PublicRoom | null) => {
    if (room) io.to(code).emit('room:update', room)
  }

  /**
   * Publica o resultado oficial e, na ranqueada, resolve MMR e PL de todos.
   *
   * O resultado ranqueado vai para a sala inteira, com o delta de cada piloto:
   * as mudanças opacas de rating do Mario Kart geraram revolta, e aqui cada um
   * vê quanto ganhou, quanto perdeu e contra quem.
   */
  const emitirResultado = (code: string, outcome: RaceOutcome) => {
    io.to(code).emit('race:result', outcome)
    pararFantasmas(code)
    const limite = limiteTimers.get(code)
    if (limite) {
      clearTimeout(limite)
      limiteTimers.delete(code)
    }
    if (copa.eDaCopa(code)) {
      void copa
        .resolverRodada(code, outcome)
        .then((rodada) => rodada && anunciarRodada(rodada))
        .catch((erro: unknown) => console.error('Copa:', erro instanceof Error ? erro.message : erro))
      return
    }
    if (!ranqueada.eRanqueada(code)) return
    const seed = rooms.get(code)?.trackSeed ?? 0
    void ranqueada
      .resolver(code, outcome, seed)
      .then((resultados) => {
        if (resultados.length > 0) io.to(code).emit('ranqueada:resultados', { code, resultados })
      })
      .catch((erro: unknown) => console.error('Ranqueada:', erro instanceof Error ? erro.message : erro))
  }

  /**
   * Guarda a volta de quem chegou numa corrida ranqueada, para virar fantasma
   * de quem ficar sozinho na fila. Só a volta que bate com o tempo oficial, e
   * com o MMR que o piloto tinha ao corrê-la.
   */
  const guardarVoltaRanqueada = (code: string, playerId: string, bruta: unknown) => {
    const perfilId = ranqueada.perfilNaSala(code, playerId)
    const sala = rooms.get(code)
    const chegada = rooms.chegadaDe(code, playerId)
    const gravacao = gravacaoValida(bruta)
    if (!perfilId || !sala || !chegada || chegada.time === null || !gravacao) return
    if (Math.abs(duracaoDaGravacao(gravacao) - chegada.time) > 0.6) return
    void ranqueada
      .estadoDe(perfilId)
      .then((estado) =>
        repositorio.registrarVoltaRanqueada({
          perfilId,
          seed: sala.trackSeed,
          dificuldade: sala.difficulty,
          tempo: chegada.time!,
          mmr: estado.mmr,
          carro: chegada.car,
          gravacao,
        }),
      )
      .catch((erro: unknown) => console.error('Volta ranqueada:', erro instanceof Error ? erro.message : erro))
  }

  /** A largada de uma sala ranqueada caiu: ninguém ganha nem perde PL, e quem desistiu espera. */
  const cancelarRanqueada = (code: string, quemDesistiu: string | undefined, motivo: string) => {
    if (!ranqueada.eRanqueada(code)) return
    if (quemDesistiu) ranqueada.desistiu(code, quemDesistiu)
    ranqueada.dissolver(code)
    pararFantasmas(code)
    io.to(code).emit('ranqueada:cancelada', { code, motivo })
  }

  /**
   * Conta à sala o que a rodada da copa decidiu e, se a divisão segue, marca
   * a próxima. Quem ganhou por desistência dos outros fica sabendo por conta
   * própria: a sala dele já não existe.
   */
  const anunciarRodada = (rodada: ResultadoDaRodada) => {
    const proximaEm = rodada.encerrada ? null : Date.now() + intervaloDaCopa
    const semPerfil = ({ playerId, nome, posicao, desistiu }: ResultadoDaRodada['eliminados'][number]) => ({ playerId, nome, posicao, desistiu })
    const aviso = {
      code: rodada.code,
      divisao: rodada.divisao,
      rodada: rodada.rodada,
      eliminados: rodada.eliminados.map(semPerfil),
      seguem: rodada.seguem,
      campeao: rodada.campeao ? semPerfil(rodada.campeao) : null,
      proximaEm,
    }
    if (rodada.code) io.to(rodada.code).emit('copa:rodada', aviso)
    else if (rodada.campeao) io.sockets.sockets.get(copa.conexaoDe(rodada.campeao.perfilId) ?? '')?.emit('copa:rodada', aviso)
    if (rodada.encerrada) return
    const timer = setTimeout(() => {
      copaTimers.delete(timer)
      void correrRodada(rodada.divisao).catch((erro: unknown) => console.error('Copa:', erro instanceof Error ? erro.message : erro))
    }, intervaloDaCopa)
    copaTimers.add(timer)
  }

  /**
   * Monta a sala da próxima rodada de uma divisão. Quem caiu ou pediu para
   * sair entre uma rodada e outra sai da copa, como quem abandona.
   */
  const correrRodada = async (numero: number) => {
    const { largam, saem } = copa.quemLarga(numero, (socketId) => io.sockets.sockets.has(socketId))
    if (saem.length > 0) {
      const rodada = await copa.desistiram(numero, saem.map((piloto) => piloto.playerId))
      if (rodada?.encerrada) return anunciarRodada(rodada)
    }
    if (largam.length < 2) return
    for (const piloto of largam) {
      // Da sala da rodada anterior, e da fila ranqueada: a copa não divide o piloto.
      ranqueada.sair(piloto.perfilId)
      const alvo = io.sockets.sockets.get(piloto.socketId)
      for (const update of rooms.leaveBySocket(piloto.socketId)) alvo?.leave(update.code)
    }
    const room = rooms.criarDaCopa(largam, DIFICULDADE_OFICIAL, copa.hoje().seed, { divisao: numero, rodada: copa.rodadaDa(numero) + 1 })
    copa.registrarSala(numero, room.code)
    for (const piloto of largam) {
      const alvo = io.sockets.sockets.get(piloto.socketId)!
      alvo.join(room.code)
      ;(alvo.data as DadosDoSocket).playerId = piloto.playerId
      alvo.emit('copa:partida', { room })
    }
    publish(room.code, room)
    scheduleIfReady(room.code)
  }

  /**
   * A largada de uma rodada da copa caiu antes de sair: quem saiu está fora,
   * e os outros largam de novo, numa sala nova.
   */
  const cancelarRodadaDaCopa = (code: string, quemSaiu: string | undefined) => {
    const numero = copa.soltarSala(code)
    if (numero === null) return
    void (async () => {
      if (quemSaiu) {
        const rodada = await copa.desistiram(numero, [quemSaiu])
        if (rodada?.encerrada) return anunciarRodada(rodada)
      }
      await correrRodada(numero)
    })().catch((erro: unknown) => console.error('Copa:', erro instanceof Error ? erro.message : erro))
  }

  /** Avisa quem está na fila de quantos esperam com ele. */
  const anunciarFila = () => {
    const fila = ranqueada.naFila()
    for (const entrada of fila) {
      io.sockets.sockets.get(entrada.socketId)?.emit('ranqueada:fila', { tamanho: fila.length, desde: entrada.desde })
    }
  }

  /**
   * O relógio da fila: a cada segundo, forma as salas que já podem largar. Cada
   * sala nasce com todos confirmados, no nível oficial, com a pista do pool, e
   * a largada sai sozinha.
   */
  /**
   * Quem ficou sozinho na fila corre contra fantasmas: voltas ranqueadas de
   * outros pilotos, na mesma pista, com o MMR congelado. É o que o Horizon
   * Chase 2 faz completando salas com IA — só que com voltas de gente de
   * verdade, e sem nenhum carro trapaceando para alcançar ninguém.
   */
  const montarSalaComFantasmas = async (sozinho: ReturnType<Ranqueada['solitarios']>[number]) => {
    const escolha = await ranqueada.fantasmasPara(sozinho.perfilId, sozinho.mu, DIFICULDADE_OFICIAL)
    const alvo = io.sockets.sockets.get(sozinho.socketId)
    if (!escolha || escolha.voltas.length === 0 || !alvo) return
    // Pode ter saído da fila, ou ganhado companhia, enquanto o banco respondia.
    if (!ranqueada.naFila().some((entrada) => entrada.perfilId === sozinho.perfilId)) return
    if (ranqueada.naFila().length > 1) return
    ranqueada.sair(sozinho.perfilId)
    const fantasmas = escolha.voltas.map((volta, i) => ({ id: `fantasma-${i + 1}-${volta.id.slice(0, 8)}`, volta }))
    const room = rooms.criarRanqueada(
      [{ socketId: sozinho.socketId, playerId: sozinho.playerId, nome: sozinho.nome, carro: sozinho.carro }],
      DIFICULDADE_OFICIAL,
      () => escolha.seed,
      fantasmas.map(({ id, volta }) => ({ id, nome: volta.apelido, carro: volta.carro })),
    )
    ranqueada.registrarSala(
      room.code,
      [sozinho],
      fantasmas.map(({ id, volta }) => ({ playerId: id, apelido: volta.apelido, mmr: volta.mmr })),
    )
    fantasmasDaSala.set(
      room.code,
      fantasmas.map(({ id, volta }) => ({ id, tempo: volta.tempo, gravacao: volta.gravacao, chegou: false })),
    )
    alvo.join(room.code)
    ;(alvo.data as DadosDoSocket).playerId = sozinho.playerId
    alvo.emit('ranqueada:partida', { room, contraFantasmas: true })
    publish(room.code, room)
    scheduleIfReady(room.code)
  }

  /** Reproduz as voltas dos fantasmas como telemetria, dez vezes por segundo, e marca a chegada de cada um. */
  const correrFantasmas = (code: string, startAt: number) => {
    const fantasmas = fantasmasDaSala.get(code)
    if (!fantasmas) return
    const reproducoes = new Map(fantasmas.map((fantasma) => [fantasma.id, new ReproducaoDeVolta(fantasma.gravacao, startAt)]))
    fantasmaTimers.set(
      code,
      setInterval(() => {
        const agora = Date.now()
        for (const fantasma of fantasmas) {
          if (fantasma.chegou) continue
          const amostra = reproducoes.get(fantasma.id)!.sample(agora)
          if (!amostra) continue
          const chegou = (agora - startAt) / 1000 >= fantasma.tempo
          const telemetria = {
            t: agora,
            progress: chegou ? TRACK_LENGTH : amostra.progress,
            lateral: amostra.lateral,
            speed: chegou ? 0 : amostra.speed,
            state: chegou ? ('finished' as const) : ('racing' as const),
          }
          if (rooms.telemetriaDoFantasma(code, fantasma.id, telemetria)) io.to(code).emit('race:rival', { playerId: fantasma.id, ...telemetria })
          if (!chegou) continue
          fantasma.chegou = true
          const chegada = rooms.registrarChegadaDoFantasma(code, fantasma.id, fantasma.tempo)
          if (!chegada) continue
          publish(code, chegada.room)
          if (chegada.outcome) emitirResultado(code, chegada.outcome)
        }
        if (fantasmas.every((fantasma) => fantasma.chegou) || rooms.get(code)?.status !== 'racing') pararFantasmas(code)
      }, 100),
    )
  }

  const relogioDaFila = setInterval(() => {
    for (const pilotos of ranqueada.formarSalas()) {
      const presentes = pilotos.filter((piloto) => io.sockets.sockets.has(piloto.socketId))
      if (presentes.length < 2) continue
      const room = rooms.criarRanqueada(
        presentes.map((piloto) => ({ socketId: piloto.socketId, playerId: piloto.playerId, nome: piloto.nome, carro: piloto.carro })),
        DIFICULDADE_OFICIAL,
        () => sementesRanqueadas.sortear(),
      )
      ranqueada.registrarSala(room.code, presentes)
      for (const piloto of presentes) {
        const alvo = io.sockets.sockets.get(piloto.socketId)!
        alvo.join(room.code)
        ;(alvo.data as DadosDoSocket).playerId = piloto.playerId
        alvo.emit('ranqueada:partida', { room })
      }
      publish(room.code, room)
      scheduleIfReady(room.code)
    }
    for (const sozinho of ranqueada.solitarios()) {
      if ((semFantasmasAte.get(sozinho.perfilId) ?? 0) > Date.now()) continue
      semFantasmasAte.set(sozinho.perfilId, Date.now() + 30_000)
      void montarSalaComFantasmas(sozinho).catch((erro: unknown) =>
        console.error('Fantasmas:', erro instanceof Error ? erro.message : erro),
      )
    }
    // A classificação da copa fechou: as divisões largam.
    if (copa.prontaParaApurar()) {
      for (const numero of copa.apurar((socketId) => io.sockets.sockets.has(socketId))) {
        void correrRodada(numero).catch((erro: unknown) => console.error('Copa:', erro instanceof Error ? erro.message : erro))
      }
    }
    anunciarFila()
  }, 1_000)

  /** Agenda a largada quando todos os pilotos presentes confirmam. */
  const scheduleIfReady = (code: string) => {
    if (rooms.get(code)?.status !== 'ready') return
    const scheduled = rooms.scheduleStart(code)
    if (!scheduled?.startAt) return

    clearStartTimer(code)
    publish(code, scheduled)
    io.to(code).emit('race:scheduled', {
      code,
      startAt: scheduled.startAt,
      countdownMs: scheduled.countdownMs,
      trackSeed: scheduled.trackSeed,
      difficulty: scheduled.difficulty,
      serverTime: Date.now(),
    })

    const delay = Math.max(0, scheduled.startAt - Date.now())
    startTimers.set(
      code,
      setTimeout(() => {
        startTimers.delete(code)
        const comecou = rooms.beginRace(code)
        publish(code, comecou)
        if (comecou?.startAt && fantasmasDaSala.has(code)) correrFantasmas(code, comecou.startAt)
        // Na ranqueada e na copa, a prova tem hora para acabar.
        if (ranqueada.eRanqueada(code) || copa.eDaCopa(code)) {
          limiteTimers.set(
            code,
            setTimeout(() => {
              limiteTimers.delete(code)
              const encerrada = rooms.encerrarPorTempo(code)
              if (!encerrada) return
              publish(code, encerrada.room)
              if (encerrada.outcome) emitirResultado(code, encerrada.outcome)
            }, limiteDaRanqueada),
          )
        }
      }, delay),
    )
  }

  io.on('connection', (socket) => {
    // Amostra de relógio: o cliente mede a ida e a volta e estima a diferença.
    socket.on(
      'time:sync',
      (payload: { clientSentAt?: number } | undefined, ack?: (response: { serverTime: number; clientSentAt: number | null }) => void) => {
        ack?.({ serverTime: Date.now(), clientSentAt: payload?.clientSentAt ?? null })
      },
    )

    socket.on('room:create', (payload: { name: string; playerId: string; car?: string }, ack: Ack) => {
      try {
        const room = rooms.create(socket.id, payload.playerId, payload.name, payload.car)
        ;(socket.data as DadosDoSocket).playerId = payload.playerId
        socket.join(room.code)
        ack({ ok: true, room })
      } catch {
        ack({ ok: false, error: 'Não foi possível criar a sala.' })
      }
    })

    socket.on('room:join', (payload: { code: string; name: string; playerId: string; car?: string }, ack: Ack) => {
      try {
        const room = rooms.join(payload.code, socket.id, payload.playerId, payload.name, payload.car)
        ;(socket.data as DadosDoSocket).playerId = payload.playerId
        socket.join(room.code)

        const key = graceKey(room.code, payload.playerId)
        const grace = graceTimers.get(key)
        if (grace) {
          clearTimeout(grace)
          graceTimers.delete(key)
        }

        ack({ ok: true, room })
        publish(room.code, room)

        // Quem volta durante a contagem ou a corrida recebe o instante oficial.
        if (room.startAt && (room.status === 'countdown' || room.status === 'racing')) {
          // A semente vai junto: quem volta precisa reconstruir exatamente a
          // mesma pista em que o rival continua correndo.
          socket.emit('race:scheduled', {
            code: room.code,
            startAt: room.startAt,
            countdownMs: room.countdownMs,
            trackSeed: room.trackSeed,
            difficulty: room.difficulty,
            serverTime: Date.now(),
          })
          // E também a última posição conhecida de cada rival, para todos os
          // fantasmas voltarem na hora.
          for (const rival of rooms.rivalTelemetries(room.code, payload.playerId)) {
            socket.emit('race:rival', rival)
          }
        }
      } catch (error) {
        ack({ ok: false, error: error instanceof RoomError ? error.message : 'Não foi possível entrar na sala.' })
      }
    })

    // Telemetria do piloto, repassada aos demais participantes da mesma sala.
    socket.on('race:telemetry', (payload: { code: string; playerId: string } & Telemetry) => {
      if (!falaPor(socket, payload?.playerId)) return
      const accepted = rooms.acceptTelemetry(payload.code, payload.playerId, payload)
      if (!accepted) return
      socket.to(payload.code.trim().toUpperCase()).emit('race:rival', { playerId: payload.playerId, ...accepted })
    })

    // Chegada: o servidor valida o tempo e só então fecha o resultado.
    socket.on('race:finish', (payload: { code: string; playerId: string; gravacao?: unknown } & FinishReport, ack?: Ack) => {
      if (!falaPor(socket, payload?.playerId)) return ack?.({ ok: false, error: RECUSADO })
      const registrada = rooms.recordFinish(payload.code, payload.playerId, payload)
      // Antes a chegada recusada sumia calada, e o cliente esperava o resultado
      // para sempre. Agora ele sabe.
      if (!registrada) return ack?.({ ok: false, error: 'Chegada recusada pelo servidor.' })
      guardarVoltaRanqueada(registrada.room.code, payload.playerId, payload.gravacao)
      ack?.({ ok: true, room: registrada.room })
      publish(registrada.room.code, registrada.room)
      if (registrada.outcome) emitirResultado(registrada.room.code, registrada.outcome)
    })

    // Desistir no meio da prova entrega a vitória ao adversário.
    socket.on('race:abandon', (payload: { code: string; playerId: string }) => {
      if (!falaPor(socket, payload?.playerId)) return
      const encerrada = rooms.abandonRace(payload.code, payload.playerId)
      if (!encerrada) return
      publish(encerrada.room.code, encerrada.room)
      if (encerrada.outcome) emitirResultado(encerrada.room.code, encerrada.outcome)
    })

    socket.on('race:rematch', (payload: { code: string; playerId: string }, ack?: Ack) => {
      if (!falaPor(socket, payload?.playerId)) return ack?.({ ok: false, error: RECUSADO })
      try {
        const room = rooms.requestRematch(payload.code, payload.playerId)
        ack?.({ ok: true, room })
        publish(room.code, room)
        scheduleIfReady(room.code)
      } catch (error) {
        ack?.({ ok: false, error: error instanceof RoomError ? error.message : 'Não foi possível pedir revanche.' })
      }
    })

    socket.on('room:set-difficulty', (payload: { code: string; playerId: string; difficulty: string }, ack?: Ack) => {
      if (!falaPor(socket, payload?.playerId)) return ack?.({ ok: false, error: RECUSADO })
      try {
        const room = rooms.setDifficulty(payload.code, payload.playerId, payload.difficulty)
        ack?.({ ok: true, room })
        publish(room.code, room)
      } catch (error) {
        ack?.({ ok: false, error: error instanceof RoomError ? error.message : 'Não foi possível trocar a dificuldade.' })
      }
    })

    socket.on('room:set-car', (payload: { code: string; playerId: string; car: string }, ack?: Ack) => {
      if (!falaPor(socket, payload?.playerId)) return ack?.({ ok: false, error: RECUSADO })
      try {
        const room = rooms.setCar(payload.code, payload.playerId, payload.car)
        ack?.({ ok: true, room })
        publish(room.code, room)
      } catch (error) {
        ack?.({ ok: false, error: error instanceof RoomError ? error.message : 'Não foi possível trocar o carro.' })
      }
    })

    socket.on('room:set-ready', (payload: { code: string; playerId: string; ready: boolean }, ack?: Ack) => {
      if (!falaPor(socket, payload?.playerId)) return ack?.({ ok: false, error: RECUSADO })
      if (rooms.get(payload.code)?.ranqueada) return ack?.({ ok: false, error: 'Na ranqueada a largada é automática.' })
      if (rooms.get(payload.code)?.copa) return ack?.({ ok: false, error: 'Na copa a largada é automática.' })
      try {
        const wasCountingDown = rooms.get(payload.code)?.status === 'countdown'
        const room = rooms.setReady(payload.code, payload.playerId, payload.ready)
        ack?.({ ok: true, room })

        if (wasCountingDown && room.status !== 'countdown') {
          clearStartTimer(room.code)
          io.to(room.code).emit('race:cancelled', { code: room.code, reason: 'Um piloto cancelou a confirmação.' })
        }
        publish(room.code, room)
        scheduleIfReady(room.code)
      } catch (error) {
        ack?.({ ok: false, error: error instanceof RoomError ? error.message : 'Não foi possível atualizar seu estado.' })
      }
    })

    // O anfitrião tira um piloto parado. Quem sai é avisado e deixa o canal da
    // sala; se os que ficaram já tinham confirmado, a largada sai na hora.
    socket.on('room:kick', (payload: { code: string; playerId: string; targetId: string }, ack?: Ack) => {
      if (!falaPor(socket, payload?.playerId)) return ack?.({ ok: false, error: RECUSADO })
      try {
        const update = rooms.kick(payload.code, payload.playerId, payload.targetId)
        const graceKeyDoAlvo = graceKey(update.code, payload.targetId)
        const grace = graceTimers.get(graceKeyDoAlvo)
        if (grace) {
          clearTimeout(grace)
          graceTimers.delete(graceKeyDoAlvo)
        }
        const alvo = io.sockets.sockets.get(update.socketId)
        if (alvo) {
          alvo.leave(update.code)
          alvo.emit('room:kicked', { code: update.code })
        }
        ack?.({ ok: true, room: update.room })
        publish(update.code, update.room)
        scheduleIfReady(update.code)
      } catch (error) {
        ack?.({ ok: false, error: error instanceof RoomError ? error.message : 'Não foi possível tirar o piloto.' })
      }
    })

    // Perfil leve: o servidor gera o segredo e guarda só o hash dele.
    socket.on('perfil:criar', async (payload: { apelido?: string } | undefined, ack?: Resposta) => {
      try {
        if (!limiteDePerfis.permitir(socket.handshake.address)) {
          return ack?.({ ok: false, error: 'Perfis demais criados desta rede. Tente de novo mais tarde.' })
        }
        const segredo = novoSegredo()
        const perfil = await repositorio.criarPerfil(apelidoLimpo(payload?.apelido), hashDoSegredo(segredo))
        ;(socket.data as DadosDoSocket).perfilId = perfil.id
        ack?.({ ok: true, perfil, segredo })
      } catch {
        ack?.({ ok: false, error: 'Não foi possível criar o perfil.' })
      }
    })

    socket.on('perfil:entrar', async (payload: { id?: string; segredo?: string } | undefined, ack?: Resposta) => {
      try {
        const id = typeof payload?.id === 'string' ? payload.id : ''
        const segredo = typeof payload?.segredo === 'string' ? payload.segredo : ''
        const perfil = id && segredo ? await repositorio.perfilPorCredencial(id, hashDoSegredo(segredo)) : null
        if (!perfil) return ack?.({ ok: false, error: 'Perfil não encontrado.' })
        ;(socket.data as DadosDoSocket).perfilId = perfil.id
        // Quem recarregou a página no meio da copa volta a ser chamado por esta conexão.
        copa.reconectar(perfil.id, socket.id)
        ack?.({ ok: true, perfil })
      } catch {
        ack?.({ ok: false, error: 'Não foi possível entrar no perfil.' })
      }
    })

    socket.on('perfil:apelido', async (payload: { apelido?: string } | undefined, ack?: Resposta) => {
      const perfilId = (socket.data as DadosDoSocket).perfilId
      if (!perfilId) return ack?.({ ok: false, error: 'Entre num perfil primeiro.' })
      try {
        const apelido = apelidoLimpo(payload?.apelido)
        await repositorio.renomearPerfil(perfilId, apelido)
        ack?.({ ok: true, apelido })
      } catch {
        ack?.({ ok: false, error: 'Não foi possível trocar o apelido.' })
      }
    })

    // Pista do Dia: o servidor marca a largada de cada tentativa e julga a volta.
    socket.on('tt:iniciar', (payload: { desafio?: string } | undefined, ack?: Resposta) => {
      const perfilId = (socket.data as DadosDoSocket).perfilId
      if (!perfilId) return ack?.({ ok: false, error: 'Entre num perfil primeiro.' })
      const aberta = pistaDoDia.iniciar(perfilId, payload?.desafio)
      if (!aberta) return ack?.({ ok: false, error: 'Esse desafio não é desta semana.' })
      ack?.({ ok: true, ...aberta })
    })

    // Os cinco desafios da semana, com o líder de cada um e a linha de quem pergunta.
    socket.on('tt:desafios', async (_payload: unknown, ack?: Resposta) => {
      try {
        ack?.({ ok: true, desafios: await pistaDoDia.desafios((socket.data as DadosDoSocket).perfilId ?? null) })
      } catch {
        ack?.({ ok: false, error: 'Não foi possível ler os desafios.' })
      }
    })

    socket.on('tt:terminar', async (payload: Record<string, unknown> | undefined, ack?: Resposta) => {
      const perfilId = (socket.data as DadosDoSocket).perfilId
      if (!perfilId) return ack?.({ ok: false, error: 'Entre num perfil primeiro.' })
      try {
        const { volta, ...veredito } = await pistaDoDia.terminar(perfilId, {
          tentativa: payload?.tentativa,
          tempo: payload?.tempo,
          gravacao: payload?.gravacao,
          dispositivo: payload?.dispositivo,
          entradas: payload?.entradas,
        })
        // Durante a classificação da copa, a volta aceita vale nela também.
        const naCopa = volta ? copa.registrarVolta(perfilId, volta) : null
        ack?.({ ok: true, ...veredito, ...(naCopa ? { copa: naCopa } : {}) })
      } catch {
        ack?.({ ok: false, error: 'Não foi possível registrar o tempo.' })
      }
    })

    socket.on('tt:quadro', async (payload: { desafio?: string } | undefined, ack?: Resposta) => {
      try {
        const quadro = await pistaDoDia.quadro((socket.data as DadosDoSocket).perfilId ?? null, 10, payload?.desafio)
        if (!quadro) return ack?.({ ok: false, error: 'Esse desafio não é desta semana.' })
        ack?.({ ok: true, quadro })
      } catch {
        ack?.({ ok: false, error: 'Não foi possível ler o quadro.' })
      }
    })

    socket.on('tt:fantasma', async (payload: { tempo?: string } | undefined, ack?: Resposta) => {
      try {
        const gravacao = typeof payload?.tempo === 'string' ? await pistaDoDia.fantasma(payload.tempo) : null
        if (!gravacao) return ack?.({ ok: false, error: 'Fantasma indisponível.' })
        ack?.({ ok: true, gravacao })
      } catch {
        ack?.({ ok: false, error: 'Não foi possível baixar o fantasma.' })
      }
    })

    // Fila ranqueada: só com perfil, e só a fila pública conta.
    socket.on('ranqueada:painel', async (_payload: unknown, ack?: Resposta) => {
      const perfilId = (socket.data as DadosDoSocket).perfilId
      if (!perfilId) return ack?.({ ok: false, error: 'Entre num perfil primeiro.' })
      try {
        ack?.({
          ok: true,
          painel: await ranqueada.painel(perfilId),
          escada: await ranqueada.escada(),
          esperaAte: ranqueada.esperaAte(perfilId),
          naFila: ranqueada.naFila().some((entrada) => entrada.perfilId === perfilId),
        })
      } catch {
        ack?.({ ok: false, error: 'Não foi possível ler a ranqueada.' })
      }
    })

    socket.on('ranqueada:entrar', async (payload: { playerId?: string; nome?: string; carro?: string } | undefined, ack?: Resposta) => {
      const perfilId = (socket.data as DadosDoSocket).perfilId
      if (!perfilId) return ack?.({ ok: false, error: 'Entre num perfil primeiro.' })
      if (typeof payload?.playerId !== 'string' || !payload.playerId) return ack?.({ ok: false, error: 'Piloto inválido.' })
      try {
        const entrada = await ranqueada.entrar({
          perfilId,
          playerId: payload.playerId,
          socketId: socket.id,
          nome: apelidoLimpo(payload.nome),
          carro: toCarId(payload.carro),
        })
        ack?.(entrada.ok ? { ok: true } : { ok: false, error: entrada.motivo, ate: entrada.ate })
        anunciarFila()
      } catch {
        ack?.({ ok: false, error: 'Não foi possível entrar na fila.' })
      }
    })

    socket.on('ranqueada:sair', (_payload: unknown, ack?: Resposta) => {
      const perfilId = (socket.data as DadosDoSocket).perfilId
      if (perfilId) ranqueada.sair(perfilId)
      ack?.({ ok: true })
      anunciarFila()
    })

    // Copa do Dia: a situação de hoje, a inscrição e a saída.
    socket.on('copa:painel', async (_payload: unknown, ack?: Resposta) => {
      try {
        ack?.({ ok: true, copa: await copa.situacao((socket.data as DadosDoSocket).perfilId ?? null) })
      } catch {
        ack?.({ ok: false, error: 'Não foi possível ler a copa.' })
      }
    })

    socket.on('copa:inscrever', (payload: { playerId?: string; nome?: string; carro?: string } | undefined, ack?: Resposta) => {
      const perfilId = (socket.data as DadosDoSocket).perfilId
      if (!perfilId) return ack?.({ ok: false, error: 'Entre num perfil primeiro.' })
      if (typeof payload?.playerId !== 'string' || !payload.playerId) return ack?.({ ok: false, error: 'Piloto inválido.' })
      const inscricao = copa.inscrever({
        perfilId,
        playerId: payload.playerId,
        socketId: socket.id,
        nome: apelidoLimpo(payload.nome),
        carro: toCarId(payload.carro),
      })
      ack?.(inscricao.ok ? { ok: true } : { ok: false, error: inscricao.motivo })
    })

    socket.on('copa:sair', (_payload: unknown, ack?: Resposta) => {
      const perfilId = (socket.data as DadosDoSocket).perfilId
      ack?.({ ok: perfilId ? copa.sair(perfilId) : false })
    })

    socket.on('room:leave', () => {
      const quemSai = (socket.data as DadosDoSocket).playerId
      for (const update of rooms.leaveBySocket(socket.id)) {
        clearStartTimer(update.code)
        socket.leave(update.code)
        if (update.room && update.cancelledCountdown) {
          io.to(update.code).emit('race:cancelled', { code: update.code, reason: 'Um piloto saiu da sala.' })
        }
        if (update.cancelledCountdown) {
          cancelarRanqueada(update.code, quemSai, 'Um piloto saiu antes da largada. Ninguém ganha nem perde PL.')
          cancelarRodadaDaCopa(update.code, quemSai)
        }
        publish(update.code, update.room)
        // Quem saiu podia ser o único que faltava confirmar.
        scheduleIfReady(update.code)
      }
    })

    socket.on('disconnect', () => {
      ranqueada.sairPorSocket(socket.id)
      for (const update of rooms.markDisconnected(socket.id)) {
        if (!update.room) continue
        if (update.cancelledCountdown) {
          clearStartTimer(update.code)
          io.to(update.code).emit('race:cancelled', {
            code: update.code,
            reason: 'Um piloto perdeu a conexão. Aguardando o retorno.',
          })
          cancelarRanqueada(update.code, update.playerId, 'Um piloto caiu antes da largada. Ninguém ganha nem perde PL.')
          cancelarRodadaDaCopa(update.code, update.playerId)
        }
        publish(update.code, update.room)

        const key = graceKey(update.code, update.playerId)
        const existing = graceTimers.get(key)
        if (existing) clearTimeout(existing)
        graceTimers.set(
          key,
          setTimeout(() => {
            graceTimers.delete(key)
            // Durante a prova, quem não volta a tempo perde por abandono. O
            // resultado sai antes da limpeza, e a vaga é liberada em seguida
            // para a sala não ficar presa com um piloto que não volta mais.
            const encerrada = rooms.abandonRace(update.code, update.playerId)
            if (encerrada?.outcome) emitirResultado(update.code, encerrada.outcome)

            const dropped = rooms.dropIfStillDisconnected(update.code, update.playerId)
            if (!dropped) return
            clearStartTimer(update.code)
            if (dropped.room && dropped.cancelledCountdown) {
              io.to(update.code).emit('race:cancelled', { code: update.code, reason: 'Um piloto não voltou a tempo.' })
            }
            publish(update.code, dropped.room)
            scheduleIfReady(update.code)
          }, graceMs),
        )
      }
    })
  })

  const webRoot = resolve('dist')
  if ((options.serveStatic ?? true) && existsSync(webRoot)) {
    app.use(express.static(webRoot))
    app.use((request, response, next) => {
      if (request.method === 'GET') response.sendFile(resolve(webRoot, 'index.html'))
      else next()
    })
  }

  const close = async () => {
    clearInterval(relogioDaFila)
    for (const timer of startTimers.values()) clearTimeout(timer)
    for (const timer of graceTimers.values()) clearTimeout(timer)
    for (const timer of limiteTimers.values()) clearTimeout(timer)
    for (const timer of fantasmaTimers.values()) clearInterval(timer)
    for (const timer of copaTimers) clearTimeout(timer)
    copaTimers.clear()
    startTimers.clear()
    graceTimers.clear()
    limiteTimers.clear()
    fantasmaTimers.clear()
    await io.close()
    await new Promise<void>((resolveClose) => http.close(() => resolveClose()))
  }

  return { http, io, rooms, repositorio, pistaDoDia, ranqueada, copa, close }
}
