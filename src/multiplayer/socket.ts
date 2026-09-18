import { io } from 'socket.io-client'

export const socket = io(import.meta.env.VITE_SERVER_URL ?? '', {
  autoConnect: true,
  transports: ['websocket', 'polling'],
  // Uma queda curta de conexão precisa ser recuperada antes de a sala expirar.
  reconnection: true,
  reconnectionDelay: 400,
  reconnectionDelayMax: 2_500,
  timeout: 8_000,
})
