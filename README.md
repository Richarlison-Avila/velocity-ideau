# Corrida Fantasma

Primeiro incremento jogável do plano em `PLANO_DESENVOLVIMENTO.md`: um protótipo offline de corrida pseudo-3D para navegador.

## Executar

```bash
npm install
npm run dev
```

Abra o endereço exibido pelo Vite. O servidor de desenvolvimento aceita conexões da rede local para facilitar testes no celular.

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
- [ ] Salas para dois jogadores
- [ ] Largada sincronizada pelo servidor
- [ ] Telemetria e carro fantasma
- [ ] Resultado validado pelo servidor e revanche
