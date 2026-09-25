/**
 * Garagem: os carros que o piloto pode escolher.
 *
 * A escolha é só de pintura. Todos andam com a mesma física — a que sai da
 * dificuldade da sala —, porque o duelo existe para medir quem dirige melhor:
 * um carro mais rápido decidiria a corrida antes da largada. Por isso nada
 * daqui entra em `simulation.ts` nem em `rules.ts` — com uma exceção de
 * brincadeira, o easter egg de `turboDoPiloto` em `rules.ts`.
 *
 * Ao contrário da dificuldade, é estado do piloto e não da sala: cada um
 * escolhe o seu, e o servidor guarda a escolha só para contar ao rival qual
 * carro desenhar como fantasma.
 *
 * Este módulo não depende do navegador: o servidor o usa para validar o que
 * chega pela rede, e `scripts/preparar-carros.ts` para gerar as artes em PNG
 * que o menu, a seleção, o lobby e o resultado mostram. Na corrida é a mesma
 * arte, assada por `carSprites.ts` nos quadros de curva e derrapagem.
 */
export type CarId =
  | 'senna-lotus'
  | 'senna'
  | 'barrichello-ferrari'
  | 'schumacher'
  | 'barrichello-brawn'
  | 'massa-ferrari'
  | 'massa-williams'
  | 'hamilton-mercedes'
  | 'verstappen'
  | 'hamilton-ferrari'
  | 'bortoleto-audi'
  | 'vettel'
  | 'raikkonen-mercedes'
  | 'leclerc'
  | 'alonso-aston-martin'
  | 'alonso-renault'

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

export type Pilot = {
  /** Nome e dados do piloto aparecem uma vez; as pinturas ficam agrupadas. */
  driver: string
  code: string
  country: string
  cars: readonly Car[]
}

/** Em ordem cronológica, que é a ordem em que aparecem na seleção. */
export const CARS: readonly Car[] = [
  { id: 'senna-lotus', driver: 'Ayrton Senna', code: 'SEN', team: 'Lotus', number: 12, country: 'Brasil', accent: '#d9ad43' },
  { id: 'senna', driver: 'Ayrton Senna', code: 'SEN', team: 'McLaren', number: 12, country: 'Brasil', accent: '#ffd21f' },
  { id: 'barrichello-ferrari', driver: 'Rubens Barrichello', code: 'BAR', team: 'Ferrari', number: 3, country: 'Brasil', accent: '#ed1c24' },
  { id: 'schumacher', driver: 'Michael Schumacher', code: 'MSC', team: 'Ferrari', number: 1, country: 'Alemanha', accent: '#ff2b1c' },
  { id: 'barrichello-brawn', driver: 'Rubens Barrichello', code: 'BAR', team: 'Brawn GP', number: 23, country: 'Brasil', accent: '#cfff00' },
  { id: 'massa-ferrari', driver: 'Felipe Massa', code: 'MAS', team: 'Ferrari', number: 6, country: 'Brasil', accent: '#ff1e16' },
  { id: 'massa-williams', driver: 'Felipe Massa', code: 'MAS', team: 'Williams', number: 19, country: 'Brasil', accent: '#168bd2' },
  { id: 'hamilton-mercedes', driver: 'Lewis Hamilton', code: 'HAM', team: 'Mercedes', number: 44, country: 'Reino Unido', accent: '#00d7c4' },
  { id: 'verstappen', driver: 'Max Verstappen', code: 'VER', team: 'Red Bull', number: 1, country: 'Países Baixos', accent: '#5b82ff' },
  { id: 'hamilton-ferrari', driver: 'Lewis Hamilton', code: 'HAM', team: 'Ferrari', number: 44, country: 'Reino Unido', accent: '#ff6a3d' },
  { id: 'bortoleto-audi', driver: 'Gabriel Bortoleto', code: 'BOR', team: 'Audi', number: 5, country: 'Brasil', accent: '#f50514' },
  { id: 'vettel', driver: 'Sebastian Vettel', code: 'VET', team: 'Red Bull', number: 1, country: 'Alemanha', accent: '#f6d30a' },
  { id: 'raikkonen-mercedes', driver: 'Kimi Räikkönen', code: 'RAI', team: 'Mercedes', number: 7, country: 'Finlândia', accent: '#00d2be' },
  { id: 'leclerc', driver: 'Charles Leclerc', code: 'LEC', team: 'Ferrari', number: 16, country: 'Mônaco', accent: '#f20d16' },
  { id: 'alonso-aston-martin', driver: 'Fernando Alonso', code: 'ALO', team: 'Aston Martin', number: 14, country: 'Espanha', accent: '#00a887' },
  { id: 'alonso-renault', driver: 'Fernando Alonso', code: 'ALO', team: 'Renault', number: 5, country: 'Espanha', accent: '#ffd72e' },
]

/**
 * Grade de pilotos da garagem. Um piloto aparece uma única vez mesmo quando
 * há mais de uma pintura disponível para ele.
 */
export const PILOTS: readonly Pilot[] = Array.from(
  CARS.reduce((pilots, car) => {
    const cars = pilots.get(car.driver)
    if (cars) cars.push(car)
    else pilots.set(car.driver, [car])
    return pilots
  }, new Map<string, Car[]>()),
  ([driver, cars]) => ({
    driver,
    code: cars[0].code,
    country: cars[0].country,
    cars,
  }),
)

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

/**
 * Molde comum das artes.
 *
 * As pinturas foram feitas sobre o mesmo chassi: pneus, asas e luz traseira
 * caem nos mesmos pixels em todas. As medidas são da arte original
 * (1086 × 1448, bico para cima) e valem para qualquer carro novo desenhado
 * no mesmo molde — `scripts/preparar-carros.ts` confere isso antes de gerar
 * o sprite, e recusa uma arte que não encaixe.
 *
 * O sprite é o recorte `crop` reduzido; a tela converte de volta para estas
 * coordenadas pela razão entre os dois, então mudar o tamanho do sprite não
 * mexe em nada do desenho.
 */
export const CAR_ART = {
  /** Recorte aplicado à arte original, com folga em volta do carro. */
  crop: { x: 24, y: 146, width: 1036, height: 1154 },
  /** Eixo de simetria do carro. */
  centerX: 542,
  /** Base dos pneus traseiros: é onde o carro toca o chão. */
  groundY: 1295,
  /**
   * De fora a fora dos pneus traseiros, a parte mais larga do carro. É o que
   * se casa com `CAR_SPRITE_HALF_WIDTH`, e portanto com a regra de saída de
   * pista: a arte ocupa exatamente a largura que o jogo cobra.
   */
  tyreSpan: 1026,
  /**
   * Pneu dianteiro esquerdo, que é recortado da carroceria para girar com o
   * volante. O direito é o reflexo deste retângulo no eixo de simetria.
   */
  frontWheel: { x: 112, y: 176, width: 180, height: 288 },
  /** Centro da luz traseira, que acende no boost. */
  rearLight: { x: 542, y: 1122 },
} as const
