/**
 * Garagem: os carros que o piloto pode escolher.
 *
 * A escolha é só de pintura. Todos andam com a mesma física — a que sai da
 * dificuldade da sala —, porque o duelo existe para medir quem dirige melhor:
 * um carro mais rápido decidiria a corrida antes da largada. Por isso nada
 * daqui entra em `simulation.ts` nem em `rules.ts`.
 *
 * Ao contrário da dificuldade, é estado do piloto e não da sala: cada um
 * escolhe o seu, e o servidor guarda a escolha só para contar ao rival qual
 * carro desenhar como fantasma.
 *
 * Este módulo não depende do navegador: o servidor o usa para validar o que
 * chega pela rede. O desenho de cada carro fica em `carModel.ts`.
 */
export type CarId = 'senna' | 'schumacher' | 'hamilton-mercedes' | 'verstappen' | 'hamilton-ferrari'

export type Car = {
  id: CarId
  /** Nome do piloto, como aparece na seleção. */
  driver: string
  /** Sigla de três letras, como nas transmissões. */
  code: string
  team: string
  number: number
  country: string
  /** Cor da pintura que identifica o carro na interface. */
  accent: string
}

/** Em ordem cronológica, que é a ordem em que aparecem na seleção. */
export const CARS: readonly Car[] = [
  { id: 'senna', driver: 'Ayrton Senna', code: 'SEN', team: 'McLaren', number: 12, country: 'Brasil', accent: '#ffd21f' },
  { id: 'schumacher', driver: 'Michael Schumacher', code: 'MSC', team: 'Ferrari', number: 1, country: 'Alemanha', accent: '#ff2b1c' },
  { id: 'hamilton-mercedes', driver: 'Lewis Hamilton', code: 'HAM', team: 'Mercedes', number: 44, country: 'Reino Unido', accent: '#00d7c4' },
  { id: 'verstappen', driver: 'Max Verstappen', code: 'VER', team: 'Red Bull', number: 1, country: 'Países Baixos', accent: '#5b82ff' },
  { id: 'hamilton-ferrari', driver: 'Lewis Hamilton', code: 'HAM', team: 'Ferrari', number: 44, country: 'Reino Unido', accent: '#ff6a3d' },
]

/** Carro de quem ainda não escolheu, e de quem manda uma escolha que não existe. */
export const DEFAULT_CAR: CarId = 'senna'

const POR_ID = new Map(CARS.map((car) => [car.id, car]))

/** Verdadeiro quando o texto é um carro da garagem. */
export function isCarId(value: unknown): value is CarId {
  return typeof value === 'string' && POR_ID.has(value as CarId)
}

/** Normaliza o que vier da rede ou do armazenamento: desconhecido cai no padrão. */
export function toCarId(value: unknown): CarId {
  return isCarId(value) ? value : DEFAULT_CAR
}

export function carById(id: CarId): Car {
  return POR_ID.get(id) ?? POR_ID.get(DEFAULT_CAR)!
}
