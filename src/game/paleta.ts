/**
 * Vocabulário de cor do jogo.
 *
 * Carro e cenário são desenhados pela mesma regra, e é por isso que ela mora
 * num módulo só: nenhum volume usa degradê, todos são resolvidos em degraus de
 * uma rampa de cinco tons, como um artista de pixel art resolve um cilindro. A
 * luz vem de cima e da esquerda em tudo — na copa da árvore, no ombro do
 * pontão, no poste da beira da pista —, e é essa concordância que faz o carro
 * parecer estar dentro da cena em vez de colado por cima dela.
 */

/** Tom para onde a sombra puxa: o azul frio da hora da corrida. */
export const SOMBRA = '#0e1a24'

/** Tom para onde o brilho puxa: o sol quente que ilumina o cenário. */
export const LUZ = '#fff2d2'

function ler(cor: string) {
  const n = parseInt(cor.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function escrever(rgb: number[]) {
  return `#${rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`
}

/** Mistura duas cores; `quanto` vai de 0 (só `a`) a 1 (só `b`). */
export function misturar(a: string, b: string, quanto: number) {
  const [ar, ag, ab] = ler(a)
  const [br, bg, bb] = ler(b)
  return escrever([ar + (br - ar) * quanto, ag + (bg - ag) * quanto, ab + (bb - ab) * quanto])
}

/** Quanto de luz uma cor tem, de 0 (preto) a 1 (branco). */
export function claridade(cor: string) {
  const [vermelho, verde, azul] = ler(cor)
  return (0.299 * vermelho + 0.587 * verde + 0.114 * azul) / 255
}

/**
 * Rampa de cinco tons de uma cor, do mais escuro ao mais claro.
 *
 * A rampa desliza com a luminância da cor, e não é capricho: numa cor clara
 * não há para onde clarear. O branco da McLaren saía com as três faixas de
 * cima idênticas, e o volume sumia justamente onde ele mais faz falta. Numa
 * cor clara o relevo tem de vir de escurecer; numa escura, de clarear. O tom
 * do meio continua sendo a cor pedida, sem mistura nenhuma.
 */
export type Rampa = readonly [string, string, string, string, string]

export function rampa(base: string): Rampa {
  const luminancia = claridade(base)
  const subir = 0.12 + 0.5 * (1 - luminancia)
  const descer = 0.3 + 0.45 * luminancia
  return [
    misturar(base, SOMBRA, descer),
    misturar(base, SOMBRA, descer * 0.45),
    base,
    misturar(base, LUZ, subir * 0.45),
    misturar(base, LUZ, subir),
  ]
}
