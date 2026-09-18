export const TRACK_LENGTH = 4_800
export const VIEW_DISTANCE = 430

/** Proporções da projeção pseudo-3D, compartilhadas pelo desenho e pelos efeitos. */
export const HORIZON_RATIO = 0.29
export const BOTTOM_RATIO = 0.92
export const CAR_SCREEN_RATIO = 0.82
export const PERSPECTIVE_POWER = 1.72

/**
 * Distância na pista que corresponde ao ponto onde o carro é desenhado.
 *
 * O carro fica fixo perto da base da tela enquanto o progresso corre por fora,
 * então os efeitos precisam nascer nesta distância para sair debaixo dele.
 */
export const CAR_VIEW_DISTANCE =
  VIEW_DISTANCE *
  (1 -
    Math.pow(
      (CAR_SCREEN_RATIO - HORIZON_RATIO) / (BOTTOM_RATIO - HORIZON_RATIO),
      1 / PERSPECTIVE_POWER,
    ))

export type Obstacle = {
  id: number
  distance: number
  lane: number
  kind: 'barrier' | 'debris'
}

export const obstacles: Obstacle[] = [
  { id: 1, distance: 510, lane: -0.48, kind: 'debris' },
  { id: 2, distance: 940, lane: 0.42, kind: 'barrier' },
  { id: 3, distance: 1_370, lane: 0.02, kind: 'debris' },
  { id: 4, distance: 1_840, lane: -0.52, kind: 'barrier' },
  { id: 5, distance: 2_310, lane: 0.5, kind: 'debris' },
  { id: 6, distance: 2_760, lane: -0.1, kind: 'barrier' },
  { id: 7, distance: 3_210, lane: 0.56, kind: 'debris' },
  { id: 8, distance: 3_680, lane: -0.5, kind: 'barrier' },
  { id: 9, distance: 4_120, lane: 0.08, kind: 'debris' },
  { id: 10, distance: 4_510, lane: -0.42, kind: 'barrier' },
]

/**
 * Projeção de um ponto da pista na tela, sem considerar a curva.
 *
 * Fica aqui, e não dentro do componente, para que o desenho e os efeitos usem
 * exatamente a mesma conta — e para poder ser conferida nos testes.
 */
export function roadProjection(distanceAhead: number, width: number, height: number) {
  const closeness = 1 - distanceAhead / VIEW_DISTANCE
  const perspective = Math.pow(Math.max(0, closeness), PERSPECTIVE_POWER)
  const horizon = height * HORIZON_RATIO
  const bottom = height * BOTTOM_RATIO
  return {
    perspective,
    y: horizon + perspective * (bottom - horizon),
    roadWidth: width * (0.09 + perspective * 0.8),
  }
}

/** Converte a posição na pista em deslocamento horizontal na tela. */
export function lateralOffset(lateral: number, roadWidth: number) {
  return roadWidth * lateral * 0.36
}

export function trackCurve(distance: number) {
  return (
    Math.sin(distance / 310) * 0.46 +
    Math.sin(distance / 790 + 0.8) * 0.35 +
    Math.sin(distance / 1450) * 0.18
  )
}

export function formatTime(seconds: number) {
  const safe = Math.max(0, seconds)
  const minutes = Math.floor(safe / 60)
  const remaining = safe - minutes * 60
  return `${minutes}:${remaining.toFixed(3).padStart(6, '0')}`
}

export function speedForState(offRoad: boolean, penalty: number, boosting: boolean) {
  if (offRoad) return 132
  if (penalty > 0) return 172
  if (boosting) return 314
  return 252
}
