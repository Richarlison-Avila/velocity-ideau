import { existsSync } from 'node:fs'
import { createServer, type Server as HttpServer } from 'node:http'
import { resolve } from 'node:path'
import express from 'express'
import { Server, type Socket } from 'socket.io'
import {
  COUNTDOWN_MS,
  RECONNECT_GRACE_MS,
  RoomError,
  RoomStore,
  type FinishReport,
  type PublicRoom,
  type Telemetry,
} from './rooms.js'

export type GameServerOptions = {
  countdownMs?: number
  graceMs?: number
  /** Serve o site construído quando a pasta dist existe. */
  serveStatic?: boolean
  /** Códigos de sala que se criam sozinhos, para a demonstração do workshop. */
  openRooms?: string[]
}

export type GameServer = {
  http: HttpServer
  io: Server
  rooms: RoomStore
  close: () => Promise<void>
}

type Ack = (response: { ok: boolean; room?: PublicRoom | null; error?: string }) => void

/** O que o servidor sabe de cada conexão: quem ela é na sala, ou de que sala assiste. */
type DadosDoSocket = { playerId?: string; espectadorDe?: string }

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
        publish(code, rooms.beginRace(code))
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
        // Quem assistia e desceu para o grid deixa de ser espectador.
        ;(socket.data as DadosDoSocket).espectadorDe = undefined
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

    /**
     * Arquibancada: assistir sem ocupar vaga no grid.
     *
     * O espectador entra no mesmo canal da sala, então recebe tudo o que os
     * pilotos recebem — a sala, a largada, a telemetria de cada um e o
     * resultado. Quem chega no meio da prova ganha o instante oficial e a
     * última posição de todos, para a corrida aparecer inteira na hora.
     */
    socket.on('room:spectate', (payload: { code: string; name: string; spectatorId: string }, ack: Ack) => {
      try {
        const eraPiloto = rooms.get(payload.code)?.players.some((player) => player.id === payload.spectatorId) ?? false
        const room = rooms.spectate(payload.code, socket.id, payload.spectatorId, payload.name)
        const dados = socket.data as DadosDoSocket
        // Quem estava no grid desta sala e subiu para assistir não fala mais pelo piloto.
        if (eraPiloto && dados.playerId === payload.spectatorId) dados.playerId = undefined
        dados.espectadorDe = room.code
        socket.join(room.code)
        ack({ ok: true, room })
        publish(room.code, room)
        // Quem subiu podia ser o único que faltava confirmar.
        scheduleIfReady(room.code)

        if (room.startAt && (room.status === 'countdown' || room.status === 'racing')) {
          socket.emit('race:scheduled', {
            code: room.code,
            startAt: room.startAt,
            countdownMs: room.countdownMs,
            trackSeed: room.trackSeed,
            difficulty: room.difficulty,
            serverTime: Date.now(),
          })
          for (const telemetria of rooms.allTelemetries(room.code)) socket.emit('race:rival', telemetria)
        }
      } catch (error) {
        ack({ ok: false, error: error instanceof RoomError ? error.message : 'Não foi possível assistir a esta sala.' })
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
    socket.on('race:finish', (payload: { code: string; playerId: string } & FinishReport) => {
      if (!falaPor(socket, payload?.playerId)) return
      const registrada = rooms.recordFinish(payload.code, payload.playerId, payload)
      if (!registrada) return
      publish(registrada.room.code, registrada.room)
      if (registrada.outcome) io.to(registrada.room.code).emit('race:result', registrada.outcome)
    })

    // Desistir no meio da prova entrega a vitória ao adversário.
    socket.on('race:abandon', (payload: { code: string; playerId: string }) => {
      if (!falaPor(socket, payload?.playerId)) return
      const encerrada = rooms.abandonRace(payload.code, payload.playerId)
      if (!encerrada) return
      publish(encerrada.room.code, encerrada.room)
      if (encerrada.outcome) io.to(encerrada.room.code).emit('race:result', encerrada.outcome)
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

    socket.on('room:leave', () => {
      for (const update of rooms.leaveBySocket(socket.id)) {
        if (update.cancelledCountdown) clearStartTimer(update.code)
        socket.leave(update.code)
        if (update.room && update.cancelledCountdown) {
          io.to(update.code).emit('race:cancelled', { code: update.code, reason: 'Um piloto saiu da sala.' })
        }
        publish(update.code, update.room)
        // Quem saiu podia ser o único que faltava confirmar.
        scheduleIfReady(update.code)
      }
    })

    socket.on('disconnect', () => {
      for (const update of rooms.dropSpectatorsBySocket(socket.id)) publish(update.code, update.room)
      for (const update of rooms.markDisconnected(socket.id)) {
        if (!update.room) continue
        if (update.cancelledCountdown) {
          clearStartTimer(update.code)
          io.to(update.code).emit('race:cancelled', {
            code: update.code,
            reason: 'Um piloto perdeu a conexão. Aguardando o retorno.',
          })
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
            if (encerrada?.outcome) io.to(update.code).emit('race:result', encerrada.outcome)

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
    for (const timer of startTimers.values()) clearTimeout(timer)
    for (const timer of graceTimers.values()) clearTimeout(timer)
    startTimers.clear()
    graceTimers.clear()
    await io.close()
    await new Promise<void>((resolveClose) => http.close(() => resolveClose()))
  }

  return { http, io, rooms, close }
}
