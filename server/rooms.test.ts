import { describe, expect, it } from 'vitest'
import { RoomError, RoomStore, type Telemetry } from './rooms.js'

/** Relógio controlado para testar agendamento e janela de reconexão. */
function createClock(start = 1_000_000) {
  let current = start
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms
    },
  }
}

function roomWithTwoPilots(store: RoomStore) {
  const room = store.create('socket-a', 'a', 'Ana')
  store.join(room.code, 'socket-b', 'b', 'Beto')
  return room.code
}

describe('salas multiplayer', () => {
  it('cria uma sala e aceita exatamente dois pilotos', () => {
    const rooms = new RoomStore()
    const room = rooms.create('socket-a', 'a', 'Ana')
    expect(room.code).toHaveLength(5)
    expect(rooms.join(room.code, 'socket-b', 'b', 'Beto').players).toHaveLength(2)
    expect(() => rooms.join(room.code, 'socket-c', 'c', 'Caio')).toThrow(RoomError)
  })

  it('fica pronta somente quando os dois confirmam', () => {
    const rooms = new RoomStore()
    const code = roomWithTwoPilots(rooms)
    expect(rooms.setReady(code, 'a', true).status).toBe('waiting')
    expect(rooms.setReady(code, 'b', true).status).toBe('ready')
  })

  it('remove quem sai antes da largada', () => {
    const rooms = new RoomStore()
    const code = roomWithTwoPilots(rooms)
    rooms.leaveBySocket('socket-b')
    expect(rooms.get(code)?.players.map((player) => player.name)).toEqual(['Ana'])
  })

  it('recusa entrada em sala inexistente', () => {
    const rooms = new RoomStore()
    expect(() => rooms.join('ZZZZZ', 'socket-a', 'a', 'Ana')).toThrow(RoomError)
  })

  it('descarta a sala quando o último piloto sai', () => {
    const rooms = new RoomStore()
    const code = roomWithTwoPilots(rooms)
    rooms.leaveBySocket('socket-a')
    rooms.leaveBySocket('socket-b')
    expect(rooms.get(code)).toBeNull()
    expect(rooms.size).toBe(0)
  })
})

describe('sala de demonstração', () => {
  it('se cria sozinha quando o primeiro piloto entra', () => {
    const rooms = new RoomStore({ openRooms: ['demo1'] })
    expect(rooms.get('DEMO1')).toBeNull()

    const sala = rooms.join('DEMO1', 'socket-a', 'a', 'Ana')
    expect(sala.code).toBe('DEMO1')
    expect(sala.players.map((player) => player.name)).toEqual(['Ana'])
  })

  it('aceita o código em minúsculas e com espaços', () => {
    const rooms = new RoomStore({ openRooms: ['DEMO1'] })
    expect(rooms.join(' demo1 ', 'socket-a', 'a', 'Ana').code).toBe('DEMO1')
  })

  it('continua limitada a dois pilotos', () => {
    const rooms = new RoomStore({ openRooms: ['DEMO1'] })
    rooms.join('DEMO1', 'socket-a', 'a', 'Ana')
    rooms.join('DEMO1', 'socket-b', 'b', 'Beto')
    expect(() => rooms.join('DEMO1', 'socket-c', 'c', 'Caio')).toThrow(RoomError)
  })

  it('reabre depois que todos saem', () => {
    const rooms = new RoomStore({ openRooms: ['DEMO1'] })
    rooms.join('DEMO1', 'socket-a', 'a', 'Ana')
    rooms.leaveBySocket('socket-a')
    expect(rooms.get('DEMO1')).toBeNull()

    // O QR code do slide continua funcionando na próxima demonstração.
    expect(rooms.join('DEMO1', 'socket-b', 'b', 'Beto').code).toBe('DEMO1')
  })

  it('não inventa salas fora da lista', () => {
    const rooms = new RoomStore({ openRooms: ['DEMO1'] })
    expect(() => rooms.join('OUTRA', 'socket-a', 'a', 'Ana')).toThrow(RoomError)
  })

  it('sem configuração nenhuma sala é aberta automaticamente', () => {
    const rooms = new RoomStore()
    expect(rooms.demoRooms).toEqual([])
    expect(() => rooms.join('DEMO1', 'socket-a', 'a', 'Ana')).toThrow(RoomError)
  })
})

describe('largada sincronizada', () => {
  it('agenda a largada no futuro apenas com os dois pilotos prontos', () => {
    const clock = createClock()
    const rooms = new RoomStore({ now: clock.now, countdownMs: 5_400 })
    const code = roomWithTwoPilots(rooms)

    rooms.setReady(code, 'a', true)
    expect(rooms.scheduleStart(code)).toBeNull()

    rooms.setReady(code, 'b', true)
    const scheduled = rooms.scheduleStart(code)
    expect(scheduled?.status).toBe('countdown')
    expect(scheduled?.startAt).toBe(clock.now() + 5_400)
    expect(scheduled?.countdownMs).toBe(5_400)
  })

  it('entrega o mesmo instante de largada para os dois pilotos', () => {
    const clock = createClock()
    const rooms = new RoomStore({ now: clock.now })
    const code = roomWithTwoPilots(rooms)
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)
    const scheduled = rooms.scheduleStart(code)

    // Qualquer leitura posterior da sala devolve o mesmo horário oficial.
    clock.advance(1_200)
    expect(rooms.get(code)?.startAt).toBe(scheduled?.startAt)
  })

  it('não reagenda uma largada já marcada', () => {
    const clock = createClock()
    const rooms = new RoomStore({ now: clock.now })
    const code = roomWithTwoPilots(rooms)
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)
    const first = rooms.scheduleStart(code)
    clock.advance(500)
    expect(rooms.scheduleStart(code)).toBeNull()
    expect(rooms.get(code)?.startAt).toBe(first?.startAt)
  })

  it('cancela a largada quando um piloto desfaz a confirmação', () => {
    const rooms = new RoomStore()
    const code = roomWithTwoPilots(rooms)
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)
    rooms.scheduleStart(code)

    const cancelled = rooms.setReady(code, 'b', false)
    expect(cancelled.status).toBe('waiting')
    expect(cancelled.startAt).toBeNull()
    expect(cancelled.players.every((player) => !player.ready)).toBe(true)
  })

  it('cancela a largada quando um piloto sai durante a contagem', () => {
    const rooms = new RoomStore()
    const code = roomWithTwoPilots(rooms)
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)
    rooms.scheduleStart(code)

    const [update] = rooms.leaveBySocket('socket-b')
    expect(update.room?.status).toBe('waiting')
    expect(update.room?.startAt).toBeNull()
  })

  it('marca o início da corrida no instante agendado', () => {
    const clock = createClock()
    const rooms = new RoomStore({ now: clock.now })
    const code = roomWithTwoPilots(rooms)
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)
    const scheduled = rooms.scheduleStart(code)

    clock.advance(5_400)
    const racing = rooms.beginRace(code)
    expect(racing?.status).toBe('racing')
    expect(racing?.startAt).toBe(scheduled?.startAt)
    expect(rooms.beginRace(code)).toBeNull()
  })

  it('libera uma nova largada quando os pilotos voltam ao lobby', () => {
    const rooms = new RoomStore()
    const code = roomWithTwoPilots(rooms)
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)
    rooms.scheduleStart(code)
    rooms.beginRace(code)

    expect(rooms.setReady(code, 'a', false).status).toBe('waiting')
    expect(rooms.setReady(code, 'a', true).status).toBe('waiting')
    expect(rooms.setReady(code, 'b', true).status).toBe('ready')
    expect(rooms.scheduleStart(code)?.status).toBe('countdown')
  })
})

describe('telemetria do adversário', () => {
  /** Deixa a sala correndo, que é o único estado em que a telemetria vale. */
  function salaCorrendo(clock: ReturnType<typeof createClock>) {
    const rooms = new RoomStore({ now: clock.now })
    const code = roomWithTwoPilots(rooms)
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)
    rooms.scheduleStart(code)
    clock.advance(5_400)
    rooms.beginRace(code)
    return { rooms, code }
  }

  const medicao = (t: number, progress: number, extra: Partial<Telemetry> = {}): Telemetry => ({
    t,
    progress,
    lateral: 0,
    speed: 252,
    state: 'racing',
    ...extra,
  })

  it('aceita a telemetria de quem está correndo', () => {
    const clock = createClock()
    const { rooms, code } = salaCorrendo(clock)
    const aceita = rooms.acceptTelemetry(code, 'a', medicao(clock.now(), 120))
    expect(aceita?.progress).toBe(120)
    expect(aceita?.state).toBe('racing')
  })

  it('recusa telemetria antes da largada', () => {
    const clock = createClock()
    const rooms = new RoomStore({ now: clock.now })
    const code = roomWithTwoPilots(rooms)
    expect(rooms.acceptTelemetry(code, 'a', medicao(clock.now(), 120))).toBeNull()
  })

  it('recusa telemetria de quem não está na sala', () => {
    const clock = createClock()
    const { rooms, code } = salaCorrendo(clock)
    expect(rooms.acceptTelemetry(code, 'intruso', medicao(clock.now(), 120))).toBeNull()
  })

  it('descarta pacotes fora de ordem', () => {
    const clock = createClock()
    const { rooms, code } = salaCorrendo(clock)
    rooms.acceptTelemetry(code, 'a', medicao(clock.now(), 120))
    clock.advance(200)
    rooms.acceptTelemetry(code, 'a', medicao(clock.now(), 134))

    // Um pacote com horário anterior ao último aceito é ignorado.
    expect(rooms.acceptTelemetry(code, 'a', medicao(clock.now() - 100, 127))).toBeNull()
    expect(rooms.rivalTelemetry(code, 'b')?.progress).toBe(134)
  })

  it('não perde a chegada enviada no mesmo milissegundo da última medição', () => {
    const clock = createClock()
    const { rooms, code } = salaCorrendo(clock)
    const agora = clock.now()
    rooms.acceptTelemetry(code, 'a', medicao(agora, 4_790))

    const chegada = rooms.acceptTelemetry(code, 'a', medicao(agora, 4_800, { speed: 0, state: 'finished' }))
    expect(chegada?.state).toBe('finished')
    expect(chegada?.t).toBe(agora + 1)
    expect(rooms.rivalTelemetry(code, 'b')?.state).toBe('finished')
  })

  it('recusa números inválidos', () => {
    const clock = createClock()
    const { rooms, code } = salaCorrendo(clock)
    expect(rooms.acceptTelemetry(code, 'a', medicao(clock.now(), Number.NaN))).toBeNull()
    expect(rooms.acceptTelemetry(code, 'a', medicao(clock.now(), Infinity))).toBeNull()
  })

  it('impede que o progresso ande para trás', () => {
    const clock = createClock()
    const { rooms, code } = salaCorrendo(clock)
    rooms.acceptTelemetry(code, 'a', medicao(clock.now(), 400))
    clock.advance(100)
    expect(rooms.acceptTelemetry(code, 'a', medicao(clock.now(), 250))?.progress).toBe(400)
  })

  it('limita um avanço impossível ao máximo plausível', () => {
    const clock = createClock()
    const { rooms, code } = salaCorrendo(clock)
    rooms.acceptTelemetry(code, 'a', medicao(clock.now(), 100))
    clock.advance(100) // 0,1 s permitem no máximo 12 m mais a folga

    const aceita = rooms.acceptTelemetry(code, 'a', medicao(clock.now(), 4_000))
    expect(aceita?.progress).toBeLessThan(150)
    expect(aceita?.progress).toBeGreaterThan(100)
  })

  it('mantém a faixa dentro dos limites da pista', () => {
    const clock = createClock()
    const { rooms, code } = salaCorrendo(clock)
    const aceita = rooms.acceptTelemetry(code, 'a', medicao(clock.now(), 10, { lateral: 9 }))
    expect(aceita?.lateral).toBe(1.28)
  })

  it('corrige um horário incoerente usando o relógio do servidor', () => {
    const clock = createClock()
    const { rooms, code } = salaCorrendo(clock)
    const aceita = rooms.acceptTelemetry(code, 'a', medicao(clock.now() + 600_000, 10))
    expect(aceita?.t).toBe(clock.now())
  })

  it('entrega ao rival a última posição conhecida', () => {
    const clock = createClock()
    const { rooms, code } = salaCorrendo(clock)
    rooms.acceptTelemetry(code, 'a', medicao(clock.now(), 512))
    expect(rooms.rivalTelemetry(code, 'b')?.progress).toBe(512)
    expect(rooms.rivalTelemetry(code, 'a')).toBeNull()
  })

  it('esquece a telemetria da corrida anterior', () => {
    const clock = createClock()
    const { rooms, code } = salaCorrendo(clock)
    rooms.acceptTelemetry(code, 'a', medicao(clock.now(), 4_000))

    rooms.setReady(code, 'a', false)
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)
    rooms.scheduleStart(code)
    clock.advance(5_400)
    rooms.beginRace(code)

    expect(rooms.rivalTelemetry(code, 'b')).toBeNull()
    expect(rooms.acceptTelemetry(code, 'a', medicao(clock.now(), 5))?.progress).toBe(5)
  })
})

describe('resultado da corrida', () => {
  /** Sala correndo, já passado o tempo mínimo em que a prova pode terminar. */
  function provaCompletavel(clock: ReturnType<typeof createClock>, segundos = 70) {
    const rooms = new RoomStore({ now: clock.now })
    const code = roomWithTwoPilots(rooms)
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)
    rooms.scheduleStart(code)
    clock.advance(5_400)
    rooms.beginRace(code)
    clock.advance(segundos * 1_000)
    return { rooms, code }
  }

  const chegada = (time: number) => ({ time, topSpeed: 252, collisions: 2 })

  it('só fecha o resultado quando os dois cruzam a linha', () => {
    const clock = createClock()
    const { rooms, code } = provaCompletavel(clock)

    const primeira = rooms.recordFinish(code, 'a', chegada(69))
    expect(primeira?.outcome).toBeNull()
    expect(primeira?.room.status).toBe('racing')

    const segunda = rooms.recordFinish(code, 'b', chegada(70))
    expect(segunda?.outcome).not.toBeNull()
    expect(segunda?.room.status).toBe('finished')
  })

  it('entrega o mesmo vencedor e a mesma diferença para os dois', () => {
    const clock = createClock()
    // Cada piloto avisa a própria chegada no instante em que cruza a linha.
    const { rooms, code } = provaCompletavel(clock, 69.25)
    rooms.recordFinish(code, 'b', chegada(69.25))
    clock.advance(2_250)
    rooms.recordFinish(code, 'a', chegada(71.5))

    const resultado = rooms.outcomeFor(code)!
    expect(resultado.winnerId).toBe('b')
    expect(resultado.reason).toBe('time')
    expect(resultado.gap).toBeCloseTo(2.25, 5)
    expect(resultado.entries.map((entry) => entry.playerId)).toEqual(['b', 'a'])
  })

  it('recusa uma chegada antes do tempo mínimo da prova', () => {
    const clock = createClock()
    const { rooms, code } = provaCompletavel(clock, 20)
    expect(rooms.recordFinish(code, 'a', chegada(19))).toBeNull()
  })

  it('prende um tempo impossível ao que o servidor mediu', () => {
    const clock = createClock()
    const { rooms, code } = provaCompletavel(clock, 70)
    // Cliente adulterado tentando reivindicar uma volta de 10 segundos.
    const registrada = rooms.recordFinish(code, 'a', chegada(10))
    expect(registrada?.room).toBeTruthy()

    rooms.recordFinish(code, 'b', chegada(70))
    const vencedor = rooms.outcomeFor(code)!
    expect(vencedor.entries.find((entry) => entry.playerId === 'a')!.time).toBeGreaterThan(67)
  })

  it('não aceita um tempo no futuro', () => {
    const clock = createClock()
    const { rooms, code } = provaCompletavel(clock, 70)
    rooms.recordFinish(code, 'a', chegada(500))
    const tempo = rooms.outcomeFor(code) ?? null
    expect(tempo).toBeNull()
    rooms.recordFinish(code, 'b', chegada(70))
    const registrado = rooms.outcomeFor(code)!.entries.find((entry) => entry.playerId === 'a')!
    expect(registrado.time).toBeLessThanOrEqual(70)
  })

  it('ignora uma segunda chegada do mesmo piloto', () => {
    const clock = createClock()
    const { rooms, code } = provaCompletavel(clock)
    rooms.recordFinish(code, 'a', chegada(69))
    expect(rooms.recordFinish(code, 'a', chegada(60))).toBeNull()
  })

  it('dá a vitória por abandono a quem ficou', () => {
    const clock = createClock()
    const { rooms, code } = provaCompletavel(clock, 30)
    const encerrada = rooms.abandonRace(code, 'b')

    const resultado = encerrada?.outcome!
    expect(resultado.reason).toBe('abandon')
    expect(resultado.winnerId).toBe('a')
    expect(resultado.gap).toBeNull()
    expect(resultado.entries[0].outcome).toBe('unfinished')
    expect(resultado.entries[1].outcome).toBe('abandoned')
  })

  it('quem já chegou vence mesmo se o rival abandonar depois', () => {
    const clock = createClock()
    const { rooms, code } = provaCompletavel(clock)
    rooms.recordFinish(code, 'a', chegada(68))
    const resultado = rooms.abandonRace(code, 'b')?.outcome!
    expect(resultado.winnerId).toBe('a')
    expect(resultado.entries[0].outcome).toBe('finished')
  })
})

describe('revanche', () => {
  function salaDecidida(clock: ReturnType<typeof createClock>) {
    const rooms = new RoomStore({ now: clock.now })
    const code = roomWithTwoPilots(rooms)
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)
    rooms.scheduleStart(code)
    clock.advance(5_400)
    rooms.beginRace(code)
    clock.advance(70_000)
    rooms.recordFinish(code, 'a', { time: 69, topSpeed: 252, collisions: 1 })
    rooms.recordFinish(code, 'b', { time: 70, topSpeed: 250, collisions: 3 })
    return { rooms, code }
  }

  it('espera os dois pedidos antes de liberar nova largada', () => {
    const clock = createClock()
    const { rooms, code } = salaDecidida(clock)

    const primeiro = rooms.requestRematch(code, 'a')
    expect(primeiro.status).toBe('finished')
    expect(rooms.scheduleStart(code)).toBeNull()

    const segundo = rooms.requestRematch(code, 'b')
    expect(segundo.status).toBe('ready')
    expect(rooms.scheduleStart(code)?.status).toBe('countdown')
  })

  it('limpa o resultado e a telemetria da corrida anterior', () => {
    const clock = createClock()
    const { rooms, code } = salaDecidida(clock)
    rooms.requestRematch(code, 'a')
    rooms.requestRematch(code, 'b')

    expect(rooms.outcomeFor(code)).toBeNull()
    expect(rooms.rivalTelemetry(code, 'a')).toBeNull()
    expect(rooms.get(code)?.players.every((player) => !player.finished)).toBe(true)
  })

  it('mostra quem já pediu revanche', () => {
    const clock = createClock()
    const { rooms, code } = salaDecidida(clock)
    const sala = rooms.requestRematch(code, 'a')
    expect(sala.players.find((player) => player.id === 'a')?.rematch).toBe(true)
    expect(sala.players.find((player) => player.id === 'b')?.rematch).toBe(false)
  })

  it('voltar ao lobby também libera a sala', () => {
    const clock = createClock()
    const { rooms, code } = salaDecidida(clock)
    const sala = rooms.setReady(code, 'a', false)
    expect(sala.status).toBe('waiting')
    expect(rooms.outcomeFor(code)).toBeNull()
  })
})

describe('perda momentânea de conexão', () => {
  it('mantém o piloto na sala durante a janela de retorno', () => {
    const clock = createClock()
    const rooms = new RoomStore({ now: clock.now })
    const code = roomWithTwoPilots(rooms)

    const [update] = rooms.markDisconnected('socket-b')
    expect(update.room?.players).toHaveLength(2)
    expect(update.room?.players.find((player) => player.id === 'b')?.connected).toBe(false)
  })

  it('cancela a contagem quando um piloto cai', () => {
    const clock = createClock()
    const rooms = new RoomStore({ now: clock.now })
    const code = roomWithTwoPilots(rooms)
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)
    rooms.scheduleStart(code)

    const [update] = rooms.markDisconnected('socket-b')
    expect(update.room?.status).toBe('waiting')
    expect(update.room?.startAt).toBeNull()
  })

  it('a reconexão devolve o piloto sem criar um terceiro', () => {
    const clock = createClock()
    const rooms = new RoomStore({ now: clock.now })
    const code = roomWithTwoPilots(rooms)

    rooms.markDisconnected('socket-b')
    clock.advance(3_000)
    const back = rooms.join(code, 'socket-b2', 'b', 'Beto')

    expect(back.players).toHaveLength(2)
    expect(back.players.find((player) => player.id === 'b')?.connected).toBe(true)
    expect(rooms.dropIfStillDisconnected(code, 'b')).toBeNull()
  })

  it('remove quem não volta dentro da janela', () => {
    const clock = createClock()
    const rooms = new RoomStore({ now: clock.now })
    const code = roomWithTwoPilots(rooms)

    rooms.markDisconnected('socket-b')
    clock.advance(12_000)
    const dropped = rooms.dropIfStillDisconnected(code, 'b')

    expect(dropped?.room?.players.map((player) => player.id)).toEqual(['a'])
  })

  it('a reconexão devolve o instante oficial de uma corrida em andamento', () => {
    const clock = createClock()
    const rooms = new RoomStore({ now: clock.now })
    const code = roomWithTwoPilots(rooms)
    rooms.setReady(code, 'a', true)
    rooms.setReady(code, 'b', true)
    const scheduled = rooms.scheduleStart(code)
    clock.advance(5_400)
    rooms.beginRace(code)

    clock.advance(2_000)
    const back = rooms.join(code, 'socket-b2', 'b', 'Beto')
    expect(back.status).toBe('racing')
    expect(back.startAt).toBe(scheduled?.startAt)
  })
})
