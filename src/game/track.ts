export const TRACK_LENGTH = 4_800

/**
 * Até onde a câmera enxerga, em metros.
 *
 * Era 430 m, e isso espalhava a pista inteira por uma faixa fina da tela: os
 * primeiros 20 metros ocupavam 5% dela, e o fluxo na tela era praticamente o
 * mesmo a 3 e a 150 metros de distância — 126 contra 93 pixels por segundo.
 * O olho lê profundidade pela *diferença* entre o perto e o longe, e com essa
 * razão de 1,4 a pista desliza em vez de recuar.
 *
 * Aproximar o horizonte dobra o fluxo junto à câmera e melhora a razão para
 * 2,3. Custa metade do tempo de leitura de um obstáculo — de 6,1 s para
 * 3,1 s, ainda folgado para uma correção lateral, que leva 0,14 s.
 */
export const VIEW_DISTANCE = 215

/** Proporções da projeção pseudo-3D, compartilhadas pelo desenho e pelos efeitos. */
export const HORIZON_RATIO = 0.29
export const BOTTOM_RATIO = 0.92
export const CAR_SCREEN_RATIO = 0.82
/**
 * Distância, em metros, na qual a pista aparece em tamanho natural.
 *
 * É o parâmetro da perspectiva de verdade que substituiu a curva de
 * suavização `(1 − d/alcance)^n`. Aquela curva espalhava a pista por uma
 * faixa fina da tela: o fluxo a 3 m era só 1,4 vez o de 150 m, e o olho lê
 * profundidade justamente por essa razão. Com `1/z` a razão vai a 116, e um
 * objeto cresce 1,47× nos últimos sete metros em vez de 1,09×.
 *
 * Quanto menor este número, mais violenta a perspectiva. 12 m põe o carro a
 * 2,3 m da câmera — um plano de perseguição, não de helicóptero.
 */
export const CAMERA_DEPTH = 12

/**
 * Largura da pista na tela à distância zero, em fração da largura da tela.
 *
 * Com a perspectiva de verdade a pista junto à câmera fica larguíssima, e a
 * 0,89 ela empurrava grama, marcadores e cenário para fora do quadro — o
 * campo perto ficava vazio justamente onde mora a sensação de velocidade.
 * Com 0,70 sobra margem para os marcadores varrerem a borda da tela, que é o
 * elemento mais rápido da cena.
 */
export const ROAD_WIDTH_NEAR = 0.7

/**
 * Escala de tela no ponto onde o carro é desenhado.
 *
 * Sai de `CAR_SCREEN_RATIO` e é, por construção, independente da projeção.
 * É o que mantém `CAR_HALF_LATERAL` e `OFF_ROAD_LIMIT` no lugar quando a
 * projeção muda — e portanto o que impede uma troca de desenho de virar uma
 * mudança de regra.
 */
export const CAR_SCREEN_SCALE = (CAR_SCREEN_RATIO - HORIZON_RATIO) / (BOTTOM_RATIO - HORIZON_RATIO)


/**
 * Distância na pista que corresponde ao ponto onde o carro é desenhado.
 *
 * O carro fica fixo perto da base da tela enquanto o progresso corre por fora,
 * então os efeitos precisam nascer nesta distância para sair debaixo dele.
 */
export const CAR_VIEW_DISTANCE = CAMERA_DEPTH * (1 / CAR_SCREEN_SCALE - 1)

/** Meia-largura do desenho do carro, na escala base do sprite. */
export const CAR_SPRITE_HALF_WIDTH = 31
/** Largura de tela em que o sprite do carro é desenhado na escala 1. */
export const CAR_SPRITE_REFERENCE_WIDTH = 620

/**
 * Os cinco tipos de obstáculo.
 *
 * Os três primeiros são peças: batem. Os dois últimos são manchas no asfalto,
 * e é outro perfil de ameaça — largas o bastante para não dar para fingir que
 * não estão ali, e baratas o bastante para valer a pena passar por cima em vez
 * de jogar o carro na grama para desviar. É a decisão que a barreira nunca
 * oferece.
 */
export type ObstacleKind = 'barrier' | 'debris' | 'pothole' | 'oleo' | 'poca'

export type Obstacle = {
  id: number
  distance: number
  lane: number
  kind: ObstacleKind
}

/**
 * Meia-largura da colisão, por tipo.
 *
 * O buraco é mais estreito que uma barreira: dá para raspar nele sem cair
 * dentro. É o que permite colocá-lo na beirada sem trancar a passagem.
 */
export const HIT_HALF_WIDTH: Record<ObstacleKind, number> = {
  barrier: 0.25,
  debris: 0.25,
  pothole: 0.17,
  // A mancha é o contrário da barreira: larga e barata. O óleo cobre mais
  // pista do que qualquer peça, e é por isso que ele não pode custar caro.
  oleo: 0.34,
  poca: 0.3,
}

/**
 * Fração da penalidade que cada tipo cobra.
 *
 * Cair num buraco é um tranco, não uma batida: custa pouco mais da metade do
 * que custa acertar uma barreira de concreto.
 */
/**
 * O que conta como batida para o reset.
 *
 * Só as peças: bater numa barreira ou num cone é batida. Cair num buraco é um
 * tranco, e passar por cima de óleo ou de água é escorregar — custam o que já
 * custam, mas não se acumulam para o reset. Contá-los faria a mancha, que foi
 * posta na pista justamente para valer a pena atravessar, virar uma armadilha.
 */
export const HIT_IS_CRASH: Record<ObstacleKind, boolean> = {
  barrier: true,
  debris: true,
  pothole: false,
  oleo: false,
  poca: false,
}

export const HIT_PENALTY_SHARE: Record<ObstacleKind, number> = {
  barrier: 1,
  debris: 1,
  pothole: 0.55,
  oleo: 0.4,
  poca: 0.3,
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
 * Perspectiva de verdade: a escala cai com `1/z`, e não por uma curva de
 * suavização. É o que faz o que está perto varrer a tela e o que está longe
 * quase parar — a diferença entre uma pista que recua e uma que desliza.
 *
 * Fica aqui, e não dentro do componente, para que o desenho e os efeitos usem
 * exatamente a mesma conta — e para poder ser conferida nos testes.
 */
export function roadProjection(distanceAhead: number, width: number, height: number) {
  const perspective = CAMERA_DEPTH / (CAMERA_DEPTH + Math.max(0, distanceAhead))
  const horizon = height * HORIZON_RATIO
  const bottom = height * BOTTOM_RATIO
  return {
    perspective,
    y: horizon + perspective * (bottom - horizon),
    roadWidth: width * ROAD_WIDTH_NEAR * perspective,
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

/**
 * Meia-largura do asfalto, em metros: duas faixas de 5,5 m.
 *
 * A projeção não precisa dela — a pista é desenhada em frações da tela. Quem
 * precisa é a tangência: numa curva, a linha por dentro é mais curta que a de
 * fora, e a diferença é a curvatura vezes a distância ao centro **em metros**.
 */
export const ROAD_HALF_WIDTH_M = 5.5

/** Metros por unidade de posição lateral, na mesma régua da borda do asfalto. */
export const METERS_PER_LATERAL = ROAD_HALF_WIDTH_M / ROAD_EDGE

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
 * Face do muro de pneus por fora das super curvas, em posição lateral.
 *
 * Um metro de grama depois do asfalto, e o muro: é a área de escape curta de
 * Mônaco, e é de propósito. Na curva comum, sair largo custa grama; na super
 * curva, custa uma batida.
 */
export const SUPER_CURVE_WALL = ROAD_EDGE + 0.17

/** Até onde o centro do carro chega antes de encostar no muro. */
export const WALL_LIMIT = SUPER_CURVE_WALL - CAR_HALF_LATERAL

/**
 * Marcadores na lateral da pista.
 *
 * São a principal referência de velocidade: passam perto da câmera e varrem a
 * tela muito mais rápido que a pista ao longe. Ficam em distâncias absolutas
 * e múltiplas do espaçamento, então nunca piscam nem mudam de lugar entre um
 * quadro e outro. São percorridos junto com o cenário, no mesmo laço de
 * profundidade: cada vaga par do cenário cai sobre um marcador.
 */
export const ROADSIDE_SPACING = 12
/** Ficam do lado de fora do asfalto, sem invadir a faixa jogável. */
export const ROADSIDE_LATERAL = ROAD_EDGE + 0.14
/** Um marcador alto a cada tantos, para dar ritmo à contagem. */
export const ROADSIDE_TALL_EVERY = 5

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
 *
 * Dobrou junto com o encurtamento da distância de visão: com a janela pela
 * metade, o desvio acumulado dentro dela também cai pela metade. Sem a
 * compensação, aproximar o horizonte teria endireitado as curvas de brinde.
 */
export const CURVE_BEND_SCALE = 0.0024

/**
 * Conversão da altura da linha central, em metros, para pixels na tela.
 *
 * O par deste número é `CURVE_BEND_SCALE`: um decide o quanto a curva aparece,
 * o outro o quanto a lomba aparece. Ele é limitado pelo mesmo motivo que a
 * inclinação: alto demais, a pista se dobra sobre si mesma numa crista.
 *
 * Deixou de ser limitado pela projeção quando o desenho passou a recortar
 * geometria escondida. Antes disso o teto vinha da condição de a pista não se
 * dobrar sobre si mesma; agora a dobra é tratada, e o número é escolhido pelo
 * que se quer ver. Medido em 60 sementes × 3 alturas de tela: com este valor,
 * o pior quadro esconde 1% das fatias da pista.
 */
export const SLOPE_RISE_SCALE = 0.07

export function formatTime(seconds: number) {
  const safe = Math.max(0, seconds)
  const minutes = Math.floor(safe / 60)
  const remaining = safe - minutes * 60
  return `${minutes}:${remaining.toFixed(3).padStart(6, '0')}`
}
