// A extensão .js é exigida pelo Node, que roda este módulo no servidor durante
// os testes de aceitação. O Vite resolve para o arquivo .ts normalmente.
import { rulesFor, type Difficulty, type RaceRules } from './rules.js'
import { HIT_HALF_WIDTH, HIT_PENALTY_SHARE, LATERAL_LIMIT, OFF_ROAD_LIMIT, TRACK_LENGTH } from './track.js'

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

export type RaceEvent = { type: 'collision'; obstacleId: number } | { type: 'finish' }

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
export const CORNER_PUSH = 1.64

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
    finished: false,
    hitObstacles: new Set<number>(),
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
  /** Curvatura no ponto do carro, de -1 (curva à esquerda) a 1 (à direita). */
  curvature: number
  /** Força do vácuo do rival, de 0 a 1. */
  slipstream: number
}

/** Pista reta e sem ninguém à frente: o que vale quando nada é informado. */
export const NO_CONTEXT: RaceContext = { curvature: 0, slipstream: 0 }

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
  const curvatura = Number.isFinite(context.curvature) ? clamp(context.curvature, -1, 1) : 0
  state.slipstream = Number.isFinite(context.slipstream) ? clamp(context.slipstream, 0, 1) : 0

  let restante = step
  while (restante > 1e-9) {
    const h = Math.min(PHYSICS_STEP, restante)
    restante -= h

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
    const proporcao = state.speed / state.rules.cruiseSpeed
    const carga = curvatura * proporcao * proporcao
    state.cornerLoad = Math.min(1, Math.abs(carga))
    const escapa = Math.max(0, Math.abs(carga) - state.rules.cornerGrip)
    // Curva à direita joga o carro para a esquerda, daí o sinal invertido.
    const empurrao = -Math.sign(carga) * escapa * CORNER_PUSH

    state.lateral = clamp(
      state.lateral + (state.steerInput * (STEER_RATE + state.speed / 520) + empurrao) * h,
      -LATERAL_LIMIT,
      LATERAL_LIMIT,
    )
    state.offRoad = Math.abs(state.lateral) > OFF_ROAD_LIMIT

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

    state.progress = Math.min(TRACK_LENGTH, state.progress + (state.speed / 3.6) * h)
  }

  state.topSpeed = Math.max(state.topSpeed, state.speed)

  for (const obstacle of state.rules.obstacles) {
    const delta = obstacle.distance - state.progress
    if (delta <= -5 || delta >= 8) continue
    if (Math.abs(state.lateral - obstacle.lane) >= HIT_HALF_WIDTH[obstacle.kind]) continue
    if (state.hitObstacles.has(obstacle.id)) continue
    state.hitObstacles.add(obstacle.id)
    state.collisions += 1
    // Nunca encurta uma penalidade em curso: cair num buraco logo depois de
    // bater numa barreira não pode virar alívio.
    state.penalty = Math.max(
      state.penalty,
      state.rules.penaltySeconds * HIT_PENALTY_SHARE[obstacle.kind],
    )
    events.push({ type: 'collision', obstacleId: obstacle.id })
  }

  if (state.progress >= TRACK_LENGTH) {
    state.finished = true
    events.push({ type: 'finish' })
  }

  return events
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}
