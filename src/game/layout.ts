// A extensão .js segue a convenção do módulo: o Vite resolve para o .ts.
import { rulesFor } from './rules.js'
import { MAX_CORNER_LOAD, type RaceContext } from './simulation.js'
import { METERS_PER_LATERAL, TRACK_LENGTH, VIEW_DISTANCE } from './track.js'

/**
 * Traçado e cenário gerados a partir da semente oficial da corrida.
 *
 * Tudo aqui é função pura da semente e de um índice estável — nunca do
 * relógio, da taxa de quadros ou da ordem em que as coisas são desenhadas.
 * É o que garante que os dois pilotos corram na mesma pista: cada aparelho
 * reconstrói o traçado sozinho, a partir do mesmo número, e chega ao mesmo
 * resultado até o último dígito.
 *
 * O relevo e o cenário são apresentação. A curvatura deixou de ser: ela entra
 * na simulação como força lateral, porque uma curva que não cobra nada não é
 * uma curva, e como linha — por dentro o caminho é mais curto. Isso não abre
 * brecha de justiça: a semente é estado oficial da sala, os dois pilotos
 * reconstroem o mesmo traçado, e a física nunca deixa a linha fazer o carro
 * avançar mais depressa que o teto do nível, que é o que o piso de tempo do
 * servidor usa.
 *
 * Os obstáculos, que são o layout competitivo, continuam fixos.
 */

/** Mistura inteira de 32 bits. Mesma entrada, mesma saída, em qualquer aparelho. */
export function hash32(seed: number, index: number) {
  let h = (seed ^ 0x9e3779b9) >>> 0
  h = Math.imul(h ^ (index + 0x165667b1), 0x85ebca6b) >>> 0
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35) >>> 0
  h ^= h >>> 16
  return h >>> 0
}

/**
 * Número em [0, 1) a partir da semente, de um índice e de um canal.
 *
 * O canal permite tirar várias decisões independentes do mesmo índice — lado,
 * escala, tom — sem que uma contamine a outra.
 *
 * **Canais em uso.** A lista mora aqui porque ela não existe em lugar nenhum
 * além da memória de quem escreveu, e reusar um canal por engano faz duas
 * decisões independentes andarem juntas — um defeito que não quebra nada e não
 * aparece em teste, só deixa a pista estranhamente regular.
 *
 * | Canal | Decisão |
 * | --- | --- |
 * | 1, 2 | rumo do trecho e sorteio de reta |
 * | 3, 4 | inclinação do trecho e sorteio de plano |
 * | 7, 8 | densidade e famílias da região |
 * | 11 a 16 | vaga do cenário: existe, família, afastamento, escala, tom, variante |
 * | 21 | ambiente da corrida |
 * | 22, 23 | pórtico: se existe naquele marco e qual faixa leva |
 * | 24, 25, 26 | super curva: onde começa, para que lado vira e de que tipo é |
 */
export function randomAt(seed: number, index: number, canal = 0) {
  return hash32(seed ^ Math.imul(canal + 1, 0x27d4eb2f), index) / 0x100000000
}

// ---------------------------------------------------------------------------
// Curvas
// ---------------------------------------------------------------------------

/** Comprimento de cada trecho de rumo constante, em metros. */
export const CURVE_SEGMENT = 100

/**
 * Rumo máximo do traçado comum, em radianos.
 *
 * Nasceu como limite de desenho: com a câmera presa ao eixo do mundo, a pista
 * não podia passar de 24° em relação a ela. A câmera foi para o referencial do
 * carro, e o limite ficou como o que ele sempre foi para quem dirige — o ritmo
 * das curvas comuns, cuja maior inversão, de um extremo ao outro, dá 48°.
 * Virar 90° ou mais é trabalho das super curvas, que ficam fora desta conta.
 */
export const HEADING_LIMIT = 0.42

/** Maior mudança de rumo sorteada de um trecho para o seguinte. */
export const HEADING_STEP = 0.4

/** Puxão de volta ao eixo, para o traçado não fugir sempre para o mesmo lado. */
export const HEADING_RETURN = 0.34

/** Proporção de trechos que mantêm o rumo do anterior: as retas. */
export const STRAIGHT_SHARE = 0.18

/**
 * Menor virada de um trecho que não é reta, em frações de `HEADING_STEP`.
 *
 * O sorteio uniforme deixava metade dos trechos com curva virando quase nada:
 * nem reta de verdade, onde vale a pena soltar o boost, nem curva de verdade,
 * que cobra alguma coisa. Com o piso, o que não é reta vira.
 */
export const MIN_TURN = 0.45

/**
 * Metros de reta na largada.
 *
 * A arrancada sai de uma velocidade baixa e precisa de uma referência sem
 * curva para o ganho ser legível — e ninguém deve ter de brigar com a curva
 * antes de o carro chegar ao ritmo.
 */
export const START_STRAIGHT = 260

/**
 * Maior mudança de rumo possível de um trecho para o seguinte.
 *
 * Não é só o sorteio: o termo de retorno soma quando o rumo anterior está no
 * extremo oposto ao sorteado. É esse o pior caso.
 */
export const MAX_HEADING_DELTA = HEADING_STEP + HEADING_RETURN * HEADING_LIMIT

/**
 * Maior curvatura possível, em radianos por metro.
 *
 * Sai da própria construção: o rumo varia por uma suavização cuja inclinação
 * máxima é 1,5, então a curvatura nunca passa de 1,5 × ΔRumo ÷ comprimento.
 * Corresponde a um raio de cerca de 123 m — uma curva rápida, não uma quina.
 * O grampo chega a 21 m.
 */
export const MAX_CURVATURE = (1.5 * MAX_HEADING_DELTA) / CURVE_SEGMENT

/**
 * Quanto da curvatura acima da maior curva comum vira carga, por unidade.
 *
 * A super curva é cinco vezes mais fechada que a pior curva comum, e em carga
 * cheia isso pediria um carro a 100 km/h — num jogo sem freio, a grama na
 * certa. Acima da curva comum a carga cresce bem mais devagar: continua
 * monótona, então o que parece mais fechado empurra mais, mas o grampo de 180°
 * fica em um quarto a mais que a pior curva comum.
 *
 * É a regra de Top Gear: a curva fechada se vê — na pista que chicoteia, no
 * horizonte que inclina, no carro atravessando —, e se faz segurando o volante.
 * Em cruzeiro, no centro da pista, o grampo pede pouco mais de 90% do volante;
 * por dentro pede mais que isso, e de boost ele joga o carro no muro. Com 0,36
 * o grampo pedia três vezes e meia o volante, e ninguém fazia curva nenhuma.
 */
export const SUPER_LOAD_SLOPE = 0.052

/**
 * Curvatura na escala com que a física trabalha.
 *
 * De -1 a 1 nas curvas comuns; as super curvas passam disso, até
 * `MAX_CORNER_LOAD`. A simulação não conhece radianos por metro nem os
 * comprimentos de onda do traçado — e não deve, senão passaria a depender do
 * gerador. Recebe esta fração, e a conversão fica aqui, ao lado do número que
 * a define, com nome e teste próprios.
 */
export function curvatureLoad(curvature: number) {
  const relativa = Math.abs(curvature) / MAX_CURVATURE
  const carga = relativa <= 1 ? relativa : 1 + (relativa - 1) * SUPER_LOAD_SLOPE
  return Math.sign(curvature) * Math.min(carga, MAX_CORNER_LOAD)
}

// ---------------------------------------------------------------------------
// Super curvas
// ---------------------------------------------------------------------------

/**
 * Uma curva que o traçado comum não faz: de 90 a 270 graus em pouco mais de
 * cem metros.
 *
 * O traçado comum é uma sucessão de trechos de rumo suave e nunca vira mais de
 * meio radiano num trecho — é o que dá ritmo à prova. A super curva é o
 * contrário: rara, anunciada e brutal. Vira de uma vez, empurra o dobro da
 * pior curva comum, e é nela que se decide se o piloto entrou do jeito certo.
 *
 * Não existia em pseudo-3D por um motivo técnico: a câmera ficava presa ao
 * eixo do mundo, e uma pista de 90° em relação a ela vira uma linha deitada.
 * Com a câmera no referencial do carro (`lateralAhead`), a pista pode dar a
 * volta que quiser.
 */
export type SuperCurve = {
  /** Número da curva na prova, a partir de 1. É a chave da tangência. */
  id: number
  /** Onde ela começa a virar, em metros. */
  start: number
  /** Onde termina de virar. */
  end: number
  /** Ponto de maior curvatura, no meio dela. */
  apex: number
  /** Onde começa o trecho da zebra de dentro que conta como tangência. */
  kerbStart: number
  /** Onde ele termina. */
  kerbEnd: number
  /** Para que lado vira: 1 à direita, -1 à esquerda. */
  side: 1 | -1
  /** Quanto o rumo muda, em radianos, sempre positivo. */
  turn: number
  /** Nome que a nota de curva anuncia. */
  name: string
  /** Carga no ápice, na escala da física: quanto ela empurra. */
  peakLoad: number
  /**
   * Verdadeiro na segunda metade de um S: ela emenda na anterior, sem reta
   * entre as duas, e vira para o outro lado.
   */
  linked: boolean
  /**
   * Se a curva tem zebra de tangência.
   *
   * Toda super curva tem, menos a segunda metade do S. Para tangenciar as duas,
   * o carro teria de atravessar a pista inteira entre um ápice e o outro antes
   * de a segunda metade começar a empurrar — e isso exige largar o lado de
   * dentro da primeira antes do ápice dela. Medido: nem o piloto de teste, que
   * não erra tempo de reação, consegue as duas. Uma zebra que ninguém alcança
   * é enfeite; no S, a tangência é a da entrada, e a segunda metade é para
   * virar para o outro lado sem ir parar no muro.
   */
  tangency: boolean
}

/** Um trecho de super curva: quanto vira, em quanta pista, e para que lado em relação ao sorteado. */
type TrechoDeSuperCurva = { virada: number; comprimento: number; sentido: 1 | -1 }

type TipoDeSuperCurva = { nome: string; trechos: readonly TrechoDeSuperCurva[] }

/**
 * Os quatro tipos.
 *
 * O raio no ápice é o comprimento dividido por 1,5 vez a virada — a inclinação
 * máxima da suavização. Todos ficam entre 21 e 27 metros: é o que faz deles
 * curvas de outra ordem, e não curvas comuns mais compridas. O grampo é o mais
 * fechado; o caracol é quase tão fechado quanto ele, e dura o dobro.
 *
 * O S são duas curvas de 100° emendadas, uma para cada lado, sem reta no meio:
 * quem sai da primeira por fora já está do lado de dentro da segunda — se
 * sobreviveu à primeira.
 */
export const SUPER_CURVE_TYPES: readonly TipoDeSuperCurva[] = [
  { nome: 'COTOVELO', trechos: [{ virada: Math.PI / 2, comprimento: 64, sentido: 1 }] },
  { nome: 'GRAMPO', trechos: [{ virada: Math.PI, comprimento: 100, sentido: 1 }] },
  { nome: 'CARACOL', trechos: [{ virada: (3 * Math.PI) / 2, comprimento: 165, sentido: 1 }] },
  {
    nome: 'S',
    trechos: [
      { virada: (5 * Math.PI) / 9, comprimento: 64, sentido: 1 },
      { virada: (5 * Math.PI) / 9, comprimento: 64, sentido: -1 },
    ],
  },
]

/**
 * Quantas super curvas cada prova tem: uma de cada tipo, em ordem sorteada.
 *
 * O número é fixo, e os tipos também, para o tempo de prova não depender da
 * sorte da semente — a demonstração tem janela de 60 a 90 segundos em
 * qualquer traçado. O sorteio decide a ordem, o lado e o lugar.
 */
export const SUPER_CURVE_UNITS = SUPER_CURVE_TYPES.length

/** Quantos trechos de super curva a prova tem: o S conta dois. */
export const SUPER_CURVE_COUNT = SUPER_CURVE_TYPES.reduce((soma, tipo) => soma + tipo.trechos.length, 0)

/**
 * Quanto o desenho exagera o giro das super curvas.
 *
 * A física vira o que o traçado diz; o desenho vira uma vez e meia isso. A
 * régua da curva na tela já era uma escolha de arte — `CURVE_BEND_SCALE` —, e
 * nas super curvas ela passa a pesar mais: a pista chicoteia para fora da
 * tela e a paisagem gira mais do que o carro, que é o exagero de Top Gear e
 * Outrun. Fora delas o desenho é o traçado, sem nada a mais.
 */
export const SUPER_CURVE_DRAW_EXAGGERATION = 1.5

/**
 * Metros de muro depois do fim de uma super curva.
 *
 * O carro sai da curva ainda escorregando para fora, e a saída é onde a boa
 * linha mais chega perto da grama. Num S não há resto: o muro da primeira
 * metade acaba onde a segunda começa, porque ali o lado de fora da primeira é o
 * de dentro da segunda.
 */
export const SUPER_CURVE_WALL_TAIL = 25

/**
 * Metros de reta antes de cada super curva.
 *
 * É o tempo de leitura: a 250 km/h são dois segundos entre a nota de curva e
 * a entrada, que é o que um piloto precisa para soltar o boost e escolher o
 * lado. Uma curva comum emendada na super curva a esconderia atrás de si.
 */
export const SUPER_CURVE_APPROACH = 150

/** Metros de reta depois dela, para o carro endireitar antes da próxima. */
export const SUPER_CURVE_EXIT = 60

/** A primeira super curva não começa antes daqui: a prova precisa esquentar. */
export const SUPER_CURVE_FIRST = 800

/** A última termina antes daqui, para a chegada ser disputada em reta. */
export const SUPER_CURVE_LAST = 4_450

/**
 * Trecho da zebra de dentro que conta como tangência, em frações da curva.
 *
 * É o ápice, no meio da curva, onde a tangência mora em qualquer pista de
 * verdade. Já morou na entrada, quando a super curva empurrava o triplo do que
 * o volante segura e o carro cruzava a pista inteira antes do meio dela: dava
 * para ganhar a tangência só por estar do lado certo antes de virar, e isso não
 * é tangência. Com a curva controlável, a boa linha entra por dentro e segura a
 * zebra até o ápice — e é justamente ali que a curva empurra mais, porque por
 * dentro o raio é menor.
 *
 * O trecho mais curto, o do cotovelo e o de cada metade do S, tem 20 m — bem
 * mais que o avanço de um quadro a vinte quadros por segundo, 3,5 m em
 * cruzeiro. Menor que isso, um aparelho lento pularia a zona inteira.
 */
export const TANGENCY_FROM = 0.34
export const TANGENCY_TO = 0.66

/** Maior curvatura de super curva: a do trecho mais fechado, no ápice. */
export const SUPER_MAX_CURVATURE = Math.max(
  ...SUPER_CURVE_TYPES.flatMap((tipo) => tipo.trechos.map((trecho) => (1.5 * trecho.virada) / trecho.comprimento)),
)

// ---------------------------------------------------------------------------
// Relevo
// ---------------------------------------------------------------------------

/** Comprimento de cada trecho de inclinação constante, em metros. */
export const SLOPE_SEGMENT = 155

/**
 * Inclinação máxima da pista, em metros por metro — pouco mais de 4°.
 *
 * Parece modesto, e é de propósito. O limite não é estético: o produto desta
 * constante pela escala de desenho decide se a projeção se dobra sobre si
 * mesma numa lomba. Dobrada, a parte de trás da subida apareceria acima da
 * crista e seria preciso recortar geometria escondida — inclusive árvores,
 * que passariam a flutuar no céu. Com este par, a altura de tela cai de forma
 * estritamente monótona com a distância, e isso é garantido por teste.
 *
 * A conta: o termo perigoso da derivada é proporcional a
 * `SLOPE_RISE_SCALE × desnível na janela`, e ele precisa ficar abaixo de
 * `BOTTOM_RATIO − HORIZON_RATIO`, que vale 0,63. Com desnível máximo de
 * `SLOPE_LIMIT × VIEW_DISTANCE`, sobra 20% de folga.
 */
export const SLOPE_LIMIT = 0.075

/** Maior mudança de inclinação sorteada de um trecho para o seguinte. */
export const SLOPE_STEP = 0.055

/** Puxão de volta ao plano, para a pista não subir a prova inteira. */
export const SLOPE_RETURN = 0.36

/** Proporção de trechos planos. */
export const FLAT_SHARE = 0.26

/** Maior mudança de inclinação possível, somando sorteio e retorno. */
export const MAX_SLOPE_DELTA = SLOPE_STEP + SLOPE_RETURN * SLOPE_LIMIT

/** Espaçamento da tabela de alturas da linha central, em metros. */
const SAMPLE_STEP = 8

/** Espaçamento da tabela da integral do rumo, em metros. */
const INTEGRAL_STEP = 2

/** Folga além da linha de chegada, porque a câmera enxerga adiante dela. */
const TAIL = VIEW_DISTANCE + 200

/** Suavização de entrada e saída: derivada nula nas pontas, sem quina. */
function smoothstep(t: number) {
  return t * t * (3 - 2 * t)
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

// ---------------------------------------------------------------------------
// Cenário
// ---------------------------------------------------------------------------

/**
 * Espaçamento das vagas de cenário, em metros.
 *
 * É metade do espaçamento dos marcadores de distância, então toda vaga par
 * cai exatamente sobre um marcador. Isso deixa cenário e marcadores no mesmo
 * laço e na mesma ordem de profundidade, sem precisar intercalar duas listas.
 *
 * Caiu de 10 para 6 m com a perspectiva de verdade. Os primeiros 20 metros
 * passaram a ocupar 40% da tela, e a cada 10 m sobravam duas vagas para
 * preencher tudo isso — o campo perto ficava vazio justamente onde a
 * velocidade aparece.
 */
export const SCENERY_SPACING = 6

/** Quantas vagas formam um trecho com densidade e caráter próprios. */
export const SCENERY_REGION = 12

/** A partir daqui já é grama: nada de cenário invade a faixa jogável. */
export const ROADSIDE_MARGIN = 1.62

export type SceneryKind =
  | 'tree'
  | 'bush'
  | 'fence'
  | 'grass'
  | 'sign'
  | 'guardrail'
  | 'pneus'
  | 'poste'
  | 'arquibancada'
  | 'bandeira'
  | 'pedra'
  | 'cacto'
  | 'predio'

/**
 * Quantas variantes de forma o traçado sorteia por vaga.
 *
 * O número é do sorteio, não das famílias: cada família tem o próprio
 * repertório, e quem desenha reduz este valor ao que ela tem. Deixá-lo aqui
 * casado com o tamanho de um vetor de cores foi um erro que sobreviveu por
 * coincidência — três famílias tinham exatamente três entradas.
 */
export const VARIANTES_SORTEADAS = 3

/**
 * Descrição de um objeto do cenário.
 *
 * É preenchida em um objeto que o chamador reaproveita, e não devolvida nova a
 * cada consulta: isto roda quase cem vezes por quadro e não pode alocar.
 */
export type SceneryItem = {
  kind: SceneryKind
  /** Distância absoluta na pista. */
  distance: number
  /** Posição lateral, sempre fora do asfalto. */
  lateral: number
  scale: number
  /** Variação de tonalidade, de 0 a 1. */
  tone: number
  /** Variação de forma dentro da mesma família. */
  variant: number
}

export function createSceneryItem(): SceneryItem {
  return { kind: 'grass', distance: 0, lateral: 0, scale: 1, tone: 0, variant: 0 }
}

/**
 * De quantas em quantas vagas de cenário cai um marco de pórtico.
 *
 * Dezesseis vagas de seis metros dão noventa e seis. Precisa ser múltiplo do
 * espaçamento do cenário porque o pórtico é emitido de **dentro** do mesmo
 * laço: é isso que o põe na ordem de profundidade certa, entre a árvore que
 * está atrás dele e a que está na frente. Num passe separado, um arco a
 * oitenta metros passaria por cima da copa que se debruça sobre a pista a
 * quarenta.
 */
export const GANTRY_EVERY = 16

/**
 * Um pórtico sobre a pista.
 *
 * É decoração, e só. Se ele virasse obstáculo, o layout competitivo passaria a
 * depender da semente e cairia a garantia de que os dois pilotos correm a
 * mesma prova — que é o motivo de os obstáculos serem uma lista fixa.
 */
export type Gantry = {
  /** Qual faixa de patrocínio o arco leva. */
  variant: number
}

export function createGantry(): Gantry {
  return { variant: 0 }
}

/**
 * Quanto de vaga cada família ocupa.
 *
 * Serve para uma coisa só: decidir se um objeto apaga o vizinho imediato do
 * mesmo lado. Antes a regra era "nada ao lado de uma árvore, exceto capim",
 * com os dois nomes escritos à mão — o que não sobrevive a uma família nova.
 * Agora duas famílias vizinhas só convivem se couberem juntas na soma.
 */
const ESTORVO: Record<SceneryKind, number> = {
  grass: 0,
  fence: 0,
  guardrail: 0,
  bandeira: 0.5,
  poste: 0.6,
  bush: 0.7,
  sign: 0.8,
  pneus: 0.8,
  pedra: 1.1,
  cacto: 1.2,
  tree: 1.6,
  predio: 2.2,
  arquibancada: 2.4,
}

/** Acima disso as duas não cabem lado a lado, e a segunda é suprimida. */
const ESTORVO_MAXIMO = 2

/** Famílias que acompanham a borda do asfalto em vez de se espalhar pela grama. */
const JUNTO_DA_BORDA: SceneryKind[] = ['fence', 'guardrail', 'pneus']

/**
 * O lugar em que a etapa acontece.
 *
 * É o que Top Gear fazia trocando de país a cada corrida: a mesma pista parece
 * outra com outro repertório de objeto na beira. Até aqui os quatro ambientes
 * trocavam só a cor do céu e da grama, e a diferença entre eles era de hora do
 * dia, não de lugar.
 */
export type Lugar = 'campo' | 'cidade' | 'montanha' | 'deserto'

/**
 * Famílias por trecho, próprias de cada lugar.
 *
 * A dominante dá caráter ao trecho e a secundária quebra a monotonia. Os
 * quatro conjuntos têm o mesmo número de entradas de propósito: o índice do
 * trecho é sorteado sobre o tamanho da lista, então listas de tamanhos
 * diferentes fariam a estrutura do traçado — onde estão os trechos densos,
 * onde estão as pausas — mudar junto com o lugar. Assim só muda o que aparece.
 */
const FAMILIAS_POR_LUGAR: Record<Lugar, SceneryKind[][]> = {
  campo: [
    ['tree', 'bush'],
    ['bush', 'grass'],
    ['tree', 'grass'],
    ['fence', 'bandeira'],
    // A arquibancada é sempre a secundária, e por isso cai em menos de 5% das
    // vagas: uma a cada trecho é o que diz "isto é um circuito"; duas seguidas
    // fecham a vista da pista.
    ['grass', 'arquibancada'],
    // A placa também é sempre a secundária: sinalização demais vira poluição.
    ['grass', 'sign'],
  ],
  cidade: [
    ['predio', 'poste'],
    ['poste', 'guardrail'],
    ['guardrail', 'pneus'],
    ['predio', 'bandeira'],
    ['grass', 'arquibancada'],
    ['grass', 'sign'],
  ],
  montanha: [
    ['tree', 'pedra'],
    ['pedra', 'guardrail'],
    ['tree', 'grass'],
    ['guardrail', 'pneus'],
    ['pedra', 'bush'],
    ['grass', 'sign'],
  ],
  deserto: [
    ['cacto', 'pedra'],
    ['pedra', 'grass'],
    ['cacto', 'grass'],
    ['fence', 'pedra'],
    ['grass', 'cacto'],
    ['grass', 'sign'],
  ],
}

// ---------------------------------------------------------------------------
// Ambiente
// ---------------------------------------------------------------------------

/** Conjunto de cores da vegetação. A pista seca não tem mato verde. */
export type Flora = 'verde' | 'seca'

/**
 * Identidade visual de uma corrida.
 *
 * É o que o Top Gear conseguia trocando de país a cada etapa: a mesma pista
 * parece outra com outro céu. Aqui sai da semente, então os dois pilotos
 * correm no mesmo lugar, e não custa asset nenhum.
 */
export type Ambient = {
  nome: string
  /** Onde a etapa acontece: é daqui que sai o repertório de objetos. */
  lugar: Lugar
  ceuTopo: string
  ceuMeio: string
  ceuBaixo: string
  serra: string
  chao: string
  gramaClara: string
  gramaEscura: string
  asfaltoClaro: string
  asfaltoEscuro: string
  /** Componentes da névoa do horizonte, para montar os dois extremos. */
  nevoaRGB: string
  flora: Flora
}

const AMBIENTES: Ambient[] = [
  {
    nome: 'entardecer',
    lugar: 'campo',
    ceuTopo: '#06101b',
    ceuMeio: '#173d4b',
    ceuBaixo: '#ff875f',
    serra: '#14222b',
    chao: '#183824',
    gramaClara: '#244b2c',
    gramaEscura: '#214329',
    asfaltoClaro: '#30343b',
    asfaltoEscuro: '#2b2f35',
    nevoaRGB: '255,135,95',
    flora: 'verde',
  },
  {
    nome: 'manhã',
    lugar: 'cidade',
    ceuTopo: '#0c2440',
    ceuMeio: '#3f7fa8',
    ceuBaixo: '#ffd9a3',
    serra: '#1b3242',
    chao: '#1d4429',
    gramaClara: '#2b5834',
    gramaEscura: '#264f30',
    asfaltoClaro: '#383d45',
    asfaltoEscuro: '#32363d',
    nevoaRGB: '255,217,163',
    flora: 'verde',
  },
  {
    nome: 'meio-dia',
    lugar: 'montanha',
    ceuTopo: '#12467a',
    ceuMeio: '#5c9fcf',
    ceuBaixo: '#cfe8f5',
    serra: '#2b4a5c',
    chao: '#245231',
    gramaClara: '#2f6338',
    gramaEscura: '#2a5a34',
    asfaltoClaro: '#3d434b',
    asfaltoEscuro: '#373c43',
    nevoaRGB: '207,232,245',
    flora: 'verde',
  },
  {
    nome: 'travessia seca',
    lugar: 'deserto',
    ceuTopo: '#2b1c14',
    ceuMeio: '#8a4a28',
    ceuBaixo: '#f0b978',
    serra: '#3a2a20',
    chao: '#4a3b21',
    gramaClara: '#5a4826',
    gramaEscura: '#514021',
    asfaltoClaro: '#413c33',
    asfaltoEscuro: '#3a352d',
    nevoaRGB: '240,185,120',
    flora: 'seca',
  },
]

/** Quantos ambientes existem, para os testes não dependerem do vetor. */
export const AMBIENT_COUNT = AMBIENTES.length

/** Ambiente daquela corrida. Função pura da semente, como todo o resto. */
export function ambientFor(seed: number): Ambient {
  return AMBIENTES[Math.floor(randomAt(seed, 0, 21) * AMBIENTES.length)]
}

export type TrackLayout = {
  seed: number
  /** Céu, terreno e vegetação desta corrida. */
  ambient: Ambient
  /**
   * Deslocamento lateral da linha central a `ahead` metros do ponto
   * `progress`, no referencial de quem está em `progress`, em metros.
   *
   * É a câmera de perseguição: o rumo de referência é o da pista sob o carro,
   * e não o de um eixo fixo do mundo. Com o eixo fixo, uma pista a 90° da
   * câmera virava uma linha deitada, e era isso que limitava as curvas a 24°.
   * Aqui só conta o quanto a pista vira **dali em diante**, então ela pode dar
   * a volta que quiser. Acumula o ângulo em vez do seno dele, como os
   * pseudo-3D de sempre: depois de um grampo a pista foge para o lado da
   * tela, em vez de voltar paralela, que numa projeção sem profundidade de
   * verdade pareceria uma segunda pista.
   */
  lateralAhead: (progress: number, ahead: number) => number
  /**
   * Rumo da pista naquele ponto, em radianos.
   *
   * Sem limite: cada super curva soma a própria virada. É do rumo que sai o
   * giro da paisagem, e um grampo gira o céu meia volta.
   */
  heading: (distance: number) => number
  /** Curvatura naquele ponto, em radianos por metro. */
  curvature: (distance: number) => number
  /** As super curvas da prova, em ordem de distância. */
  superCurves: readonly SuperCurve[]
  /** A super curva que contém aquela distância, se houver. */
  superCurveAt: (distance: number) => SuperCurve | null
  /**
   * Como `lateralAhead`, mas no traçado desenhado: nas super curvas, com o
   * exagero de `SUPER_CURVE_DRAW_EXAGGERATION`. É o que a tela mostra.
   */
  bendAhead: (progress: number, ahead: number) => number
  /** Rumo do traçado desenhado: é dele que sai o giro da paisagem. */
  drawnHeading: (distance: number) => number
  /** A super curva cujo muro de fora cobre aquela distância, se houver. */
  wallAt: (distance: number) => SuperCurve | null
  /**
   * Preenche o que a física precisa saber da pista naquele ponto.
   *
   * É o único caminho do traçado para a simulação: o jogo, os testes e o
   * servidor montam o contexto por aqui, e nenhum deles esquece um campo.
   * Preenche o objeto do chamador porque roda a cada quadro.
   */
  fillContext: (progress: number, out: RaceContext) => void
  /** Altura da linha central naquele ponto, em metros. */
  elevation: (distance: number) => number
  /** Inclinação naquele ponto, em metros por metro. Positiva na subida. */
  slope: (distance: number) => number
  /**
   * Preenche `out` com o objeto daquela vaga e devolve true; devolve false
   * quando a vaga é área de respiro.
   */
  scenery: (index: number, side: -1 | 1, out: SceneryItem) => boolean
  /**
   * Pórtico no marco daquele índice, se houver.
   *
   * Preenche o objeto do chamador, como `scenery`: isto roda dentro do laço de
   * quadro e não pode alocar.
   */
  gantry: (index: number, out: Gantry) => boolean
}

/**
 * Obstáculos que existem em todos os níveis.
 *
 * O miolo de uma super curva foge deles. Uma barreira no ápice trancaria a
 * única linha que passa, e isso não é dificuldade, é armadilha — no primeiro
 * grampo que o visitante do workshop vê. Os níveis mais duros ainda põem
 * peças extras ali, e é parte do que os torna mais duros.
 */
const OBSTACULOS_DE_TODOS_OS_NIVEIS = rulesFor('normal').obstacles

/** Passo, em metros, com que a janela é varrida atrás de lugares livres. */
const PASSO_DE_LUGAR = 5

/**
 * Trechos da curva que fogem dos obstáculos, em frações dela.
 *
 * O miolo, onde a carga passa da metade da de pico, foge de tudo: ali o carro
 * atravessa a pista inteira, e qualquer peça está no caminho. A entrada, dos
 * setenta metros antes dela até o fim da zebra, foge só do que estiver do lado
 * de dentro — é por onde passa a boa linha, e é para lá que a nota de curva
 * manda o piloto. Uma peça ali obrigava a desviar e encostar em meio segundo,
 * e um buraco na beirada de dentro era exatamente o que a boa linha
 * atropelava. Do lado de fora, uma peça é o problema de quem não leu a nota.
 */
const MIOLO_DE = 0.15
const MIOLO_ATE = 0.85
const ENTRADA_ANTES_M = 70

/** Quantos obstáculos um lugar da janela atropela, para uma curva dada. */
function conflitosNoLugar(inicio: number, comprimento: number, lado: 1 | -1) {
  let conflitos = 0
  for (const obstaculo of OBSTACULOS_DE_TODOS_OS_NIVEIS) {
    const relativo = (obstaculo.distance - inicio) / comprimento
    const noMiolo = relativo > MIOLO_DE && relativo < MIOLO_ATE
    const naEntradaPorDentro =
      obstaculo.distance > inicio - ENTRADA_ANTES_M && relativo <= MIOLO_DE && obstaculo.lane * lado > 0
    if (noMiolo || naEntradaPorDentro) conflitos += 1
  }
  return conflitos
}

/**
 * Onde ficam as super curvas de uma semente.
 *
 * A prova é dividida em três janelas, e cada uma recebe uma curva: é o que
 * garante a reta de aproximação de todas, e que duas nunca se emendem. O tipo
 * de cada janela sai de um embaralhamento dos três, então toda prova tem um
 * cotovelo, uma curva fechada e um grampo — só não se sabe em que ordem.
 */
function sortearSuperCurvas(seed: number): SuperCurve[] {
  const ordem = SUPER_CURVE_TYPES.map((_, indice) => indice)
  for (let i = ordem.length - 1; i > 0; i -= 1) {
    const j = Math.floor(randomAt(seed, i, 26) * (i + 1))
    const guardado = ordem[i]
    ordem[i] = ordem[j]
    ordem[j] = guardado
  }

  // O lado vem antes do lugar, porque o lugar depende de qual é o lado de
  // dentro. Todas para o mesmo lado deixariam um dos lados da pista sem uso na
  // hora que mais importa: a segunda troca, e o sorteio decide as outras.
  const lados: (1 | -1)[] = ordem.map((_, i) => (randomAt(seed, i, 25) < 0.5 ? -1 : 1))
  if (lados.every((lado) => lado === lados[0])) lados[1] = lados[1] === 1 ? -1 : 1

  const janela = (SUPER_CURVE_LAST - SUPER_CURVE_FIRST) / SUPER_CURVE_UNITS
  const curvas: SuperCurve[] = []
  for (let i = 0; i < SUPER_CURVE_UNITS; i += 1) {
    const tipo = SUPER_CURVE_TYPES[ordem[i]]
    const lado = lados[i]
    const extensao = tipo.trechos.reduce((soma, trecho) => soma + trecho.comprimento, 0)
    // Metros inteiros: o lugar testado é o lugar gravado, sem arredondamento
    // no meio que empurre uma barreira da borda do miolo para dentro dele.
    const primeiro = Math.ceil(SUPER_CURVE_FIRST + i * janela + SUPER_CURVE_APPROACH)
    const ultimo = Math.floor(SUPER_CURVE_FIRST + (i + 1) * janela - extensao - SUPER_CURVE_EXIT)

    // Varre a janela inteira e guarda os lugares livres; o sorteio escolhe
    // entre eles. Sortear lugares ao acaso e testar deixava, de vez em quando,
    // uma janela com lugar livre sem encontrá-lo. Num S, os dois trechos
    // precisam estar livres, cada um com o próprio lado de dentro.
    const livres: number[] = []
    let menosPior = primeiro
    let menosConflitos = Number.POSITIVE_INFINITY
    for (let inicio = primeiro; inicio <= ultimo; inicio += PASSO_DE_LUGAR) {
      let conflitos = 0
      let comeco = inicio
      for (const trecho of tipo.trechos) {
        conflitos += conflitosNoLugar(comeco, trecho.comprimento, lado * trecho.sentido as 1 | -1)
        comeco += trecho.comprimento
      }
      if (conflitos === 0) livres.push(inicio)
      if (conflitos < menosConflitos) {
        menosPior = inicio
        menosConflitos = conflitos
      }
    }
    const sorteio = randomAt(seed, i, 24)
    let comeco = livres.length > 0 ? livres[Math.floor(sorteio * livres.length)] : menosPior
    tipo.trechos.forEach((trecho, indice) => {
      curvas.push({
        id: curvas.length + 1,
        start: comeco,
        end: comeco + trecho.comprimento,
        apex: comeco + trecho.comprimento / 2,
        kerbStart: comeco + trecho.comprimento * TANGENCY_FROM,
        kerbEnd: comeco + trecho.comprimento * TANGENCY_TO,
        side: (lado * trecho.sentido) as 1 | -1,
        turn: trecho.virada,
        name: tipo.nome,
        peakLoad: curvatureLoad((1.5 * trecho.virada) / trecho.comprimento),
        linked: indice > 0,
        tangency: indice === 0,
      })
      comeco += trecho.comprimento
    })
  }
  return curvas
}

/** Verdadeiro quando o trecho [de, ate] encosta na janela de alguma super curva. */
function encostaEmSuperCurva(curvas: readonly SuperCurve[], de: number, ate: number) {
  return curvas.some((curva) => ate > curva.start - SUPER_CURVE_APPROACH && de < curva.end + SUPER_CURVE_EXIT)
}

export function createTrackLayout(seed: number): TrackLayout {
  const comprimento = TRACK_LENGTH + TAIL
  const trechos = Math.ceil(comprimento / CURVE_SEGMENT) + 2

  // As super curvas vêm antes do traçado comum, porque ele precisa saber onde
  // elas estão para deixar reta a aproximação de cada uma.
  const superCurvas: readonly SuperCurve[] = sortearSuperCurvas(seed)

  // Rumo alvo de cada trecho. Os primeiros ficam em zero, e o trecho seguinte
  // só começa a virar depois de `START_STRAIGHT`: a transição de um rumo para
  // outro acontece dentro do trecho, então a reta vai até o fim do último zero.
  const rumos = new Float64Array(trechos + 2)
  const trechosRetos = Math.ceil(START_STRAIGHT / CURVE_SEGMENT) + 1
  for (let i = trechosRetos; i < rumos.length; i += 1) {
    // O trecho que leva de `rumos[i - 1]` a `rumos[i]` é o i-ésimo menos um.
    // Encostando numa super curva, ele fica reto de verdade — e não "reto com
    // retorno ao eixo", que ainda viraria um pouco e tiraria a leitura da
    // aproximação.
    if (encostaEmSuperCurva(superCurvas, (i - 1) * CURVE_SEGMENT, i * CURVE_SEGMENT)) {
      rumos[i] = rumos[i - 1]
      continue
    }
    const reta = randomAt(seed, i, 2) < STRAIGHT_SHARE
    // O mesmo número dá o lado e o quanto vira: o sinal decide o lado, e a
    // magnitude, levada para além de `MIN_TURN`, faz a curva ser curva.
    const sorteio = randomAt(seed, i, 1) * 2 - 1
    const virada = (MIN_TURN + (1 - MIN_TURN) * Math.abs(sorteio)) * HEADING_STEP
    const bruto = reta ? 0 : Math.sign(sorteio) * virada
    // O termo de retorno impede que o traçado derive sempre para o mesmo lado.
    const proposto = rumos[i - 1] * (1 - HEADING_RETURN) + bruto
    rumos[i] = clamp(proposto, -HEADING_LIMIT, HEADING_LIMIT)
  }

  /** Rumo do traçado comum, que nunca passa de `HEADING_LIMIT`. */
  function rumoComum(distance: number) {
    const bruto = clamp(distance, 0, comprimento) / CURVE_SEGMENT
    const trecho = Math.min(rumos.length - 2, Math.floor(bruto))
    const t = bruto - trecho
    return rumos[trecho] + (rumos[trecho + 1] - rumos[trecho]) * smoothstep(t)
  }

  /**
   * Quanto as super curvas já viraram até ali.
   *
   * Cada uma soma a própria virada pela mesma suavização do traçado comum:
   * curvatura nula na entrada e na saída, máxima no meio. É o que põe o ápice
   * exatamente no centro da curva, onde a zona da tangência o espera.
   */
  function rumoDasSuperCurvas(distance: number) {
    let soma = 0
    for (const curva of superCurvas) {
      if (distance <= curva.start) break
      const t = Math.min(1, (distance - curva.start) / (curva.end - curva.start))
      soma += curva.side * curva.turn * smoothstep(t)
    }
    return soma
  }

  /** Derivada exata de `rumoDasSuperCurvas`. */
  function curvaturaDasSuperCurvas(distance: number) {
    for (const curva of superCurvas) {
      if (distance <= curva.start || distance >= curva.end) continue
      const extensao = curva.end - curva.start
      const t = (distance - curva.start) / extensao
      return (curva.side * curva.turn * 6 * t * (1 - t)) / extensao
    }
    return 0
  }

  const rumoEm = (distance: number) => rumoComum(distance) + rumoDasSuperCurvas(distance)
  const curvaturaEm = (distance: number) =>
    rumoComum(distance + 0.5) - rumoComum(distance - 0.5) + curvaturaDasSuperCurvas(distance)

  /**
   * Integral de um rumo, feita uma única vez e depois consultada por
   * interpolação: o laço de quadro não pode integrar nada. É dela que sai a
   * pista no referencial do carro. O passo é de dois metros, e não de oito,
   * porque num grampo o rumo muda um terço de radiano em oito metros, e o erro
   * da interpolação apareceria logo à frente do carro.
   */
  const integrar = (rumo: (distance: number) => number) => {
    const amostrasDaIntegral = Math.ceil(comprimento / INTEGRAL_STEP) + 2
    const integral = new Float64Array(amostrasDaIntegral)
    let acumulado = 0
    let rumoAnterior = rumo(0)
    for (let i = 1; i < amostrasDaIntegral; i += 1) {
      const rumoAtual = rumo(i * INTEGRAL_STEP)
      acumulado += ((rumoAnterior + rumoAtual) / 2) * INTEGRAL_STEP
      integral[i] = acumulado
      rumoAnterior = rumoAtual
    }
    return (distance: number) => {
      const bruto = clamp(distance, 0, comprimento) / INTEGRAL_STEP
      const indice = Math.min(amostrasDaIntegral - 2, Math.floor(bruto))
      const t = bruto - indice
      return integral[indice] + (integral[indice + 1] - integral[indice]) * t
    }
  }

  const integralEm = integrar(rumoEm)
  // O rumo desenhado: o traçado comum como ele é, e as super curvas com o
  // exagero do desenho. A física nunca o lê.
  const rumoDesenhadoEm = (distance: number) =>
    rumoComum(distance) + SUPER_CURVE_DRAW_EXAGGERATION * rumoDasSuperCurvas(distance)
  const integralDesenhadaEm = integrar(rumoDesenhadoEm)

  function superCurvaEm(distance: number) {
    for (const curva of superCurvas) {
      if (distance >= curva.start && distance <= curva.end) return curva
    }
    return null
  }

  /**
   * A super curva cujo muro cobre aquela distância.
   *
   * O muro vai da entrada até um pouco depois da saída — é na saída que o carro
   * mais chega perto dele —, menos na primeira metade de um S, onde ele acaba
   * exatamente no começo da segunda.
   */
  function muroEm(distance: number) {
    for (let i = 0; i < superCurvas.length; i += 1) {
      const curva = superCurvas[i]
      const emendada = i + 1 < superCurvas.length && superCurvas[i + 1].linked
      const fim = curva.end + (emendada ? 0 : SUPER_CURVE_WALL_TAIL)
      if (distance >= curva.start && distance < fim) return curva
    }
    return null
  }

  const amostras = Math.ceil(comprimento / SAMPLE_STEP) + 2

  // Relevo, construído pela mesma máquina do rumo: inclinação alvo por trecho,
  // suavização com derivada nula nas pontas — o que zera a curvatura vertical
  // na emenda e evita quebra — e integração feita uma vez.
  const inclinacoes = new Float64Array(Math.ceil(comprimento / SLOPE_SEGMENT) + 3)
  for (let i = 3; i < inclinacoes.length; i += 1) {
    const plano = randomAt(seed, i, 4) < FLAT_SHARE
    const bruto = plano ? 0 : (randomAt(seed, i, 3) * 2 - 1) * SLOPE_STEP
    inclinacoes[i] = clamp(inclinacoes[i - 1] * (1 - SLOPE_RETURN) + bruto, -SLOPE_LIMIT, SLOPE_LIMIT)
  }

  function inclinacaoEm(distance: number) {
    const bruto = clamp(distance, 0, comprimento) / SLOPE_SEGMENT
    const trecho = Math.min(inclinacoes.length - 2, Math.floor(bruto))
    const t = bruto - trecho
    return inclinacoes[trecho] + (inclinacoes[trecho + 1] - inclinacoes[trecho]) * smoothstep(t)
  }

  const alturas = new Float64Array(amostras)
  let subida = 0
  for (let i = 1; i < amostras; i += 1) {
    const anterior = inclinacaoEm((i - 1) * SAMPLE_STEP)
    const atual = inclinacaoEm(i * SAMPLE_STEP)
    subida += ((anterior + atual) / 2) * SAMPLE_STEP
    alturas[i] = subida
  }

  function alturaEm(distance: number) {
    const bruto = clamp(distance, 0, comprimento) / SAMPLE_STEP
    const indice = Math.min(amostras - 2, Math.floor(bruto))
    const t = bruto - indice
    return alturas[indice] + (alturas[indice + 1] - alturas[indice]) * t
  }

  const familias = FAMILIAS_POR_LUGAR[ambientFor(seed).lugar]

  /** Família da vaga antes da supressão, para o vizinho poder consultá-la. */
  function familiaBruta(index: number, side: -1 | 1): SceneryKind | null {
    if (index < 0) return null
    const vaga = index * 2 + (side > 0 ? 1 : 0)
    const regiao = Math.floor(index / SCENERY_REGION)
    const densidade = 0.24 + randomAt(seed, regiao, 7) * 0.58
    if (randomAt(seed, vaga, 11) > densidade) return null

    const trecho = familias[Math.floor(randomAt(seed, regiao, 8) * familias.length)]
    // A dominante aparece na maioria das vagas: é o que forma agrupamentos.
    return randomAt(seed, vaga, 12) < 0.72 ? trecho[0] : trecho[1]
  }

  return {
    seed,
    ambient: ambientFor(seed),
    lateralAhead: (progress, ahead) =>
      integralEm(progress + ahead) - integralEm(progress) - ahead * rumoEm(progress),
    bendAhead: (progress, ahead) =>
      integralDesenhadaEm(progress + ahead) - integralDesenhadaEm(progress) - ahead * rumoDesenhadoEm(progress),
    drawnHeading: rumoDesenhadoEm,
    wallAt: muroEm,
    heading: rumoEm,
    curvature: curvaturaEm,
    superCurves: superCurvas,
    superCurveAt: superCurvaEm,
    fillContext(progress, out) {
      const curvatura = curvaturaEm(progress)
      out.curvature = curvatureLoad(curvatura)
      out.lineGain = curvatura * METERS_PER_LATERAL
      // A zebra de dentro, na entrada, é o único trecho em que a tangência conta.
      let apice: SuperCurve | null = null
      for (const curva of superCurvas) {
        if (curva.tangency && progress >= curva.kerbStart && progress <= curva.kerbEnd) apice = curva
      }
      out.apexId = apice ? apice.id : 0
      out.apexSide = apice ? apice.side : 0
      // O muro fica por fora: do lado contrário ao da curva.
      const muro = muroEm(progress)
      out.wallId = muro ? muro.id : 0
      out.wallSide = muro ? -muro.side : 0
    },
    elevation: alturaEm,
    slope: inclinacaoEm,
    gantry(index, out) {
      if (index <= 0 || index % GANTRY_EVERY !== 0) return false
      // Nem todo marco recebe arco: em fila certinha o pórtico vira placa de
      // quilometragem, e o que se quer é que ele marque alguma coisa.
      if (randomAt(seed, index, 22) > 0.62) return false
      // Nem dentro de uma super curva: o arco atravessaria a pista justo onde
      // ela foge para o lado da tela, e taparia a leitura do grampo.
      const distancia = index * SCENERY_SPACING
      if (superCurvas.some((curva) => distancia > curva.start - 40 && distancia < curva.end + 20)) return false
      out.variant = Math.floor(randomAt(seed, index, 23) * 3)
      return true
    },

    scenery(index, side, out) {
      // Por fora de uma super curva, o lugar é do muro e das placas de seta: um
      // objeto ali disputaria a atenção com o único aviso que importa — e
      // ficaria atrás do muro, cortado por ele.
      const curva = muroEm(index * SCENERY_SPACING)
      if (curva && side === -curva.side) return false

      const familia = familiaBruta(index, side)
      if (familia === null) return false

      // Distância mínima: um objeto largo apaga o vizinho imediato do mesmo
      // lado, senão os dois se atropelam quando chegam perto da câmera.
      const anterior = familiaBruta(index - 1, side)
      if (anterior !== null && ESTORVO[anterior] + ESTORVO[familia] > ESTORVO_MAXIMO) return false

      const vaga = index * 2 + (side > 0 ? 1 : 0)
      // Cerca, guardrail e pilha de pneus acompanham a borda; o resto se
      // espalha pela grama.
      const naBorda = JUNTO_DA_BORDA.includes(familia)
      // O que é largo fica mais longe da pista, na proporção do estorvo que já
      // decide a supressão do vizinho. Um prédio na beira do asfalto tapa a
      // vista da curva; o mesmo prédio um pouco atrás compõe o fundo.
      const recuo = ESTORVO[familia] * 0.35
      const afastamento = naBorda ? 0.1 : 0.34 + recuo + randomAt(seed, vaga, 13) * 1.5
      out.kind = familia
      out.distance = index * SCENERY_SPACING
      out.lateral = side * (ROADSIDE_MARGIN + afastamento)
      out.scale = 0.72 + randomAt(seed, vaga, 14) * 0.85
      out.tone = randomAt(seed, vaga, 15)
      out.variant = Math.floor(randomAt(seed, vaga, 16) * VARIANTES_SORTEADAS)
      return true
    },
  }
}

/**
 * Contexto da física ligado a um traçado: a curva, a linha e a zebra da
 * tangência são relidas a cada passo fixo, no ponto em que o carro está.
 *
 * É o único jeito de montar o contexto de uma corrida de verdade — o jogo, os
 * testes de aceitação e os pilotos de referência passam por aqui. Um contexto
 * montado à mão esquecia o leitor, e a física voltava a ler a pista uma vez
 * por quadro sem que nada avisasse.
 */
export function createRaceContext(layout: TrackLayout): RaceContext {
  return { curvature: 0, slipstream: 0, lineGain: 0, apexId: 0, apexSide: 0, sample: layout.fillContext }
}

/** Primeira vaga de cenário ainda à frente da câmera. */
export function firstSceneryIndex(progress: number) {
  return Math.ceil(progress / SCENERY_SPACING)
}

/** Última vaga dentro do campo de visão. */
export function lastSceneryIndex(progress: number) {
  return Math.floor((progress + VIEW_DISTANCE) / SCENERY_SPACING)
}
