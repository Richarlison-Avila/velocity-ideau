import { createGameServer } from './app.js'
import { COUNTDOWN_MS } from './rooms.js'

const port = Number(process.env.PORT) || 3001
const { http } = createGameServer()

http.listen(port, '0.0.0.0', () => {
  console.log(`Servidor multiplayer disponível em http://localhost:${port}`)
  console.log(`Largada agendada com ${COUNTDOWN_MS} ms de antecedência.`)
})
