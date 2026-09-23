// Sem await no topo: gerenciadores de hospedagem também carregam via require().
process.env.PORT ||= '3000'
import('tsx/esm/api')
  .then(({ tsImport }) => tsImport('./server/index.ts', import.meta.url))
  .catch((error) => {
    console.error('Falha ao iniciar o servidor:', error)
    process.exit(1)
  })
