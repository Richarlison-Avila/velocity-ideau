/**
 * Traz as fontes do Google para dentro do projeto.
 *
 * No workshop o jogo pode rodar em uma rede local sem internet. Buscar a
 * tipografia em um servidor externo travaria a renderização e derrubaria toda
 * a identidade visual justo na hora da demonstração, então os arquivos ficam
 * junto do site.
 *
 *   npm run fontes
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const FONTE_CSS =
  'https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,600;0,700;0,800;0,900;1,800;1,900&family=Inter:wght@400;700&display=swap'

// Um navegador moderno recebe woff2, que é bem menor que os formatos antigos.
const NAVEGADOR =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const DESTINO_FONTES = resolve('public/fontes')
const DESTINO_CSS = resolve('src/fontes.css')

type Bloco = { subset: string; corpo: string }

/** Separa os @font-face e guarda o subset anotado no comentário anterior. */
function separarBlocos(css: string): Bloco[] {
  const blocos: Bloco[] = []
  const padrao = /\/\*\s*([\w-]+)\s*\*\/\s*(@font-face\s*\{[^}]*\})/g
  let achado: RegExpExecArray | null
  while ((achado = padrao.exec(css)) !== null) {
    blocos.push({ subset: achado[1], corpo: achado[2] })
  }
  return blocos
}

function nomeDoArquivo(bloco: string, url: string) {
  const familia = /font-family:\s*'([^']+)'/.exec(bloco)?.[1] ?? 'fonte'
  const peso = /font-weight:\s*(\d+)/.exec(bloco)?.[1] ?? '400'
  const italico = /font-style:\s*italic/.test(bloco) ? '-italic' : ''
  const versao = /\/v(\d+)\//.exec(url)?.[1] ?? '0'
  return `${familia.toLowerCase().replace(/\s+/g, '-')}-${peso}${italico}-v${versao}.woff2`
}

async function main() {
  console.log('Buscando a folha de estilo das fontes…')
  const resposta = await fetch(FONTE_CSS, { headers: { 'User-Agent': NAVEGADOR } })
  if (!resposta.ok) throw new Error(`A folha de estilo respondeu ${resposta.status}.`)
  const css = await resposta.text()

  // O alfabeto latino básico já cobre todos os acentos do português.
  const blocos = separarBlocos(css).filter((bloco) => bloco.subset === 'latin')
  if (blocos.length === 0) throw new Error('Nenhum bloco latino encontrado na folha de estilo.')

  await mkdir(DESTINO_FONTES, { recursive: true })
  const declaracoes: string[] = []
  let total = 0

  for (const bloco of blocos) {
    const url = /url\((https:\/\/[^)]+)\)/.exec(bloco.corpo)?.[1]
    if (!url) continue

    const arquivo = nomeDoArquivo(bloco.corpo, url)
    const binario = await fetch(url, { headers: { 'User-Agent': NAVEGADOR } })
    if (!binario.ok) throw new Error(`${arquivo} respondeu ${binario.status}.`)
    const dados = Buffer.from(await binario.arrayBuffer())
    await writeFile(resolve(DESTINO_FONTES, arquivo), dados)
    total += dados.byteLength
    console.log(`  ${arquivo} — ${(dados.byteLength / 1024).toFixed(1)} kB`)

    declaracoes.push(
      bloco.corpo
        .replace(/url\(https:\/\/[^)]+\)/, `url('/fontes/${arquivo}')`)
        .replace(/\s*unicode-range:[^;]+;/, '')
        .replace(/\n\s*\n/g, '\n'),
    )
  }

  const cabecalho = [
    '/* Gerado por `npm run fontes`. Não edite à mão. */',
    '/* As fontes ficam no projeto para o jogo funcionar em rede sem internet. */',
    '',
  ].join('\n')
  await writeFile(DESTINO_CSS, `${cabecalho}${declaracoes.join('\n\n')}\n`, 'utf8')

  console.log(`\n${declaracoes.length} arquivos, ${(total / 1024).toFixed(1)} kB no total.`)
  console.log(`Folha de estilo escrita em ${DESTINO_CSS}.`)
}

main().catch((erro) => {
  console.error('Não foi possível baixar as fontes:', erro instanceof Error ? erro.message : erro)
  process.exit(1)
})
