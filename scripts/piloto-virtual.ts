/**
 * Piloto virtual: entra em uma sala como segundo jogador e corre sozinho.
 *
 * Serve para testar o fantasma, a largada sincronizada e o HUD sem precisar
 * de um segundo aparelho. Usa o mesmo protocolo do navegador, então tudo
 * passa pelo servidor de verdade.
 *
 *   npm run piloto -- ABC12
 *   npm run piloto -- ABC12 --nome Rival --velocidade 260 --carro schumacher
 *   npm run piloto -- ABC12 --parado
 *
 * Com `--parado`, entra no grid e nunca confirma: é o celular esquecido na
 * mesa, que segura a largada de todo mundo até o anfitrião tirá-lo da sala.
 */
import { io, type Socket } from 'socket.io-client'
// A pista e a curva de tração vêm do jogo: uma cópia aqui divergiria em
// silêncio, e o fantasma arrancaria diferente do carro de verdade.
import { CARS, carById, isCarId } from '../src/game/cars.js'
import { rulesFor, type Difficulty } from '../src/game/rules.js'
import { ACCELERATION_PEAK, ACCELERATION_SHAPE } from '../src/game/simulation.js'
import { TRACK_LENGTH } from '../src/game/track.js'

type Room = {
  code: string
  players: Array<{ id: string; name: string; ready: boolean; connected: boolean; finished: boolean; rematch: boolean }>
  status: 'waiting' | 'ready' | 'countdown' | 'racing' | 'finished'
  startAt: number | null
  countdownMs: number
}

type RoomAck = { ok: boolean; room?: Room; error?: string }
type Scheduled = {
  code: string
  startAt: number
  countdownMs: number
  /** Semente oficial do traçado, a mesma que o navegador recebe. */
  trackSeed: number
  /** Dificuldade oficial da sala. */
  difficulty: Difficulty
  serverTime: number
}

const TELEMETRY_INTERVAL_MS = 100
const STEP_MS = 16

function readOption(name: string, fallback: string) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const code = process.argv[2]?.trim().toUpperCase()
if (!code || code.startsWith('--')) {
  console.error('Informe o código da sala. Exemplo: npm run piloto -- ABC12')
  process.exit(1)
}

const serverUrl = process.env.GAME_SERVER_URL ?? 'http://127.0.0.1:3001'
const name = readOption('nome', 'Fantasma')
const targetSpeed = Number(readOption('velocidade', '245'))
// Por padrão, um carro diferente do padrão do navegador: com os dois iguais,
// o teste não mostraria que o fantasma usa a pintura do rival.
const carroPedido = readOption('carro', 'verstappen')
const parado = process.argv.includes('--parado')
if (!isCarId(carroPedido)) {
  console.error(`Carro desconhecido: ${carroPedido}. Opções: ${CARS.map((car) => car.id).join(', ')}`)
  process.exit(1)
}
const car = carroPedido
/** Velocidade efetiva: o pedido, limitado ao cruzeiro da dificuldade da sala. */
let ritmo = targetSpeed
const playerId = `piloto-virtual-${Math.random().toString(36).slice(2, 8)}`

const socket: Socket = io(serverUrl, { transports: ['websocket'], forceNew: true })

let clockOffset = 0
const serverNow = () => Date.now() + clockOffset

/** Mesma estimativa usada pelo navegador: desconta metade da ida e volta. */
async function syncClock(samples = 5) {
  let best = { offset: 0, roundTrip: Number.POSITIVE_INFINITY }
  for (let index = 0; index < samples; index += 1) {
    const sentAt = Date.now()
    const serverTime = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 1_500)
      socket.emit('time:sync', { clientSentAt: sentAt }, (response: { serverTime: number }) => {
        clearTimeout(timer)
        resolve(response?.serverTime ?? null)
      })
    })
    if (serverTime === null) continue
    const receivedAt = Date.now()
    const roundTrip = receivedAt - sentAt
    const offset = serverTime + roundTrip / 2 - receivedAt
    if (roundTrip < best.roundTrip) best = { offset, roundTrip }
    await new Promise((resolve) => setTimeout(resolve, 80))
  }
  clockOffset = best.offset
  console.log(`Relógio sincronizado: ${Math.round(best.offset)} ms de diferença, ida e volta ${best.roundTrip} ms.`)
}

let racing = false

/** Corre em ritmo constante, serpenteando de leve para o fantasma não ficar estático. */
function race(startAt: number) {
  if (racing) return
  racing = true

  let progress = 0
  let speed = 0
  let lastSent = 0
  // O temporizador do Node não é preciso, então integramos pelo tempo real.
  let lastTick = startAt
  console.log('Largada recebida. Acelerando.')

  const send = (state: 'racing' | 'finished', lateral: number) => {
    socket.emit('race:telemetry', {
      code,
      playerId,
      t: serverNow(),
      progress,
      lateral,
      speed: state === 'finished' ? 0 : speed,
      state,
    })
  }

  const loop = setInterval(() => {
    const clock = serverNow()
    const elapsed = (clock - startAt) / 1000
    if (elapsed < 0) return

    const dt = Math.min(0.25, Math.max(0, (clock - lastTick) / 1000))
    lastTick = clock
    if (dt === 0) return
    // Mesma curva de tração do jogo: arrancada forte que cede perto do teto.
    if (speed < ritmo) {
      const fracao = speed / ritmo
      speed = Math.min(ritmo, speed + ACCELERATION_PEAK * (1 - Math.pow(fracao, ACCELERATION_SHAPE)) * dt)
    }
    progress = Math.min(TRACK_LENGTH, progress + (speed / 3.6) * dt)
    const lateral = Math.sin(elapsed / 2.6) * 0.55

    if (progress >= TRACK_LENGTH) {
      clearInterval(loop)
      racing = false
      send('finished', lateral)
      console.log(`Chegada em ${elapsed.toFixed(3)} s.`)
      // O servidor é quem decide o vencedor: avisamos a chegada e esperamos.
      socket.emit('race:finish', { code, playerId, time: elapsed, topSpeed: ritmo, collisions: 0 })
      return
    }

    const now = Date.now()
    if (now - lastSent >= TELEMETRY_INTERVAL_MS) {
      lastSent = now
      send('racing', lateral)
    }
  }, STEP_MS)
}

socket.on('connect', async () => {
  console.log(`Conectado a ${serverUrl}.`)
  await syncClock()

  socket.emit('room:join', { code, name, playerId, car }, (response: RoomAck) => {
    if (!response.ok || !response.room) {
      console.error(`Não foi possível entrar na sala ${code}: ${response.error}`)
      process.exit(1)
    }
    if (parado) {
      console.log(`Na sala ${code} como "${name}", parado: não vai confirmar.`)
      return
    }
    console.log(`Na sala ${code} como "${name}", com o carro de ${carById(car).driver}. Confirmando presença.`)
    socket.emit('room:set-ready', { code, playerId, ready: true })
  })
})

// Tirado do grid pelo anfitrião: não há mais o que fazer aqui.
socket.on('room:kicked', () => {
  console.log(`O anfitrião tirou "${name}" da sala ${code}.`)
  process.exit(0)
})

socket.on('room:update', (room: Room) => {
  const rivais = room.players.map((player) => `${player.name}${player.ready ? ' (pronto)' : ''}`).join(', ')
  console.log(`Sala ${room.status}: ${rivais}`)
  const me = room.players.find((player) => player.id === playerId)

  // Depois de uma corrida, confirma de novo para a próxima largada.
  if (room.status === 'waiting' && !racing && !parado && me && !me.ready && room.players.length === 2) {
    setTimeout(() => socket.emit('room:set-ready', { code, playerId, ready: true }), 800)
  }

  // Com o resultado fechado, aceita a revanche.
  if (room.status === 'finished' && !parado && me && !me.rematch) {
    setTimeout(() => socket.emit('race:rematch', { code, playerId }), 900)
  }
})

socket.on('race:result', (resultado: { winnerId: string | null; reason: string; gap: number | null }) => {
  const quem = resultado.winnerId === playerId ? 'eu' : resultado.winnerId ? 'o rival' : 'ninguém'
  const diferenca = resultado.gap === null ? 'sem diferença medida' : `${resultado.gap.toFixed(3)} s`
  console.log(`Resultado oficial: venceu ${quem} (${resultado.reason}), ${diferenca}.`)
})

socket.on('race:scheduled', (payload: Scheduled) => {
  const faltando = payload.startAt - serverNow()
  console.log(`Largada agendada para daqui a ${Math.round(faltando)} ms.`)
  // Impresso para conferir a olho que os dois lados receberam a mesma pista.
  console.log(`Traçado desta corrida: semente ${payload.trackSeed}, dificuldade ${payload.difficulty}.`)
  // O ritmo acompanha o nível da sala, senão o fantasma correria numa prova
  // diferente da do rival — e chegaria antes ou depois sem explicação.
  ritmo = Math.min(targetSpeed, rulesFor(payload.difficulty).cruiseSpeed)
  race(payload.startAt)
})

socket.on('race:cancelled', (payload: { reason: string }) => {
  console.log(`Largada cancelada: ${payload.reason}`)
  racing = false
})

socket.on('disconnect', () => console.log('Desconectado.'))

process.on('SIGINT', () => {
  socket.emit('room:leave')
  socket.disconnect()
  process.exit(0)
})
