import { createHash, randomBytes } from 'node:crypto'

/**
 * Perfil leve: apelido e um segredo gerado pelo servidor.
 *
 * Não há cadastro, e-mail nem senha: o jogo nasceu para abrir por um QR code
 * num workshop. O aparelho guarda o identificador e o segredo, e o servidor
 * guarda só o hash do segredo. Para levar o perfil a outro aparelho existe o
 * código de recuperação, que é o par inteiro.
 */

/** Um segredo novo: 24 bytes aleatórios, em base64 para caber numa URL. */
export function novoSegredo() {
  return randomBytes(24).toString('base64url')
}

/** O hash que o servidor guarda no lugar do segredo. */
export function hashDoSegredo(segredo: string) {
  return createHash('sha256').update(segredo).digest('hex')
}

/** O apelido como a sala já limpa o nome: aparado, até 16 letras, e nunca vazio. */
export function apelidoLimpo(bruto: unknown) {
  const texto = typeof bruto === 'string' ? bruto.replace(/\s+/g, ' ').trim() : ''
  return texto.slice(0, 16) || 'Piloto'
}

/**
 * Limite de perfis novos por endereço.
 *
 * Sem contas fortes, a multiconta não some — mas também não pode ser de graça.
 * Dez perfis por hora por endereço cobrem uma sala de aula atrás do mesmo
 * roteador e não cobrem um script.
 */
export class LimiteDePerfis {
  private readonly criados = new Map<string, number[]>()

  constructor(
    private readonly porHora = 10,
    private readonly agora: () => number = Date.now,
  ) {}

  /** Registra um perfil novo daquele endereço, se couber. Devolve se coube. */
  permitir(endereco: string) {
    const umaHoraAtras = this.agora() - 3_600_000
    const recentes = (this.criados.get(endereco) ?? []).filter((instante) => instante > umaHoraAtras)
    if (recentes.length >= this.porHora) {
      this.criados.set(endereco, recentes)
      return false
    }
    recentes.push(this.agora())
    this.criados.set(endereco, recentes)
    return true
  }
}
