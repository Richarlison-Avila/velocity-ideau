// A extensão .js é exigida pelo Node, que roda este módulo no servidor durante
// os testes de aceitação. O Vite resolve para o arquivo .ts normalmente.
import { rulesFor, type Difficulty, type RaceRules } from './rules.js'
import {
  HIT_HALF_WIDTH,
  HIT_IS_CRASH,
  HIT_PENALTY_SHARE,
  LATERAL_LIMIT,
  OFF_ROAD_LIMIT,
  TRACK_LENGTH,
  WALL_LIMIT,
} from './track.js'

// Os limites laterais são geometria da pista, e ficam definidos junto dela para
// o desenho, a simulação e o servidor nunca divergirem.
export { LATERAL_LIMIT, OFF_ROAD_LIMIT } from './track.js'

export type RaceInput = { left: boolean; right: boolean; boost: boolean }

export type RaceState = {
  /** Distância percorrida no circuito, em metros. */
  progress: number
  /** Posição entre os limites da pista, de -1.28 a 1.28. */
  lateral: number
  speed: number
  boost: number
  penalty: number
  collisions: number
  topSpeed: number
  offRoad: boolean
  boosting: boolean
  /** Bloqueio após esgotar o boost: evita o liga-desliga a cada quadro. */
  boostLocked: boolean
  /**
   * Posição do volante, de -1 a 1. Persegue o comando com inércia em vez de
   * saltar para ele, e é o que move o carro de fato.
   */
  steerInput: number
  /**
   * Quanto o volante andou no passado recente, com esquecimento.
   *
   * Uma correção de curva mexe pouco e some; um zigue-zague sustentado
   * acumula. É daqui que sai a perda de aderência.
   */
  agitation: number
  /** Aderência de 0 a 1, derivada da agitação. Multiplica a velocidade-alvo. */
  grip: number
  /** Força do vácuo aproveitada neste passo, de 0 a 1. */
  slipstream: number
  /** Carga lateral que a curva impôs neste passo, de 0 a 1. */
  cornerLoad: number
  /** Batidas desde o último reset. Na terceira, o carro é resetado. */
  strikes: number
  /**
   * Medidor de saída de pista, de 0 a 1.
   *
   * Enche enquanto o carro está fora do asfalto, mais depressa quanto mais
   * fundo na grama, e esvazia de volta nele. Cheio, o carro é resetado.
   */
  offTrack: number
  /** Segundos que faltam do reset em curso. Enquanto isso o carro fica parado. */
  resetting: number
  /** Resets sofridos na prova. */
  resets: number
  /** Velocidade que o carro retoma quando o reset acaba. */
  resumeSpeed: number
  /**
   * Quanto a linha está encurtando o caminho neste passo: 1 no centro ou na
   * reta, acima de 1 por dentro da curva, abaixo por fora.
   */
  lineFactor: number
  /** Super curvas em que a tangência já foi feita. Cada uma rende uma vez. */
  apexes: Set<number>
  /** Super curvas em cujo muro o carro já bateu. Cada uma conta uma batida. */
  wallHits: Set<number>
  /** Verdadeiro enquanto o carro está encostado no muro, raspando. */
  onWall: boolean
  finished: boolean
  hitObstacles: Set<number>
  /**
   * Regras da corrida, fixadas na largada.
   *
   * Viajam dentro do estado de propósito: a dificuldade é decidida pela sala
   * antes da prova começar e não muda no meio dela. Quem simula não precisa
   * receber a dificuldade por fora, e não há como um trecho do código usar um
   * conjunto de regras e outro trecho usar outro.
   */
  rules: RaceRules
}

/** Por que o carro foi resetado: batidas demais ou tempo demais fora da pista. */
export type ResetReason = 'crashes' | 'offTrack'

export type RaceEvent =
  | { type: 'collision'; obstacleId: number }
  | { type: 'reset'; reason: ResetReason }
  | { type: 'apex'; curveId: number }
  | { type: 'wall'; curveId: number }
  | { type: 'finish' }

/** Maior passo de simulação aceito, protege contra abas em segundo plano. */
export const MAX_STEP_SECONDS = 0.05
/** Carga mínima para voltar a usar o boost depois de esgotá-lo. */
export const BOOST_UNLOCK = 25

/**
 * Passo fixo da integração, em segundos.
 *
 * A curva de tração não tem solução fechada, então ela é integrada em passos
 * curtos e sempre do mesmo tamanho. Sem isso, um aparelho de 20 quadros por
 * segundo chegaria a uma velocidade diferente de um de 60 — e num duelo isso
 * é vantagem de hardware. 60, 30 e 20 quadros por segundo são múltiplos
 * exatos deste passo, então os três percorrem a mesma sequência.
 */
export const PHYSICS_STEP = 1 / 120

/**
 * Aceleração com o carro parado, em km/h por segundo.
 *
 * A arrancada é forte, mas o ganho cede conforme a velocidade sobe — é o
 * oposto da aproximação exponencial anterior, que gastava quase tudo no
 * primeiro instante e colocava o carro perto de 200 km/h em menos de um
 * segundo, sem nenhuma progressão para o olho acompanhar.
 */
export const ACCELERATION_PEAK = 62

/**
 * Expoente da curva de tração.
 *
 * Com 4, a aceleração fica quase constante até dois terços da velocidade-alvo
 * e só então cede. É o que dá a sensação de ganho progressivo em vez de um
 * salto seguido de estagnação.
 */
export const ACCELERATION_SHAPE = 4

/**
 * Empurrão extra do boost sobre a tração.
 *
 * Sem ele o boost virava uma promessa: a velocidade-alvo subia para 314, mas
 * a carga acabava antes de o carro chegar perto disso. Com o empurrão, a
 * arrancada do boost é sentida na hora e a vantagem volta à faixa combinada.
 */
export const BOOST_TRACTION = 1.5

/** Perder velocidade é mais rápido que ganhar: a grama pesa. */
export const DECELERATION_RATE = 5

/** No impacto a queda é quase instantânea, e não uma frenagem suave. */
export const IMPACT_DECELERATION = 16

/** Deslocamento lateral por segundo com o volante todo virado, parado. */
export const STEER_RATE = 1.35

/** Inércia do volante, em segundos. Curto: não atrasa o comando, dá peso. */
export const STEER_TAU = 0.1

/** Tempo de esquecimento da agitação do volante, em segundos. */
export const AGITATION_TAU = 1

/**
 * Faixa de agitação entre a primeira perda e a perda máxima.
 *
 * A zona morta e a perda máxima mudam com a dificuldade; a largura da rampa
 * entre elas não, para o volante responder com a mesma forma nos três níveis.
 */
export const AGITATION_RANGE = 3.4

/**
 * Quanto do que escapa à aderência da curva vira deslocamento, em unidades de
 * posição lateral por segundo.
 *
 * Multiplica apenas o excedente, não a carga inteira: a parte que o pneu
 * segura não desloca o carro. Calibrado contra a autoridade de esterço, que
 * vale `STEER_RATE + velocidade / 520` — os percentuais medidos estão no
 * README, junto da explicação de como se dirige.
 */
export const CORNER_PUSH = 2.55

/**
 * Quanto a curva freia o carro, em km/h por segundo, por unidade do que escapa
 * à aderência.
 *
 * É o pneu esfregando de lado. Multiplica o mesmo excedente que empurra o
 * carro para fora, então só cobra onde a curva já está cobrando — e cobra mais
 * de quem entra embalado, porque a carga cresce com o quadrado da velocidade.
 *
 * É uma frenagem, e não um corte na velocidade-alvo, e de propósito. Com o
 * corte, o carro perdia a velocidade em dois décimos de segundo, a força da
 * curva caía junto, e nem entrando de boost na curva mais fechada alguém saía
 * da pista — medido. Esfregando aos poucos, quem entra embalado é jogado para
 * fora antes de perder a velocidade, que é o que a curva de verdade faz.
 */
export const CORNER_SCRUB = 45

/**
 * Batidas que resetam o carro.
 *
 * A terceira batida não é mais uma penalidade de velocidade: o carro é tirado
 * da prova por `RESET_SECONDS` e devolvido ao meio da pista. As batidas
 * voltam a zero a cada reset.
 */
export const RESET_STRIKES = 3

/**
 * Quanto tempo o reset custa, em segundos.
 *
 * O carro fica parado e o relógio da prova não. Tem de ser tempo perdido de
 * verdade, e não um acréscimo no cronômetro: quem decide o tempo de chegada é
 * o servidor, pelo relógio dele, e um acréscimo feito no aparelho seria
 * cortado ali. Parado, o carro perde os segundos no único relógio que conta.
 */
export const RESET_SECONDS = 1.5

/**
 * Segundos no fundo da grama até o reset.
 *
 * Com o carro encostado no limite de fora, o medidor enche em pouco mais de
 * um segundo; raspando só a borda, bem mais devagar. Uma escapada curta numa
 * curva custa a velocidade que a grama já tira — o reset é para quem fica.
 */
export const OFF_TRACK_SECONDS = 1.3

/**
 * Parcela do medidor que enche mesmo com o carro só raspando a borda.
 *
 * Sem ela, ficar para sempre com uma roda na grama nunca resetaria, e a
 * beirada virava um lugar para morar.
 */
export const OFF_TRACK_SHALLOW = 0.25

/** Quanto o medidor esvazia por segundo, de volta ao asfalto. */
export const OFF_TRACK_RECOVERY = 0.5

/**
 * Até quantos metros à frente do ponto do reset os obstáculos ficam para trás.
 *
 * O reset põe o carro no meio da pista, que não foi escolha do piloto. Um
 * obstáculo no meio, logo adiante, viraria uma batida que ninguém conseguiria
 * evitar — e numa terceira batida, um reset em cima do outro. Vinte metros é
 * mais do que o carro precisa para desviar depois de solto.
 */
export const RESET_CLEARANCE_M = 20

/** Alcance do vácuo, em metros atrás do rival. */
export const SLIPSTREAM_RANGE_M = 42
/** Diferença lateral a partir da qual o vácuo deixa de existir. */
export const SLIPSTREAM_WIDTH = 0.55

/**
 * Força do vácuo deixado pelo rival, de 0 a 1.
 *
 * É o que dá sentido mecânico à presença do adversário: sem isso o fantasma é
 * só uma imagem, e uma corrida on-line são duas provas solo sobrepostas. Colar
 * no rival rende velocidade, e ultrapassá-lo custa esse ganho — a esteira
 * desaparece no instante em que o carro passa à frente.
 *
 * Só aproveita quem vem atrás, alinhado com quem vai na frente, e cresce à
 * medida que a distância diminui.
 */
export function slipstreamFrom(
  playerProgress: number,
  playerLateral: number,
  rivalProgress: number,
  rivalLateral: number,
) {
  const atras = rivalProgress - playerProgress
  // As comparações são escritas para que qualquer NaN caia no retorno zero.
  if (!(atras > 0) || !(atras < SLIPSTREAM_RANGE_M)) return 0
  const alinhamento = 1 - Math.abs(rivalLateral - playerLateral) / SLIPSTREAM_WIDTH
  if (!(alinhamento > 0)) return 0
  return (1 - atras / SLIPSTREAM_RANGE_M) * alinhamento
}

export function createRaceState(difficulty: Difficulty = 'normal'): RaceState {
  return {
    rules: rulesFor(difficulty),
    progress: 0,
    lateral: 0,
    speed: 0,
    boost: 100,
    penalty: 0,
    collisions: 0,
    topSpeed: 0,
    offRoad: false,
    boosting: false,
    boostLocked: false,
    steerInput: 0,
    agitation: 0,
    grip: 1,
    slipstream: 0,
    cornerLoad: 0,
    strikes: 0,
    offTrack: 0,
    resetting: 0,
    resets: 0,
    resumeSpeed: 0,
    lineFactor: 1,
    apexes: new Set<number>(),
    wallHits: new Set<number>(),
    onWall: false,
    finished: false,
    hitObstacles: new Set<number>(),
  }
}

/**
 * Quanto a linha encurta o caminho, para uma posição lateral.
 *
 * Numa curva de raio R, a linha a uma distância n do centro, por dentro, tem
 * raio R − n: o carro percorre (1 − n/R) do que a linha central percorre, e
 * portanto avança na pista 1 / (1 − n/R) mais depressa na mesma velocidade.
 * `lineGain` já é 1/R em unidades de posição lateral, com o sinal do lado.
 *
 * Nenhum pseudo-3D fazia isso: neles o carro avança pela linha central esteja
 * onde estiver, e a posição lateral só decide em que se bate. Aqui, a
 * tangência encurta o caminho de verdade — e, como a mesma conta é a do raio,
 * a linha por dentro também empurra mais. Por dentro é mais curto e mais
 * difícil de segurar; por fora é mais longo e mais folgado. É a escolha de
 * toda curva de verdade.
 */
export function lineFactorFor(lineGain: number, lateral: number) {
  if (!Number.isFinite(lineGain) || !Number.isFinite(lateral)) return 1
  const encurtamento = 1 - lineGain * lateral
  if (!(encurtamento > 0)) return LINE_FACTOR_MAX
  return clamp(1 / encurtamento, LINE_FACTOR_MIN, LINE_FACTOR_MAX)
}

/**
 * Tira o carro da prova por `RESET_SECONDS` e o devolve ao meio da pista.
 *
 * Tudo o que o carro vinha acumulando zera: batidas, medidor de saída,
 * penalidade, volante e aderência. O reset é a punição inteira, e não uma
 * punição por cima das outras. A velocidade que ele tinha fica guardada e
 * volta quando o tempo acaba — assim o reset custa exatamente o tempo
 * prometido, e não compensa provocá-lo: quem estava lento na grama volta lento.
 */
function resetar(state: RaceState) {
  state.resumeSpeed = state.speed
  state.speed = 0
  state.resetting = RESET_SECONDS
  state.resets += 1
  state.lateral = 0
  state.offRoad = false
  state.steerInput = 0
  state.agitation = 0
  state.grip = 1
  state.penalty = 0
  state.boosting = false
  state.cornerLoad = 0
  state.strikes = 0
  state.offTrack = 0
  state.onWall = false
  for (const obstacle of state.rules.obstacles) {
    const delta = obstacle.distance - state.progress
    if (delta > -5 && delta < RESET_CLEARANCE_M) state.hitObstacles.add(obstacle.id)
  }
}

/** Aderência disponível para uma dada agitação do volante. */
export function gripFor(agitation: number, rules: RaceRules) {
  const excesso = (agitation - rules.agitationDeadband) / AGITATION_RANGE
  return 1 - clamp(excesso, 0, 1) * rules.maxGripLoss
}

/**
 * Velocidade que o carro persegue neste instante.
 *
 * Parte da tabela de estados — que é o contrato com o servidor — e aplica
 * sobre ela as perdas contínuas: o quanto o carro se embrenhou na grama e o
 * quanto vem maltratando o volante.
 */
export function targetSpeedFor(state: RaceState) {
  const base = speedForState(state.offRoad, state.penalty, state.boosting, state.rules, state.slipstream)
  if (!state.offRoad) return base * state.grip
  const profundidade = clamp((Math.abs(state.lateral) - OFF_ROAD_LIMIT) / (LATERAL_LIMIT - OFF_ROAD_LIMIT), 0, 1)
  return base * (1 - profundidade * state.rules.offRoadDepthLoss) * state.grip
}

/**
 * Velocidade que o carro persegue em cada estado, para um conjunto de regras.
 *
 * É o contrato que o servidor usa para saber o tempo mínimo plausível da
 * prova, e por isso mora junto das regras e não dentro do laço de simulação.
 */
export function speedForState(
  offRoad: boolean,
  penalty: number,
  boosting: boolean,
  rules: RaceRules,
  slipstream = 0,
) {
  if (offRoad) return rules.offRoadSpeed
  if (penalty > 0) return rules.penaltySpeed
  // O vácuo acrescenta só nos estados livres: na grama e durante a penalidade
  // o carro está sendo punido, e a esteira do rival não anula punição.
  //
  // `Math.min` e `Math.max` propagam NaN, e a força do vácuo é derivada da
  // posição do rival, que chega pela rede: a faixa é conferida, não presumida.
  const forca = Number.isFinite(slipstream) ? Math.max(0, Math.min(1, slipstream)) : 0
  return (boosting ? rules.boostSpeed : rules.cruiseSpeed) + forca * rules.slipstreamBonus
}

/**
 * O que a simulação não sabe sozinha.
 *
 * A pista sob o carro e o rival à frente dele. Nenhum dos dois é propriedade
 * do carro: a curvatura vem do traçado gerado pela semente da sala, e a
 * esteira vem da telemetria do adversário. Viajam juntos num objeto, e não
 * como dois números na chamada, para não haver como trocá-los de lugar.
 */
export type RaceContext = {
  /**
   * Carga da curva no ponto do carro: negativa à esquerda, positiva à direita.
   *
   * Vai de -1 a 1 nas curvas comuns; as super curvas passam disso, até
   * `MAX_CORNER_LOAD`.
   */
  curvature: number
  /** Força do vácuo do rival, de 0 a 1. */
  slipstream: number
  /**
   * Quanto do caminho cada unidade de posição lateral encurta ali, com sinal.
   *
   * É a curvatura vezes os metros de uma unidade lateral: positiva numa curva
   * à direita, onde o lado de dentro é o de posição positiva. Zero na reta, e
   * quando nada é informado.
   */
  lineGain?: number
  /** Super curva cuja zebra da tangência está sob o carro, ou zero. */
  apexId?: number
  /** Para que lado vira a curva daquela zebra: 1, -1, ou zero sem zebra. */
  apexSide?: number
  /** Super curva cujo muro cobre o ponto do carro, ou zero. */
  wallId?: number
  /** De que lado está o muro: 1, -1, ou zero sem muro. É o lado de fora da curva. */
  wallSide?: number
  /**
   * Relê a pista num ponto, preenchendo os campos acima.
   *
   * Presente, a física a chama a cada passo fixo, e não só uma vez por
   * quadro. Numa super curva a carga muda de zero ao pico em cinquenta metros,
   * e a vinte quadros por segundo o carro anda 3,5 m entre dois quadros: lida
   * por quadro, a curva de um aparelho lento chegava atrasada — e um piloto
   * que passava limpo a sessenta ia para a grama a vinte, medido. Relida no
   * passo fixo, os três percorrem a mesma curva, como já percorriam a mesma
   * física.
   */
  sample?: (progress: number, out: RaceContext) => void
}

/** Pista reta e sem ninguém à frente: o que vale quando nada é informado. */
export const NO_CONTEXT: RaceContext = { curvature: 0, slipstream: 0 }

/**
 * Maior carga de curva que a física aceita.
 *
 * É o teto das super curvas, e é também a guarda contra uma entrada corrompida:
 * nenhuma curva de verdade passa disso, então nada acima disso é aceito.
 */
export const MAX_CORNER_LOAD = 3

/**
 * Limites do quanto a linha pode encurtar ou alongar o caminho.
 *
 * Com as curvas que o traçado faz, a conta nunca chega perto deles: no ápice
 * do grampo, encostado no limite de dentro, o fator é 1,35. São a guarda para
 * o fator nunca inverter o sinal nem explodir numa entrada absurda.
 */
const LINE_FACTOR_MIN = 0.6
const LINE_FACTOR_MAX = 1.5

/**
 * Posição lateral, do lado de dentro, a partir da qual a passagem pela zebra
 * de dentro conta como tangência.
 *
 * É mais da metade do caminho entre o centro e a borda: a tangência é uma
 * escolha, feita antes da curva, e não algo que acontece com quem só passou
 * por ali.
 */
export const APEX_LATERAL = 0.6

/** Carga de boost que a tangência devolve. */
export const APEX_BOOST = 22

/**
 * O que sobra da velocidade na batida contra o muro da super curva.
 *
 * É mais que a barreira no meio da pista cobra de uma vez, porque o muro vem
 * de lado: o carro chega nele de raspão, e é o raspão que continua cobrando.
 */
export const WALL_IMPACT_KEEP = 0.72

/** Fração da penalidade de impacto que a batida no muro cobra. */
export const WALL_PENALTY_SHARE = 0.8

/**
 * Quanto o muro raspa de velocidade, em km/h por segundo, com o carro
 * encostado nele. Faísca e perda: ficar colado no muro é pior que sair dele.
 */
export const WALL_SCRUB = 70

/**
 * Avança a simulação em `dt` segundos e devolve os eventos ocorridos no passo.
 *
 * A aceleração é automática: o piloto controla apenas direção e boost.
 */
export function stepRace(
  state: RaceState,
  input: RaceInput,
  dt: number,
  context: RaceContext = NO_CONTEXT,
): RaceEvent[] {
  const events: RaceEvent[] = []
  if (state.finished) return events

  const step = Math.min(Math.max(0, dt), MAX_STEP_SECONDS)
  if (step === 0) return events

  const comando = Number(input.right) - Number(input.left)
  // Uma medição corrompida do rival não pode apagar a velocidade do carro, e
  // uma curvatura inválida não pode arrastá-lo para fora da pista.
  state.slipstream = Number.isFinite(context.slipstream) ? clamp(context.slipstream, 0, 1) : 0
  // O que a pista impõe no passo. Lido do contexto uma vez, ou a cada passo
  // quando o contexto sabe se reler.
  let curvatura = 0
  let ganhoDaLinha = 0
  let apice = 0
  let ladoDoApice = 0
  let muro = 0
  let ladoDoMuro = 0
  let pistaLida = false
  // A linha pode encurtar o caminho, mas nunca fazer o carro avançar mais
  // depressa que o teto do nível. É esse teto que o servidor usa para o tempo
  // mínimo plausível da prova, e ele continua valendo por construção.
  const tetoDeAvanco = speedForState(false, 0, true, state.rules, 1)

  let restante = step
  while (restante > 1e-9) {
    const h = Math.min(PHYSICS_STEP, restante)
    restante -= h

    // Reset em curso: o relógio corre e o carro não. Nada mais anda — nem a
    // carga do boost, que recarregar parado seria prêmio.
    if (state.resetting > 0) {
      state.resetting = Math.max(0, state.resetting - h)
      if (state.resetting === 0) state.speed = state.resumeSpeed
      continue
    }

    // A pista relida no ponto em que o carro está neste passo, e não no do
    // começo do quadro. Sem leitor, vale o que o chamador informou.
    if (context.sample) context.sample(state.progress, context)
    if (context.sample || !pistaLida) {
      curvatura = Number.isFinite(context.curvature) ? clamp(context.curvature, -MAX_CORNER_LOAD, MAX_CORNER_LOAD) : 0
      ganhoDaLinha = Number.isFinite(context.lineGain) ? (context.lineGain as number) : 0
      apice = context.apexId ?? 0
      ladoDoApice = context.apexSide ?? 0
      muro = context.wallId ?? 0
      ladoDoMuro = context.wallSide ?? 0
      pistaLida = true
    }

    // O volante tem inércia, e o esforço lateral é o quanto ele andou. Medir
    // o curso do volante — e não a posição do carro na pista — é o que separa
    // a correção necessária numa curva do zigue-zague deliberado.
    const antesDoGiro = state.steerInput
    state.steerInput += (comando - antesDoGiro) * (1 - Math.exp(-h / STEER_TAU))
    state.agitation = state.agitation * Math.exp(-h / AGITATION_TAU) + Math.abs(state.steerInput - antesDoGiro)
    state.grip = gripFor(state.agitation, state.rules)

    // Força lateral da curva.
    //
    // Aqui a pista passa a cobrar. O carro é jogado para fora, e segurá-lo
    // gasta esterço que deixa de estar disponível para escolher a faixa — é o
    // que cria linha de corrida e diferença de ritmo entre dois pilotos. A
    // carga cresce com o quadrado da velocidade, como a força centrífuga real,
    // então é a velocidade escolhida que decide se a mesma curva é tranquila
    // ou está no limite.
    //
    // O pneu segura a carga até `cornerGrip`; só o excedente desloca o carro.
    // Sem esse limiar, qualquer curvatura arrastava, e quem não corrigisse a
    // cada quadro terminava a prova na grama — o que é punição, não jogo.
    //
    // A linha entra na carga: por dentro o raio é menor, e a mesma velocidade
    // pede mais do pneu.
    const proporcao = state.speed / state.rules.cruiseSpeed
    state.lineFactor = lineFactorFor(ganhoDaLinha, state.lateral)
    const carga = curvatura * proporcao * proporcao * state.lineFactor
    state.cornerLoad = Math.min(1, Math.abs(carga))
    const escapa = Math.max(0, Math.abs(carga) - state.rules.cornerGrip)
    // Curva à direita joga o carro para a esquerda, daí o sinal invertido.
    const empurrao = -Math.sign(carga) * escapa * CORNER_PUSH

    state.lateral = clamp(
      state.lateral + (state.steerInput * (STEER_RATE + state.speed / 520) + empurrao) * h,
      -LATERAL_LIMIT,
      LATERAL_LIMIT,
    )

    // O muro da super curva segura o carro como a borda física da pista, só
    // que mais perto dela — e encostar nele é batida. A primeira de cada curva
    // conta para o reset; encostado, o carro raspa velocidade até sair dele.
    state.onWall = false
    if (ladoDoMuro !== 0 && state.lateral * ladoDoMuro >= WALL_LIMIT) {
      state.lateral = ladoDoMuro * WALL_LIMIT
      state.onWall = true
      state.speed = Math.max(0, state.speed - WALL_SCRUB * h)
      if (muro > 0 && !state.wallHits.has(muro)) {
        state.wallHits.add(muro)
        state.collisions += 1
        state.strikes += 1
        state.speed *= WALL_IMPACT_KEEP
        events.push({ type: 'wall', curveId: muro })
        if (state.strikes >= RESET_STRIKES) {
          resetar(state)
          events.push({ type: 'reset', reason: 'crashes' })
          continue
        }
        state.penalty = Math.max(state.penalty, state.rules.penaltySeconds * WALL_PENALTY_SHARE)
      }
    }
    state.offRoad = Math.abs(state.lateral) > OFF_ROAD_LIMIT

    // Saída de pista: o medidor enche com a profundidade e esvazia no asfalto.
    if (state.offRoad) {
      const profundidade = clamp(
        (Math.abs(state.lateral) - OFF_ROAD_LIMIT) / (LATERAL_LIMIT - OFF_ROAD_LIMIT),
        0,
        1,
      )
      state.offTrack += ((OFF_TRACK_SHALLOW + profundidade) / OFF_TRACK_SECONDS) * h
    } else {
      state.offTrack = Math.max(0, state.offTrack - OFF_TRACK_RECOVERY * h)
    }
    if (state.offTrack >= 1) {
      resetar(state)
      events.push({ type: 'reset', reason: 'offTrack' })
      continue
    }

    // Tangência: passar colado na zebra de dentro, na entrada de uma super
    // curva, no asfalto. É a linha mais curta e a que mais empurra, e quem a
    // faz recebe de volta parte do boost — que só vai poder usar na reta,
    // porque de boost a super curva joga o carro para fora.
    if (
      apice > 0 &&
      !state.offRoad &&
      state.lateral * ladoDoApice >= APEX_LATERAL &&
      !state.apexes.has(apice)
    ) {
      state.apexes.add(apice)
      state.boost = Math.min(100, state.boost + APEX_BOOST)
      events.push({ type: 'apex', curveId: apice })
    }

    if (state.boostLocked && state.boost >= BOOST_UNLOCK) state.boostLocked = false
    state.boosting = input.boost && state.boost > 0 && !state.boostLocked && !state.offRoad && state.penalty <= 0
    state.boost = clamp(
      state.boost + (state.boosting ? -state.rules.boostDrain : state.rules.boostRecharge) * h,
      0,
      100,
    )
    if (state.boost <= 0) state.boostLocked = true
    state.penalty = Math.max(0, state.penalty - h)

    const alvo = targetSpeedFor(state)
    if (alvo > state.speed) {
      // Tração: forte na saída, cedendo perto do teto.
      const fracao = state.speed / Math.max(1, alvo)
      const tracao = ACCELERATION_PEAK * (state.boosting ? BOOST_TRACTION : 1)
      state.speed = Math.min(alvo, state.speed + tracao * (1 - Math.pow(fracao, ACCELERATION_SHAPE)) * h)
    } else {
      // A perda é exponencial, que é a forma certa para arrasto e frenagem —
      // e tem solução fechada, então não depende do tamanho do passo.
      const taxa = state.penalty > 0 ? IMPACT_DECELERATION : DECELERATION_RATE
      state.speed += (alvo - state.speed) * (1 - Math.exp(-h * taxa))
    }
    // E o pneu que escapa esfrega: a curva também cobra velocidade, aos poucos.
    state.speed = Math.max(0, state.speed - CORNER_SCRUB * escapa * h)

    const avanco = Math.min(state.speed * state.lineFactor, Math.max(state.speed, tetoDeAvanco))
    state.progress = Math.min(TRACK_LENGTH, state.progress + (avanco / 3.6) * h)

    // As batidas são conferidas a cada passo fixo, e não a cada quadro. Com a
    // conferência por quadro, um aparelho a vinte quadros por segundo batia
    // até três metros mais adiante que um a sessenta — e o reset, que para o
    // carro onde a batida acontece, herdava a diferença. No passo fixo os três
    // percorrem a mesma sequência, como o resto da física.
    if (conferirBatidas(state, events)) continue
  }

  state.topSpeed = Math.max(state.topSpeed, state.speed)

  if (state.progress >= TRACK_LENGTH) {
    state.finished = true
    events.push({ type: 'finish' })
  }

  return events
}

/**
 * Confere as batidas na posição atual e aplica o que cada uma cobra.
 *
 * Devolve true quando a batida resetou o carro: a terceira batida não é mais
 * uma penalidade de velocidade, é o reset, que já vem com a punição inteira.
 */
function conferirBatidas(state: RaceState, events: RaceEvent[]) {
  for (const obstacle of state.rules.obstacles) {
    const delta = obstacle.distance - state.progress
    if (delta <= -5 || delta >= 8) continue
    if (Math.abs(state.lateral - obstacle.lane) >= HIT_HALF_WIDTH[obstacle.kind]) continue
    if (state.hitObstacles.has(obstacle.id)) continue
    state.hitObstacles.add(obstacle.id)
    state.collisions += 1
    events.push({ type: 'collision', obstacleId: obstacle.id })
    if (HIT_IS_CRASH[obstacle.kind]) state.strikes += 1
    if (state.strikes >= RESET_STRIKES) {
      resetar(state)
      events.push({ type: 'reset', reason: 'crashes' })
      return true
    }
    // Nunca encurta uma penalidade em curso: cair num buraco logo depois de
    // bater numa barreira não pode virar alívio.
    state.penalty = Math.max(
      state.penalty,
      state.rules.penaltySeconds * HIT_PENALTY_SHARE[obstacle.kind],
    )
  }
  return false
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}
