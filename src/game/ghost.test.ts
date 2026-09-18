import { describe, expect, it } from 'vitest'
import {
  gapBetween,
  GhostTracker,
  INTERPOLATION_DELAY_MS,
  MAX_EXTRAPOLATION_MS,
  offScreenNotice,
  positionNotice,
  rivalSide,
  type GhostSnapshot,
} from './ghost'

const BASE = 1_000_000

function snapshot(t: number, progress: number, extra: Partial<GhostSnapshot> = {}): GhostSnapshot {
  return { t, progress, lateral: 0, speed: 252, state: 'racing', ...extra }
}

/** Preenche o buffer com medições regulares, como o rival enviaria. */
function comTelemetriaRegular(tracker: GhostTracker, quantidade = 6, intervalo = 100) {
  for (let index = 0; index < quantidade; index += 1) {
    tracker.push(snapshot(BASE + index * intervalo, index * 7))
  }
}

describe('interpolação do fantasma', () => {
  it('sem telemetria não há fantasma para desenhar', () => {
    expect(new GhostTracker().sample(BASE)).toBeNull()
  })

  it('interpola entre duas medições em vez de saltar', () => {
    const tracker = new GhostTracker()
    tracker.push(snapshot(BASE, 100))
    tracker.push(snapshot(BASE + 200, 140))

    // Meio caminho entre as duas medições, já descontado o atraso de render.
    const amostra = tracker.sample(BASE + 100 + INTERPOLATION_DELAY_MS)
    expect(amostra?.progress).toBeCloseTo(120, 5)
    expect(amostra?.stale).toBe(false)
  })

  it('interpola a posição lateral junto com o progresso', () => {
    const tracker = new GhostTracker()
    tracker.push(snapshot(BASE, 100, { lateral: -0.4 }))
    tracker.push(snapshot(BASE + 200, 140, { lateral: 0.4 }))
    expect(tracker.sample(BASE + 100 + INTERPOLATION_DELAY_MS)?.lateral).toBeCloseTo(0, 5)
  })

  it('desenha o fantasma no passado recente, e não na última medição', () => {
    const tracker = new GhostTracker()
    comTelemetriaRegular(tracker)
    const agora = BASE + 500
    const amostra = tracker.sample(agora)
    const ultima = tracker.latest!
    expect(amostra!.progress).toBeLessThan(ultima.progress)
  })
})

describe('pacotes atrasados e fora de ordem', () => {
  it('aceita uma medição que chega fora de ordem', () => {
    const tracker = new GhostTracker()
    tracker.push(snapshot(BASE, 100))
    tracker.push(snapshot(BASE + 200, 140))
    tracker.push(snapshot(BASE + 100, 120)) // chegou atrasada

    expect(tracker.sample(BASE + 100 + INTERPOLATION_DELAY_MS)?.progress).toBeCloseTo(120, 5)
    expect(tracker.latest?.t).toBe(BASE + 200)
  })

  it('ignora medições repetidas', () => {
    const tracker = new GhostTracker()
    tracker.push(snapshot(BASE, 100))
    tracker.push(snapshot(BASE, 999))
    expect(tracker.sample(BASE)?.progress).toBe(100)
  })

  it('um pacote atrasado não faz o fantasma voltar', () => {
    const tracker = new GhostTracker()
    tracker.push(snapshot(BASE, 100))
    tracker.push(snapshot(BASE + 400, 200))

    const antes = tracker.sample(BASE + 400 + INTERPOLATION_DELAY_MS)!.progress
    // Uma medição antiga só agora entregue pela rede.
    tracker.push(snapshot(BASE + 150, 120))
    const depois = tracker.sample(BASE + 410 + INTERPOLATION_DELAY_MS)!.progress

    expect(depois).toBeGreaterThanOrEqual(antes)
  })

  it('o fantasma nunca anda para trás em uma sequência embaralhada', () => {
    const tracker = new GhostTracker()
    const medicoes = Array.from({ length: 30 }, (_, index) => snapshot(BASE + index * 100, index * 7))
    const embaralhadas = [...medicoes].sort(() => Math.random() - 0.5)

    let anterior = -Infinity
    for (const medicao of embaralhadas) {
      tracker.push(medicao)
      const amostra = tracker.sample(medicao.t + INTERPOLATION_DELAY_MS)
      if (!amostra) continue
      expect(amostra.progress).toBeGreaterThanOrEqual(anterior)
      anterior = amostra.progress
    }
  })

  it('não dá saltos grandes entre quadros consecutivos', () => {
    const tracker = new GhostTracker()
    comTelemetriaRegular(tracker, 12)

    let anterior: number | null = null
    for (let agora = BASE; agora <= BASE + 1_100; agora += 16) {
      const amostra = tracker.sample(agora)
      if (!amostra) continue
      // Em 16 ms o carro mais rápido percorre menos de 1,5 m.
      if (anterior !== null) expect(amostra.progress - anterior).toBeLessThan(1.5)
      anterior = amostra.progress
    }
  })
})

describe('perda de sinal', () => {
  it('projeta o movimento por um instante quando a telemetria falha', () => {
    const tracker = new GhostTracker()
    tracker.push(snapshot(BASE, 100, { speed: 360 })) // 100 m/s

    const amostra = tracker.sample(BASE + INTERPOLATION_DELAY_MS + 300)
    expect(amostra?.progress).toBeCloseTo(130, 5)
    expect(amostra?.stale).toBe(false)
  })

  it('marca o fantasma como sem sinal e para de avançar', () => {
    const tracker = new GhostTracker()
    tracker.push(snapshot(BASE, 100, { speed: 360 }))

    const limite = tracker.sample(BASE + INTERPOLATION_DELAY_MS + MAX_EXTRAPOLATION_MS + 400)
    expect(limite?.stale).toBe(true)
    expect(limite?.progress).toBeCloseTo(100 + MAX_EXTRAPOLATION_MS / 10, 5)
  })

  it('quem já chegou não continua andando', () => {
    const tracker = new GhostTracker()
    tracker.push(snapshot(BASE, 4_800, { state: 'finished', speed: 252 }))
    const amostra = tracker.sample(BASE + INTERPOLATION_DELAY_MS + 400)
    expect(amostra?.progress).toBe(4_800)
    expect(amostra?.state).toBe('finished')
  })

  it('reiniciar limpa o histórico para a próxima corrida', () => {
    const tracker = new GhostTracker()
    comTelemetriaRegular(tracker)
    tracker.reset()
    expect(tracker.sample(BASE + 1_000)).toBeNull()
    expect(tracker.latest).toBeNull()
  })
})

describe('posição relativa', () => {
  it('coloca o jogador em P2 quando o rival está à frente', () => {
    const gap = gapBetween(300, 320, 252, 252)
    expect(gap.meters).toBe(20)
    expect(gap.ahead).toBe(true)
    expect(gap.position).toBe('P2')
  })

  it('coloca o jogador em P1 quando lidera', () => {
    const gap = gapBetween(320, 300, 252, 252)
    expect(gap.meters).toBe(-20)
    expect(gap.ahead).toBe(false)
    expect(gap.position).toBe('P1')
  })

  it('converte a distância em segundos pelo ritmo da dupla', () => {
    // 70 m/s de ritmo médio: 70 metros equivalem a 1 segundo.
    const gap = gapBetween(0, 70, 252, 252)
    expect(gap.seconds).toBeCloseTo(1, 2)
  })

  it('não explode os segundos com os carros quase parados', () => {
    const gap = gapBetween(0, 20, 0, 0)
    expect(Number.isFinite(gap.seconds)).toBe(true)
    expect(gap.seconds).toBeLessThan(2)
  })

  it('identifica o lado do rival', () => {
    expect(rivalSide(0.3, -0.4)).toBe('esquerda')
    expect(rivalSide(-0.4, 0.3)).toBe('direita')
    expect(rivalSide(0.2, 0.25)).toBe('mesma faixa')
  })

  it('escreve os avisos no formato do plano', () => {
    expect(positionNotice(gapBetween(300, 398, 252, 252))).toBe('P2 — Rival 1,4 s à frente')
    expect(offScreenNotice(gapBetween(300, 220, 252, 252), 'esquerda')).toBe(
      'Adversário atrás — lado esquerda — 80 m',
    )
  })
})
