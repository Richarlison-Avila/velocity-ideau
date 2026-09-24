import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { passosParaRecuperar, QUEDA_DA_TRILHA, type HostDaTrilha } from './banda'
import { TrilhaRock } from './trilha'
import { TrilhaTurbo } from './trilhaTurbo'

/**
 * Um contexto de áudio de mentira: cada nó aceita qualquer chamada, e o que
 * interessa fica anotado — em que instante cada fonte começou a tocar.
 */
function hostFalso() {
  const inicios: number[] = []
  const parametro = () => new Proxy({}, { get: () => () => {} })
  const no = () => {
    const campos: Record<PropertyKey, unknown> = {}
    const proxy: object = new Proxy(campos, {
      get(alvo, chave) {
        if (chave in alvo) return alvo[chave]
        if (chave === 'connect') return (destino: unknown) => destino
        if (chave === 'start') return (quando = 0) => void inicios.push(quando)
        if (chave === 'stop' || chave === 'disconnect') return () => {}
        return parametro()
      },
      set(alvo, chave, valor) {
        alvo[chave] = valor
        return true
      },
    })
    return proxy
  }
  const host = {
    currentTime: 0,
    createOscillator: no,
    createGain: no,
    createBiquadFilter: no,
    createBufferSource: no,
    createWaveShaper: no,
    createDelay: no,
  }
  return { host: host as unknown as HostDaTrilha & { currentTime: number }, inicios, destino: no() as AudioNode }
}

/** Faz o relógio do áudio e o agendador andarem juntos, de 25 em 25 ms. */
function andar(host: { currentTime: number }, ate: number) {
  while (host.currentTime < ate - 1e-9) {
    host.currentTime += 0.025
    vi.advanceTimersByTime(25)
  }
}

describe('trilha desligada', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  for (const [nome, criar] of [
    ['banda de rock', (h: HostDaTrilha, d: AudioNode) => new TrilhaRock(h, d, {} as AudioBuffer)],
    ['turbo', (h: HostDaTrilha, d: AudioNode) => new TrilhaTurbo(h, d, {} as AudioBuffer)],
  ] as const) {
    it(`${nome}: para de montar notas depois da queda e volta sem ataque no passado`, () => {
      const { host, inicios, destino } = hostFalso()
      const trilha = criar(host, destino)
      trilha.start()
      andar(host, 1)
      expect(inicios.length).toBeGreaterThan(0)

      trilha.setEnabled(false)
      const desligouEm = host.currentTime
      const antes = inicios.length
      andar(host, 5)
      // Nada nasce depois da queda (com a folga de uma nota dedilhada).
      const depoisDaQueda = inicios.slice(antes).filter((t) => t > desligouEm + QUEDA_DA_TRILHA + 0.2)
      expect(depoisDaQueda).toEqual([])

      const religouEm = host.currentTime
      const antesDeReligar = inicios.length
      trilha.setEnabled(true)
      andar(host, 6)
      const novos = inicios.slice(antesDeReligar)
      expect(novos.length).toBeGreaterThan(0)
      // Nenhuma nota agendada no passado, que atacaria junto no instante de religar.
      expect(Math.min(...novos)).toBeGreaterThanOrEqual(religouEm)
      trilha.stop()
    })
  }

  it('desligada desde antes de começar, não monta nota nenhuma', () => {
    const { host, inicios, destino } = hostFalso()
    const trilha = new TrilhaRock(host, destino, {} as AudioBuffer)
    trilha.setEnabled(false)
    trilha.start()
    andar(host, 3)
    expect(inicios).toEqual([])
    trilha.stop()
  })
})

describe('passos recuperados ao religar', () => {
  it('só os passos pulados que ainda estão no futuro', () => {
    // Próximo passo em 5,2; os de 5,1 e 5,0 foram pulados. Agora é 5,0: só o
    // de 5,1 ainda não passou.
    expect(passosParaRecuperar(5.2, 0.1, 5, 1)).toBe(1)
    // Com antecedência maior, os dois.
    expect(passosParaRecuperar(5.2, 0.1, 4.95, 1)).toBe(2)
  })

  it('nada a recuperar se a música voltou antes de a queda acabar', () => {
    expect(passosParaRecuperar(5.14, 0.1, 5, 4.9)).toBe(0)
  })

  it('desligada desde o começo, tudo o que está no futuro foi pulado', () => {
    expect(passosParaRecuperar(0.35, 0.1, 0.1, null)).toBe(2)
  })
})
