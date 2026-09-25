import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import express, { type Express, type RequestHandler } from 'express'

/**
 * O site construído, servido para os celulares do evento.
 *
 * Na rede do evento não há proxy na frente do notebook para comprimir nem
 * guardar nada, e é quando dezenas de celulares leem o QR ao mesmo tempo. O
 * JS do jogo tem ~460 KB; comprimido, cabe em ~130 KB.
 */

/** O que vale comprimir. Imagem, áudio e fonte já chegam comprimidos. */
const COMPRIMIVEIS: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
}

/** Abaixo disso, comprimir não paga o cabeçalho. */
const MENOR_COMPRIMIVEL = 1_024

/** Os arquivos de /assets levam o hash do conteúdo no nome: nunca mudam. */
const PARA_SEMPRE = 'public, max-age=31536000, immutable'

type Comprimido = { tipo: string; br: Buffer; gzip: Buffer }

/**
 * Comprime de uma vez os arquivos de uma pasta de assets. Eles não mudam
 * enquanto o servidor roda, então o custo é pago na subida, e não a cada
 * celular.
 */
export function comprimirAssets(pasta: string) {
  const arquivos = new Map<string, Comprimido>()
  for (const nome of readdirSync(pasta)) {
    const tipo = COMPRIMIVEIS[extname(nome)]
    if (!tipo) continue
    const bytes = readFileSync(resolve(pasta, nome))
    if (bytes.length < MENOR_COMPRIMIVEL) continue
    arquivos.set(nome, {
      tipo,
      br: brotliCompressSync(bytes, {
        params: {
          [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
          [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
        },
      }),
      gzip: gzipSync(bytes, { level: 9 }),
    })
  }
  return arquivos
}

/** O navegador aceita esta codificação? Um `q=0` é recusa explícita. */
export function aceita(cabecalho: string | undefined, codificacao: string) {
  for (const parte of (cabecalho ?? '').split(',')) {
    const [nome, ...parametros] = parte.split(';').map((trecho) => trecho.trim().toLowerCase())
    if (nome !== codificacao) continue
    const peso = parametros.find((parametro) => parametro.startsWith('q='))
    return peso === undefined || Number(peso.slice(2)) > 0
  }
  return false
}

function servirComprimidos(arquivos: Map<string, Comprimido>): RequestHandler {
  return (request, response, next) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return next()
    const arquivo = arquivos.get(request.path.slice(1))
    if (!arquivo) return next()
    response.setHeader('Vary', 'Accept-Encoding')
    const pedido = request.headers['accept-encoding']
    const codificacao = aceita(pedido, 'br') ? 'br' : aceita(pedido, 'gzip') ? 'gzip' : null
    // Quem não aceita nenhuma recebe o arquivo como está, do express.static.
    if (!codificacao) return next()
    const corpo = arquivo[codificacao]
    response.setHeader('Content-Type', arquivo.tipo)
    response.setHeader('Content-Encoding', codificacao)
    response.setHeader('Content-Length', corpo.length)
    response.setHeader('Cache-Control', PARA_SEMPRE)
    response.end(request.method === 'HEAD' ? undefined : corpo)
  }
}

/**
 * Serve a pasta do site.
 *
 * - /assets: comprimido e guardado para sempre pelo navegador. Um arquivo que
 *   não existe dá 404, e não o index.html — depois de um build novo, um JS
 *   antigo receberia HTML no lugar de código.
 * - O resto (carros, vozes do motor, fontes): guardado por uma hora. Uma
 *   recarga da aba, que o celular fraco faz sempre que o sistema a mata em
 *   segundo plano, não pede nada de novo à rede.
 * - O HTML: conferido a cada visita, para um build novo chegar na hora.
 */
export function servirSite(app: Express, raiz: string) {
  const assets = resolve(raiz, 'assets')
  if (existsSync(assets)) {
    app.use('/assets', servirComprimidos(comprimirAssets(assets)))
    app.use('/assets', express.static(assets, { immutable: true, maxAge: '1y' }))
    app.use('/assets', (_request, response) => {
      response.sendStatus(404)
    })
  }
  app.use(
    express.static(raiz, {
      maxAge: '1h',
      setHeaders: (response, caminho) => {
        if (caminho.endsWith('.html')) response.setHeader('Cache-Control', 'no-cache')
      },
    }),
  )
  app.use((request, response, next) => {
    if (request.method === 'GET') {
      response.sendFile(resolve(raiz, 'index.html'), { headers: { 'Cache-Control': 'no-cache' } })
    } else next()
  })
}
