/**
 * Preferências de som, guardadas entre corridas e entre recargas da página.
 *
 * Moram fora da corrida porque o lobby também toca música: quem desligou a
 * trilha na prova não quer ouvi-la de novo na sala, e vice-versa.
 *
 * A trilha é separada do som. Há quem queira o motor e não a música — no
 * workshop, com vinte celulares tocando ao mesmo tempo na mesma sala, é quase
 * todo mundo. Desligar a música não pode custar o som do carro, que é retorno
 * de jogo.
 */
const SOM_KEY = 'ghost-racer-mudo'
const MUSICA_KEY = 'ghost-racer-sem-musica'

function ler(chave: string) {
  try {
    return sessionStorage.getItem(chave) === '1'
  } catch {
    // Navegação privada pode recusar o armazenamento; o som segue ligado.
    return false
  }
}

function guardar(chave: string, desligado: boolean) {
  try {
    sessionStorage.setItem(chave, desligado ? '1' : '0')
  } catch {
    // Sem armazenamento só se perde a lembrança entre recargas.
  }
}

let somDesligado = ler(SOM_KEY)
let musicaDesligada = ler(MUSICA_KEY)

export function lerSomDesligado() {
  return somDesligado
}

export function lerMusicaDesligada() {
  return musicaDesligada
}

export function definirSomDesligado(desligado: boolean) {
  somDesligado = desligado
  guardar(SOM_KEY, desligado)
}

export function definirMusicaDesligada(desligada: boolean) {
  musicaDesligada = desligada
  guardar(MUSICA_KEY, desligada)
}
