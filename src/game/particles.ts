import { CAR_HALF_LATERAL, VIEW_DISTANCE } from './track'

/**
 * Efeitos da pista: poeira ao sair do asfalto, faíscas no impacto, rastro do
 * boost e marcas de pneu.
 *
 * Cada efeito guarda a distância absoluta onde nasceu, então ele desce a tela
 * junto com a pista sem precisar saber nada sobre a câmera. A quantidade é
 * limitada de propósito: o jogo roda em celular e partícula demais gasta
 * bateria sem melhorar a sensação de velocidade.
 */

export type ParticleKind = 'dust' | 'spark' | 'boost' | 'skid'

export type Particle = {
  kind: ParticleKind
  /** Distância absoluta na pista onde o efeito nasceu. */
  distance: number
  lateral: number
  /** Segundos restantes de vida. */
  life: number
  maxLife: number
  /** Deslocamento lateral por segundo. */
  drift: number
  /** Subida na tela por segundo, em pixels. */
  lift: number
  size: number
}

/** Teto de partículas simultâneas, para não pesar em aparelhos modestos. */
export const MAX_PARTICLES = 110

/**
 * Afastamento lateral em que os efeitos nascem, medido a partir do centro do
 * carro. Precisa ser largo o bastante para a poeira aparecer ao lado da
 * carroceria: nascendo no centro, o próprio carro esconderia tudo.
 *
 * Derivado da meia-largura do carro, e não um número fixo. Era 0,17, e ao
 * estreitar a pista a poeira passou a nascer dentro da silhueta — o mesmo
 * tipo de constante solta que já tinha causado problema no limite de saída
 * de pista e na posição lateral dos obstáculos.
 */
export const WHEEL_OFFSET = CAR_HALF_LATERAL * 1.05

/**
 * Recuo, em metros, entre o ponto onde o carro é desenhado e onde o efeito
 * nasce. Poeira e marcas saem de trás das rodas, não da frente do bico.
 *
 * Encolheu junto com a distância do carro à câmera. Com a perspectiva de
 * verdade o carro é desenhado a 2,3 m dela, então o recuo tem de caber nesse
 * espaço — qualquer valor maior jogaria o rastro atrás da câmera, onde ele
 * simplesmente não existe.
 */
export const TRAIL_SETBACK = 0.9

export type SpawnOptions = {
  life?: number
  drift?: number
  lift?: number
  size?: number
}

const DEFAULTS: Record<ParticleKind, Required<SpawnOptions>> = {
  dust: { life: 0.7, drift: 0.25, lift: 26, size: 9 },
  spark: { life: 0.45, drift: 0.9, lift: 64, size: 5 },
  boost: { life: 0.35, drift: 0, lift: 10, size: 7 },
  skid: { life: 3, drift: 0, lift: 0, size: 6 },
}

export class ParticleField {
  private items: Particle[] = []
  /** Vetor reaproveitado pela listagem, para não alocar a cada quadro. */
  private buffer: Particle[] = []

  get count() {
    return this.items.length
  }

  get all(): readonly Particle[] {
    return this.items
  }

  spawn(kind: ParticleKind, distance: number, lateral: number, options: SpawnOptions = {}) {
    const preset = DEFAULTS[kind]
    const life = options.life ?? preset.life
    this.items.push({
      kind,
      distance,
      lateral,
      life,
      maxLife: life,
      drift: options.drift ?? preset.drift,
      lift: options.lift ?? preset.lift,
      size: options.size ?? preset.size,
    })
    // Acima do teto, as partículas mais antigas somem primeiro.
    if (this.items.length > MAX_PARTICLES) this.items.splice(0, this.items.length - MAX_PARTICLES)
  }

  burst(kind: ParticleKind, quantidade: number, distance: number, lateral: number, options: SpawnOptions = {}) {
    for (let index = 0; index < quantidade; index += 1) {
      const spread = (index / Math.max(1, quantidade - 1) - 0.5) * 2
      this.spawn(kind, distance, lateral, {
        ...options,
        drift: (options.drift ?? DEFAULTS[kind].drift) * spread,
      })
    }
  }

  /** Envelhece os efeitos e descarta o que morreu ou já passou pela câmera. */
  update(dt: number, progress: number) {
    const alive: Particle[] = []
    for (const particle of this.items) {
      particle.life -= dt
      particle.lateral += particle.drift * dt
      if (particle.life <= 0) continue
      if (particle.distance < progress - 2) continue
      alive.push(particle)
    }
    this.items = alive
  }

  /**
   * Efeitos dentro do campo de visão, do mais distante para o mais próximo.
   *
   * Reaproveita sempre o mesmo vetor e não cria objeto nenhum: isso roda a
   * cada quadro, com até uma centena de partículas, em celular.
   */
  visible(progress: number): readonly Particle[] {
    this.buffer.length = 0
    for (const particle of this.items) {
      const ahead = particle.distance - progress
      if (ahead > 0 && ahead < VIEW_DISTANCE) this.buffer.push(particle)
    }
    // Mesmo progresso para todos, então ordenar por distância ordena por `ahead`.
    this.buffer.sort((a, b) => b.distance - a.distance)
    return this.buffer
  }

  clear() {
    this.items = []
    this.buffer.length = 0
  }
}

/**
 * Controla a cadência de emissão sem depender da taxa de quadros: acumula o
 * tempo e devolve quantas partículas nascem neste passo.
 */
export class EmissionRate {
  private accumulated = 0

  constructor(private readonly perSecond: number) {}

  /**
   * @param intensity Multiplicador contínuo de 0 a 1 ou mais. Permite que a
   * poeira aumente com a velocidade em vez de só ligar e desligar.
   */
  take(dt: number, active: boolean, intensity = 1) {
    if (!active || intensity <= 0) {
      this.accumulated = 0
      return 0
    }
    this.accumulated += dt * this.perSecond * intensity
    const quantidade = Math.floor(this.accumulated)
    this.accumulated -= quantidade
    return quantidade
  }
}
