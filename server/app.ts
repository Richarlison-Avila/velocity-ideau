import { existsSync } from 'node:fs'
import { createServer, type Server as HttpServer } from 'node:http'
import { resolve } from 'node:path'
import express from 'express'
import { Server } from 'socket.io'
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
        socket.join(room.code)
        ack({ ok: true, room })
      } catch {
        ack({ ok: false, error: 'Não foi possível criar a sala.' })
      }
    })

    socket.on('room:join', (payload: { code: string; name: string; playerId: string; car?: string }, ack: Ack) => {
      try {
        const room = rooms.join(payload.code, socket.id, payload.playerId, payload.name, payload.car)
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
      const accepted = rooms.acceptTelemetry(payload.code, payload.playerId, payload)
      if (!accepted) return
      socket.to(payload.code.trim().toUpperCase()).emit('race:rival', { playerId: payload.playerId, ...accepted })
    })

    // Chegada: o servidor valida o tempo e só então fecha o resultado.
    socket.on('race:finish', (payload: { code: string; playerId: string } & FinishReport) => {
      const registrada = rooms.recordFinish(payload.code, payload.playerId, payload)
      if (!registrada) return
      publish(registrada.room.code, registrada.room)
      if (registrada.outcome) io.to(registrada.room.code).emit('race:result', registrada.outcome)
    })

    // Desistir no meio da prova entrega a vitória ao adversário.
    socket.on('race:abandon', (payload: { code: string; playerId: string }) => {
      const encerrada = rooms.abandonRace(payload.code, payload.playerId)
      if (!encerrada) return
      publish(encerrada.room.code, encerrada.room)
      if (encerrada.outcome) io.to(encerrada.room.code).emit('race:result', encerrada.outcome)
    })

    socket.on('race:rematch', (payload: { code: string; playerId: string }, ack?: Ack) => {
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
      try {
        const room = rooms.setDifficulty(payload.code, payload.playerId, payload.difficulty)
        ack?.({ ok: true, room })
        publish(room.code, room)
      } catch (error) {
        ack?.({ ok: false, error: error instanceof RoomError ? error.message : 'Não foi possível trocar a dificuldade.' })
      }
    })

    socket.on('room:set-car', (payload: { code: string; playerId: string; car: string }, ack?: Ack) => {
      try {
        const room = rooms.setCar(payload.code, payload.playerId, payload.car)
        ack?.({ ok: true, room })
        publish(room.code, room)
      } catch (error) {
        ack?.({ ok: false, error: error instanceof RoomError ? error.message : 'Não foi possível trocar o carro.' })
      }
    })

    socket.on('room:set-ready', (payload: { code: string; playerId: string; ready: boolean }, ack?: Ack) => {
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

    socket.on('room:leave', () => {
      for (const update of rooms.leaveBySocket(socket.id)) {
        clearStartTimer(update.code)
        socket.leave(update.code)
        if (update.room && update.cancelledCountdown) {
          io.to(update.code).emit('race:cancelled', { code: update.code, reason: 'Um piloto saiu da sala.' })
        }
        publish(update.code, update.room)
      }
    })

    socket.on('disconnect', () => {
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
