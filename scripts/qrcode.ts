/**
 * Gera o QR code definitivo da apresentação.
 *
 * Produz um SVG para o slide, um PNG para imprimir e um desenho no terminal
 * para conferir na hora. Sem argumento, usa o endereço da máquina na rede
 * local — o caso do workshop rodando em um notebook.
 *
 *   npm run qrcode
 *   npm run qrcode -- https://corrida.exemplo.com
 *   npm run qrcode -- https://corrida.exemplo.com --sala DEMO1
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { networkInterfaces } from 'node:os'
import { resolve } from 'node:path'
import QRCode from 'qrcode'

const DESTINO = resolve('qrcode')

function lerOpcao(nome: string) {
  const indice = process.argv.indexOf(`--${nome}`)
  return indice >= 0 && process.argv[indice + 1] ? process.argv[indice + 1] : null
}

/** Primeiro endereço IPv4 da máquina na rede local. */
function enderecoLocal() {
  const rede = Object.values(networkInterfaces())
    .flat()
    .find((item) => item && item.family === 'IPv4' && !item.internal)
  return rede ? `http://${rede.address}:${process.env.PORT ?? 3001}` : null
}

function montarUrl() {
  const informado = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null
  const base = informado ?? enderecoLocal()
  if (!base) throw new Error('Informe o endereço do jogo. Exemplo: npm run qrcode -- https://seu-endereco')

  const sala = lerOpcao('sala')
  const url = new URL(base)
  if (sala) url.searchParams.set('room', sala.trim().toUpperCase())
  return url.toString()
}

async function main() {
  const url = montarUrl()

  if (url.startsWith('http://') && !url.includes('localhost') && !/^http:\/\/(10|192|172)\./.test(url)) {
    console.warn('Atenção: endereço sem HTTPS. Em rede pública o navegador pode bloquear recursos.\n')
  }

  console.log(await QRCode.toString(url, { type: 'terminal', small: true }))
  console.log(`Endereço: ${url}\n`)

  await mkdir(DESTINO, { recursive: true })
  const opcoes = { margin: 2, color: { dark: '#090d12', light: '#f4f4ee' } } as const

  const svg = await QRCode.toString(url, { ...opcoes, type: 'svg', width: 1024 })
  await writeFile(resolve(DESTINO, 'corrida-fantasma.svg'), svg, 'utf8')
  await QRCode.toFile(resolve(DESTINO, 'corrida-fantasma.png'), url, { ...opcoes, width: 1024 })
  await writeFile(resolve(DESTINO, 'endereco.txt'), `${url}\n`, 'utf8')

  console.log(`Arquivos em ${DESTINO}:`)
  console.log('  corrida-fantasma.svg  — para o slide')
  console.log('  corrida-fantasma.png  — para imprimir')
  console.log('  endereco.txt          — o endereço em texto, para digitar se o QR falhar')
}

main().catch((erro) => {
  console.error('Não foi possível gerar o QR code:', erro instanceof Error ? erro.message : erro)
  process.exit(1)
})
