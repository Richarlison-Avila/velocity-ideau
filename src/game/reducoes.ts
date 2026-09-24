/**
 * As reduções das folhas de sprite.
 *
 * O carro e o cenário saem de folhas assadas, e quase tudo é desenhado menor
 * do que foi assado: o fantasma lá na frente, a árvore no fim da vista. Pedir
 * ao canvas que reduza com qualidade alta sai caro no Chrome, e caro a cada
 * quadro — medido com seis carros na pista, era o que mais pesava na GPU:
 * trocar só a qualidade da amostragem subia de 22–28 para 34–35 quadros por
 * segundo. A suavização comum é quase de graça, mas reduz mal: pula texels e
 * serrilha a pintura.
 *
 * A saída é a de sempre em jogo: cada folha guarda o desenho também pela
 * metade, por um quarto e assim por diante, assado uma vez só com qualidade
 * alta. O quadro escolhe a redução mais perto do tamanho na tela e a desenha
 * com a suavização comum, que de uma redução de menos de duas vezes dá conta.
 */

const densidades = new WeakMap<CanvasRenderingContext2D, number>()

/**
 * Diz quantos pixels do aparelho cada unidade do contexto ocupa.
 *
 * É o `devicePixelRatio` que o dono do canvas aplicou na escala. As reduções
 * são escolhidas pelo tamanho em pixels de verdade — o de uma tela de celular é
 * o dobro do tamanho CSS —, e um contexto que não disse nada conta um por um.
 */
export function definirDensidade(ctx: CanvasRenderingContext2D, densidade: number) {
  densidades.set(ctx, Number.isFinite(densidade) && densidade > 0 ? densidade : 1)
}

export function densidadeDe(ctx: CanvasRenderingContext2D) {
  return densidades.get(ctx) ?? 1
}

/**
 * Folga da escolha, em oitavas.
 *
 * Com o piso puro do logaritmo, a redução final ficaria entre uma e duas
 * vezes, e perto de duas a suavização comum já pula texels. A folga troca para
 * a redução seguinte um pouco antes: sobra entre 0,81 e 1,62 vez, com uma
 * ampliação leve no pior caso, que borra menos do que o serrilhado incomoda.
 */
const FOLGA_DA_ESCOLHA = 0.3

/**
 * Qual redução usar, de 0 (a folha cheia) a `quantas - 1`.
 *
 * `reducao` é quantas vezes a folha cheia é maior que o desenho na tela. Abaixo
 * de uma vez — ampliando — fica a cheia: é a única com texel de sobra.
 */
export function nivelDaReducao(reducao: number, quantas: number) {
  if (!(reducao > 1) || quantas <= 1) return 0
  const nivel = Math.floor(Math.log2(reducao) + FOLGA_DA_ESCOLHA)
  return Math.max(0, Math.min(quantas - 1, nivel))
}
