# Corrida Fantasma

Protótipo jogável do plano em `PLANO_DESENVOLVIMENTO.md`, agora com corrida offline e lobby multiplayer em tempo real.

## Executar

```bash
npm install
npm run dev
```

O comando inicia o site e o servidor Socket.IO. Abra o endereço do Vite; ele aceita conexões da rede local para facilitar testes no celular.

## Controles

- `A` / `D` ou setas: direção
- `Espaço`: boost
- Celular: botões de direção e boost na tela

## Estado atual

- [x] Fluxo menu → largada → corrida → resultado → nova tentativa
- [x] Pista pseudo-3D e aceleração automática
- [x] Controles por teclado e toque
- [x] Limites da pista, obstáculos e penalidades
- [x] Boost com consumo e recarga
- [x] Cronômetro, velocidade e progresso
- [x] Cinco luzes de largada e áudio procedural básico
- [x] Salas para dois jogadores com código, link e QR code
- [x] Lobby em tempo real, confirmação e tratamento de sala cheia/inexistente
- [ ] Largada sincronizada pelo servidor
- [ ] Telemetria e carro fantasma
- [ ] Resultado validado pelo servidor e revanche
