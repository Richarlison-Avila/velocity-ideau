import { tsImport } from 'tsx/esm/api'

// Entrada JavaScript para hospedagens que iniciam diretamente com node server.js.
process.env.PORT ??= '3000'
await tsImport('./server/index.ts', import.meta.url)
