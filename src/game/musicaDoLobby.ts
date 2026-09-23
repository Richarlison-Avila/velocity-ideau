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
 */
import { MASTER_GAIN, ruidoBranco } from './audio'
import { TrilhaTurbo } from './trilhaTurbo'

export class MusicaDoLobby {
  private ctx: AudioContext | null = null
  private trilha: TrilhaTurbo | null = null
  private ligada: boolean

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
        const ctx = new AudioContextClass()
        const master = ctx.createGain()
        master.gain.setValueAtTime(MASTER_GAIN, ctx.currentTime)
        master.connect(ctx.destination)
        this.ctx = ctx
        this.trilha = new TrilhaTurbo(ctx, master, ruidoBranco(ctx))
      } catch {
        // Sem áudio a sala segue igual.
        return
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    this.trilha?.start()
  }

  get tocando() {
    return this.ctx?.state === 'running' && (this.trilha?.playing ?? false)
  }

  setLigada(ligada: boolean) {
    this.ligada = ligada
    if (ligada) {
      this.tocar()
      this.trilha?.setEnabled(true)
    } else {
      this.trilha?.setEnabled(false)
    }
  }

  /** Some aos poucos e libera o contexto. */
  encerrar() {
    const ctx = this.ctx
    this.trilha?.stop(0.6)
    this.ctx = null
    this.trilha = null
    if (ctx) window.setTimeout(() => void ctx.close().catch(() => {}), 900)
  }
}
