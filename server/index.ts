import { networkInterfaces } from 'node:os'
import { createGameServer } from './app.js'
import { COUNTDOWN_MS } from './rooms.js'

const port = Number(process.env.PORT) || 3001

// Salas que sempre existem, para o QR code da apresentação nunca falhar.
const openRooms = (process.env.DEMO_ROOMS ?? 'DEMO1')
  .split(',')
  .map((code) => code.trim().toUpperCase())
  .filter(Boolean)

const { http } = createGameServer({ openRooms })

/** Endereços da máquina na rede local, para acessar pelo celular no evento. */
function enderecosLocais() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((rede) => rede && rede.family === 'IPv4' && !rede.internal)
    .map((rede) => `http://${rede!.address}:${port}`)
}

http.listen(port, '0.0.0.0', () => {
  console.log(`Corrida Fantasma no ar em http://localhost:${port}`)
  for (const endereco of enderecosLocais()) console.log(`  na rede local: ${endereco}`)
  console.log(`Largada agendada com ${COUNTDOWN_MS} ms de antecedência.`)
  if (openRooms.length > 0) console.log(`Sala(s) de demonstração sempre abertas: ${openRooms.join(', ')}`)
})
