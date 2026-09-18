import { VIEW_DISTANCE } from './track'

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
 */
export const WHEEL_OFFSET = 0.17

/**
 * Recuo, em metros, entre o ponto onde o carro é desenhado e onde o efeito
 * nasce. Poeira e marcas saem de trás das rodas, não da frente do bico.
 */
export const TRAIL_SETBACK = 9

/** Meia largura do carro desenhado, em pixels na escala base. */
export const CAR_HALF_WIDTH = 31

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

  /** Efeitos dentro do campo de visão, do mais distante para o mais próximo. */
  visible(progress: number) {
    return this.items
      .map((particle) => ({ particle, ahead: particle.distance - progress }))
      .filter((item) => item.ahead > 0 && item.ahead < VIEW_DISTANCE)
      .sort((a, b) => b.ahead - a.ahead)
  }

  clear() {
    this.items = []
  }
}

/**
 * Controla a cadência de emissão sem depender da taxa de quadros: acumula o
 * tempo e devolve quantas partículas nascem neste passo.
 */
export class EmissionRate {
  private accumulated = 0

  constructor(private readonly perSecond: number) {}

  take(dt: number, active: boolean) {
    if (!active) {
      this.accumulated = 0
      return 0
    }
    this.accumulated += dt * this.perSecond
    const quantidade = Math.floor(this.accumulated)
    this.accumulated -= quantidade
    return quantidade
  }
}
