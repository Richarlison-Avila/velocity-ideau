// A extensão .js é exigida pelo Node, que roda este módulo no servidor.
import { obstacles, type Obstacle } from './track.js'

/**
 * Dificuldade da corrida.
 *
 * É estado oficial da sala, como a semente do traçado: o servidor guarda, os
 * dois pilotos recebem o mesmo valor antes da largada, e a física sai daqui.
 * Sem isso, dois clientes com regras diferentes disputariam corridas
 * diferentes — e o servidor validaria a chegada com o limite errado.
 *
 * Não existe fácil de propósito. "Normal" é a corrida que o projeto vinha
 * entregando; as outras duas apertam por cima dela.
 */
export type Difficulty = 'normal' | 'dificil' | 'profissional'

export const DIFFICULTIES: readonly Difficulty[] = ['normal', 'dificil', 'profissional']

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  normal: 'NORMAL',
  dificil: 'DIFÍCIL',
  profissional: 'PROFISSIONAL',
}

export const DIFFICULTY_NOTES: Record<Difficulty, string> = {
  normal: 'A corrida de referência.',
  dificil: 'Mais rápida, menos perdoa o volante.',
  profissional: 'Extrema. Erro custa caro e a pista não dá trégua.',
}

/** Tudo o que a dificuldade decide. Nada fora daqui muda entre os níveis. */
export type RaceRules = {
  difficulty: Difficulty
  /** Velocidade de cruzeiro em pista livre, em km/h. */
  cruiseSpeed: number
  /** Teto com o boost ativo. É ele que fixa o tempo mínimo plausível da prova. */
  boostSpeed: number
  /** Alvo enquanto a penalidade do impacto corre. */
  penaltySpeed: number
  /** Alvo com o carro na grama, antes da perda por profundidade. */
  offRoadSpeed: number
  /** Duração da penalidade após um impacto, em segundos. */
  penaltySeconds: number
  /** Agitação de volante tolerada sem perda de aderência. */
  agitationDeadband: number
  /** Perda máxima de aderência por esforço lateral. */
  maxGripLoss: number
  /** Perda adicional conforme o carro se embrenha na grama. */
  offRoadDepthLoss: number
  /** Consumo do boost por segundo. */
  boostDrain: number
  /** Recarga do boost por segundo. */
  boostRecharge: number
  /** Layout competitivo. Fixo por dificuldade, igual para os dois pilotos. */
  obstacles: readonly Obstacle[]
}

/**
 * Obstáculos extras do nível difícil.
 *
 * Entram nos vãos do traçado normal, nunca a menos de 180 m de um obstáculo
 * já existente na mesma faixa — é o que mantém tempo de leitura suficiente
 * depois de um desvio.
 */
const EXTRA_DIFICIL: Obstacle[] = [
  { id: 101, distance: 720, lane: 0.18, kind: 'debris' },
  { id: 102, distance: 1_150, lane: -0.3, kind: 'barrier' },
  { id: 103, distance: 1_610, lane: 0.34, kind: 'debris' },
  { id: 104, distance: 2_060, lane: -0.26, kind: 'debris' },
  { id: 105, distance: 2_540, lane: 0.28, kind: 'barrier' },
  { id: 106, distance: 2_980, lane: -0.36, kind: 'debris' },
  { id: 107, distance: 3_440, lane: 0.22, kind: 'barrier' },
  { id: 108, distance: 3_900, lane: -0.2, kind: 'debris' },
  { id: 109, distance: 4_330, lane: 0.3, kind: 'debris' },
]

/**
 * Buracos que fecham as beiradas da pista.
 *
 * Todos os obstáculos do projeto moravam em |faixa| ≤ 0,56, enquanto a pista
 * jogável vai até 1,153. Sobrava um corredor contínuo de 0,380 de largura em
 * cada beirada onde nada nunca encostava — 32% da pista — e ele era idêntico
 * nos três níveis: encostar na guia deixava o profissional tão vazio quanto
 * uma pista limpa.
 *
 * Estes ficam por volta de |0,95|, no meio daquele corredor, e entram nos
 * três níveis. Alternam de lado para que nenhuma das duas beiradas seja a
 * fácil.
 *
 * A posição não é escolhida pelo espaço livre, e sim pelo tempo de desvio: um
 * buraco na beirada seguido de um obstáculo no centro do outro lado obriga a
 * atravessar a pista inteira. Cada um cai no meio de um vão de 220 m ou mais,
 * que é o que mantém a folga acima do meio segundo exigido em teste — e o
 * último aproveita a reta final, depois do derradeiro obstáculo.
 */
const BURACOS: Obstacle[] = [
  { id: 301, distance: 830, lane: 0.95, kind: 'pothole' },
  { id: 302, distance: 1_260, lane: -0.95, kind: 'pothole' },
  { id: 303, distance: 1_725, lane: 0.92, kind: 'pothole' },
  { id: 304, distance: 2_185, lane: -0.98, kind: 'pothole' },
  { id: 305, distance: 2_650, lane: 0.95, kind: 'pothole' },
  { id: 306, distance: 3_095, lane: -0.92, kind: 'pothole' },
  { id: 307, distance: 3_560, lane: 0.98, kind: 'pothole' },
  { id: 308, distance: 4_010, lane: -0.95, kind: 'pothole' },
  { id: 309, distance: 4_740, lane: 0.9, kind: 'pothole' },
]

/** Obstáculos que só o profissional enfrenta, por cima dos do difícil. */
const EXTRA_PROFISSIONAL: Obstacle[] = [
  { id: 201, distance: 630, lane: -0.14, kind: 'debris' },
  { id: 202, distance: 1_040, lane: 0.5, kind: 'barrier' },
  { id: 203, distance: 1_480, lane: -0.44, kind: 'debris' },
  { id: 204, distance: 1_950, lane: 0.14, kind: 'debris' },
  { id: 205, distance: 2_420, lane: -0.48, kind: 'barrier' },
  { id: 206, distance: 2_870, lane: 0.38, kind: 'debris' },
  { id: 207, distance: 3_320, lane: -0.28, kind: 'debris' },
  { id: 208, distance: 3_790, lane: 0.46, kind: 'barrier' },
  { id: 209, distance: 4_230, lane: -0.16, kind: 'debris' },
  { id: 210, distance: 4_640, lane: 0.24, kind: 'debris' },
]

function ordenar(lista: Obstacle[]): readonly Obstacle[] {
  return [...lista].sort((a, b) => a.distance - b.distance)
}

const REGRAS: Record<Difficulty, RaceRules> = {
  normal: {
    difficulty: 'normal',
    cruiseSpeed: 252,
    boostSpeed: 314,
    penaltySpeed: 172,
    offRoadSpeed: 132,
    penaltySeconds: 1.65,
    agitationDeadband: 2.4,
    maxGripLoss: 0.17,
    offRoadDepthLoss: 0.25,
    boostDrain: 25,
    boostRecharge: 5.5,
    obstacles: ordenar([...obstacles, ...BURACOS]),
  },
  dificil: {
    difficulty: 'dificil',
    cruiseSpeed: 274,
    boostSpeed: 338,
    penaltySpeed: 168,
    offRoadSpeed: 126,
    penaltySeconds: 1.95,
    agitationDeadband: 2,
    maxGripLoss: 0.23,
    offRoadDepthLoss: 0.32,
    boostDrain: 29,
    boostRecharge: 4.9,
    obstacles: ordenar([...obstacles, ...BURACOS, ...EXTRA_DIFICIL]),
  },
  profissional: {
    difficulty: 'profissional',
    cruiseSpeed: 296,
    boostSpeed: 362,
    penaltySpeed: 162,
    offRoadSpeed: 118,
    penaltySeconds: 2.3,
    agitationDeadband: 1.7,
    maxGripLoss: 0.29,
    offRoadDepthLoss: 0.4,
    boostDrain: 33,
    boostRecharge: 4.3,
    obstacles: ordenar([...obstacles, ...BURACOS, ...EXTRA_DIFICIL, ...EXTRA_PROFISSIONAL]),
  },
}

/** Verdadeiro quando o texto é uma dificuldade conhecida. */
export function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === 'string' && (DIFFICULTIES as readonly string[]).includes(value)
}

/** Normaliza o que vier da rede: entrada desconhecida cai no padrão. */
export function toDifficulty(value: unknown): Difficulty {
  return isDifficulty(value) ? value : 'normal'
}

export function rulesFor(difficulty: Difficulty): RaceRules {
  return REGRAS[difficulty]
}

/**
 * Maior velocidade que qualquer dificuldade alcança.
 *
 * O servidor usa o teto da sala para validar a chegada, mas este número serve
 * de guarda geral: nenhuma telemetria plausível passa dele.
 */
export const TOP_SPEED_OF_ALL = Math.max(...DIFFICULTIES.map((nivel) => REGRAS[nivel].boostSpeed))
