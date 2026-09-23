/**
 * Classificação ao vivo da prova: quem está em que posição e a quanto tempo
 * de quem se está olhando.
 *
 * Serve às duas telas que acompanham a corrida inteira — a do piloto, que vê
 * os cinco rivais, e a do espectador, que vê os seis. Os dados são os mesmos
 * dos fantasmas: progresso, velocidade e o instante da chegada de quem já
 * cruzou a linha.
 */

export type CarroNaProva = {
  id: string
  progress: number
  /** Velocidade em km/h. */
  speed: number
  state: 'racing' | 'finished'
  /** Instante da chegada, no relógio do servidor, para quem já cruzou a linha. */
  chegadaEm?: number | null
}

export type Colocado<T extends CarroNaProva = CarroNaProva> = T & { posicao: number }

/**
 * Ordena a prova. Quem chegou vem antes de quem corre, pela ordem de chegada;
 * quem corre, pelo progresso. O empate vai pelo identificador, para a lista
 * não trocar de ordem sozinha a cada quadro.
 */
export function classificar<T extends CarroNaProva>(carros: readonly T[]): Array<Colocado<T>> {
  return [...carros]
    .sort((a, b) => {
      if (a.state !== b.state) return a.state === 'finished' ? -1 : 1
      if (a.state === 'finished') {
        const chegadaA = a.chegadaEm ?? Number.POSITIVE_INFINITY
        const chegadaB = b.chegadaEm ?? Number.POSITIVE_INFINITY
        if (chegadaA !== chegadaB) return chegadaA - chegadaB
      }
      if (b.progress !== a.progress) return b.progress - a.progress
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
    .map((carro, indice) => ({ ...carro, posicao: indice + 1 }))
}

/**
 * Quanto tempo `outro` está à frente de `referencia`, em segundos: positivo à
 * frente, negativo atrás.
 *
 * Entre dois que já chegaram, é a diferença de chegada. Nos outros casos, a
 * distância dividida pelo ritmo médio da dupla, com um piso para o número não
 * explodir com alguém quase parado — a mesma conta do painel do rival.
 */
export function diferencaEmSegundos(referencia: CarroNaProva, outro: CarroNaProva) {
  if (referencia.state === 'finished' && outro.state === 'finished' && referencia.chegadaEm != null && outro.chegadaEm != null) {
    return (referencia.chegadaEm - outro.chegadaEm) / 1000
  }
  const metros = outro.progress - referencia.progress
  const ritmo = Math.max(15, (referencia.speed + outro.speed) / 2 / 3.6)
  return metros / ritmo
}

/** A diferença como aparece na tela: "+1,2", "−0,8", com vírgula e sinal de verdade. */
export function formatarDiferenca(segundos: number) {
  const valor = Math.abs(segundos)
  const texto = valor >= 60 ? `${Math.floor(valor / 60)}:${(valor % 60).toFixed(0).padStart(2, '0')}` : valor.toFixed(1).replace('.', ',')
  return `${segundos >= 0 ? '+' : '−'}${texto}`
}

/**
 * Quem a câmera do espectador segue no modo automático: o líder entre os que
 * ainda correm. Quem já chegou está parado na linha e não mostra mais a prova.
 * Com todos na chegada, o vencedor.
 */
export function liderEmProva<T extends CarroNaProva>(classificacao: ReadonlyArray<Colocado<T>>) {
  return classificacao.find((carro) => carro.state === 'racing') ?? classificacao[0] ?? null
}
