/**
 * Música da sala de espera.
 *
 * Com seis pilotos, o lobby deixou de ser uma passagem: é ali que se espera o
 * último confirmar. A faixa Turbo toca enquanto isso, num contexto de áudio só
 * dela — o da corrida nasce na largada, com o motor, e este se despede antes.
 *
 * O navegador só libera som depois de um gesto. Quem chega ao lobby acabou de
 * clicar em "criar" ou "entrar", o que costuma bastar; quem chega por um link
 * aberto direto, não. Por isso `tocar` pode ser chamado de novo a cada toque
 * na tela até o contexto destravar.
 *
 * A espera pode durar minutos, com a tela apagada ou no WhatsApp mandando o
 * código da sala. Com a música desligada ou a página escondida, o contexto
 * dorme: não gasta bateria e não toca no bolso de ninguém.
 */
import { MASTER_GAIN, ruidoBranco } from './audio'
import { TrilhaTurbo } from './trilhaTurbo'

/** Depois de desligar a música, o tempo de a queda terminar antes de o contexto dormir. */
const DORME_DEPOIS_MS = 700

export class MusicaDoLobby {
  private ctx: AudioContext | null = null
  private trilha: TrilhaTurbo | null = null
  private ligada: boolean
  private adormecer = 0

  constructor(ligada: boolean) {
    this.ligada = ligada
  }

  /** Cria o contexto na primeira vez, destrava se preciso e começa a tocar. */
  tocar() {
    if (!this.ligada) return
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext ??
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioContextClass) return
      try {
        // Só música de fundo: a latência não importa, e buffers maiores
        // acordam menos a thread de áudio para o mesmo som.
        const ctx = new AudioContextClass({ latencyHint: 'playback' })
        const master = ctx.createGain()
        master.gain.setValueAtTime(MASTER_GAIN, ctx.currentTime)
        master.connect(ctx.destination)
        this.ctx = ctx
        this.trilha = new TrilhaTurbo(ctx, master, ruidoBranco(ctx))
        document.addEventListener('visibilitychange', this.aoMudarVisibilidade)
      } catch {
        // Sem áudio a sala segue igual.
        return
      }
    }
    // Suspenso até um gesto, ou interrompido por uma ligação no iPhone.
    const estado = this.ctx.state as string
    if (estado !== 'running' && estado !== 'closed') void this.ctx.resume().catch(() => {})
    this.trilha?.start()
  }

  get tocando() {
    return this.ctx?.state === 'running' && (this.trilha?.playing ?? false)
  }

  setLigada(ligada: boolean) {
    this.ligada = ligada
    window.clearTimeout(this.adormecer)
    if (ligada) {
      this.tocar()
      this.trilha?.setEnabled(true)
    } else {
      this.trilha?.setEnabled(false)
      this.adormecer = window.setTimeout(() => {
        if (!this.ligada) this.dormir()
      }, DORME_DEPOIS_MS)
    }
  }

  /** Some aos poucos e libera o contexto. */
  encerrar() {
    const ctx = this.ctx
    window.clearTimeout(this.adormecer)
    document.removeEventListener('visibilitychange', this.aoMudarVisibilidade)
    this.trilha?.stop(0.6)
    this.ctx = null
    this.trilha = null
    if (ctx) window.setTimeout(() => void ctx.close().catch(() => {}), 900)
  }

  private dormir() {
    void this.ctx?.suspend().catch(() => {})
  }

  /**
   * A página escondida põe o contexto para dormir; voltando, a música segue de
   * onde parou, porque o relógio da faixa parou junto.
   */
  private readonly aoMudarVisibilidade = () => {
    if (document.hidden) this.dormir()
    else if (this.ligada && this.ctx) this.tocar()
  }
}
