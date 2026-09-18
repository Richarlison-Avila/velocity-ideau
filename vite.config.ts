import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// O servidor da partida escuta em IPv4; usar 127.0.0.1 evita a tentativa por ::1.
const gameServer = process.env.GAME_SERVER_URL ?? 'http://127.0.0.1:3001'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/socket.io': {
        target: gameServer,
        ws: true,
      },
    },
  },
})
