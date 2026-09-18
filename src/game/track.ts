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

/** Meia-largura do desenho do carro, na escala base do sprite. */
export const CAR_SPRITE_HALF_WIDTH = 31
/** Largura de tela em que o sprite do carro é desenhado na escala 1. */
export const CAR_SPRITE_REFERENCE_WIDTH = 620

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

/** Fração da largura da pista usada para converter posição lateral em pixels. */
export const LATERAL_SCALE = 0.36

/** Converte a posição na pista em deslocamento horizontal na tela. */
export function lateralOffset(lateral: number, roadWidth: number) {
  return roadWidth * lateral * LATERAL_SCALE
}

/**
 * Posição lateral da borda do asfalto.
 *
 * Sai direto da projeção: a meia-largura da pista dividida pelo fator de
 * conversão. Como os dois escalam com a largura da tela, o valor é o mesmo em
 * qualquer aparelho e em qualquer profundidade.
 */
export const ROAD_EDGE = 0.5 / LATERAL_SCALE

/** Meia-largura do carro desenhado, em unidades de posição lateral. */
export const CAR_HALF_LATERAL =
  CAR_SPRITE_HALF_WIDTH /
  CAR_SPRITE_REFERENCE_WIDTH /
  (roadProjection(CAR_VIEW_DISTANCE, 1, 1).roadWidth * LATERAL_SCALE)

/**
 * O carro sai da pista quando as rodas cruzam a borda do asfalto.
 *
 * Antes este limite era um número solto, e a punição disparava com o carro
 * ainda visivelmente sobre o asfalto. Agora ele é derivado da mesma geometria
 * que desenha a pista, então o que o jogador vê é o que o jogo cobra.
 */
export const OFF_ROAD_LIMIT = ROAD_EDGE - CAR_HALF_LATERAL

/** Até onde o carro chega na grama antes de o limite físico segurá-lo. */
export const LATERAL_LIMIT = ROAD_EDGE + 0.16

/**
 * Marcadores na lateral da pista.
 *
 * São a principal referência de velocidade: passam perto da câmera e varrem a
 * tela muito mais rápido que a pista ao longe. Ficam em distâncias absolutas
 * e múltiplas do espaçamento, então nunca piscam nem mudam de lugar entre um
 * quadro e outro. O render percorre os índices direto, sem montar lista.
 */
export const ROADSIDE_SPACING = 20
/** Ficam do lado de fora do asfalto, sem invadir a faixa jogável. */
export const ROADSIDE_LATERAL = ROAD_EDGE + 0.14
/** Um marcador alto a cada tantos, para dar ritmo à contagem. */
export const ROADSIDE_TALL_EVERY = 5

/** Primeiro marcador ainda à frente da câmera. */
export function firstRoadsideIndex(progress: number) {
  return Math.ceil(progress / ROADSIDE_SPACING)
}

/** Último marcador dentro do campo de visão. */
export function lastRoadsideIndex(progress: number) {
  return Math.floor((progress + VIEW_DISTANCE) / ROADSIDE_SPACING)
}

export function isTallMarker(index: number) {
  return index % ROADSIDE_TALL_EVERY === 0
}

/**
 * Conversão do deslocamento da linha central, em metros, para pixels de
 * curvatura na tela.
 *
 * O traçado é gerado em metros por `layout.ts`; este é o único número que
 * decide o quanto isso aparece. Com o rumo máximo de 0,42 rad, a linha do
 * horizonte chega a cerca de 23% da largura da tela fora do centro — visível,
 * sem jogar a pista para fora do quadro.
 */
export const CURVE_BEND_SCALE = 0.0012

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
