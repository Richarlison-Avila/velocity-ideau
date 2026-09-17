import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import express from 'express'
import { Server } from 'socket.io'
import { RoomError, RoomStore } from './rooms.js'

const app = express()
const server = createServer(app)
const io = new Server(server, { cors: { origin: true, credentials: true } })
const rooms = new RoomStore()
const port = Number(process.env.PORT) || 3001

app.get('/health', (_request, response) => response.json({ ok: true }))

type Ack = (response: { ok: boolean; room?: ReturnType<RoomStore['get']>; error?: string }) => void

io.on('connection', (socket) => {
  socket.on('room:create', (payload: { name: string; playerId: string }, ack: Ack) => {
    try {
      const room = rooms.create(socket.id, payload.playerId, payload.name)
      socket.join(room.code)
      ack({ ok: true, room })
    } catch {
      ack({ ok: false, error: 'Não foi possível criar a sala.' })
    }
  })

  socket.on('room:join', (payload: { code: string; name: string; playerId: string }, ack: Ack) => {
    try {
      const room = rooms.join(payload.code, socket.id, payload.playerId, payload.name)
      socket.join(room.code)
      ack({ ok: true, room })
      io.to(room.code).emit('room:update', room)
    } catch (error) {
      ack({ ok: false, error: error instanceof RoomError ? error.message : 'Não foi possível entrar na sala.' })
    }
  })

  socket.on('room:set-ready', (payload: { code: string; playerId: string; ready: boolean }, ack: Ack) => {
    try {
      const room = rooms.setReady(payload.code, payload.playerId, payload.ready)
      ack({ ok: true, room })
      io.to(room.code).emit('room:update', room)
    } catch (error) {
      ack({ ok: false, error: error instanceof RoomError ? error.message : 'Não foi possível atualizar seu estado.' })
    }
  })

  const leave = () => {
    for (const update of rooms.leaveBySocket(socket.id)) {
      if (update.room) io.to(update.code).emit('room:update', update.room)
    }
  }
  socket.on('room:leave', leave)
  socket.on('disconnect', leave)
})

const webRoot = resolve('dist')
if (existsSync(webRoot)) {
  app.use(express.static(webRoot))
  app.use((request, response, next) => {
    if (request.method === 'GET') response.sendFile(resolve(webRoot, 'index.html'))
    else next()
  })
}

server.listen(port, '0.0.0.0', () => {
  console.log(`Servidor multiplayer disponível em http://localhost:${port}`)
})
