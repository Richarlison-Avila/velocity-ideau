# Plano de Desenvolvimento — Jogo de Corrida Fantasma

## 1. Visão do projeto

O projeto será um jogo de corrida para navegador inspirado em Fórmula 1, no qual dois jogadores disputam a mesma prova simultaneamente. Cada jogador controla o próprio carro e enxerga o adversário como um carro fantasma, sem colisão física entre os veículos.

O objetivo da primeira versão é oferecer partidas rápidas, com duração aproximada de 60 a 90 segundos, que funcionem tanto em computadores quanto em celulares e possam ser demonstradas em um workshop por meio de um link ou QR code.

Para evitar problemas de licenciamento, o jogo deverá utilizar nomes, equipes, carros, circuitos, logotipos e identidade visual fictícios, apresentando-se como um jogo de corrida inspirado em Fórmula 1.

## 2. Objetivo do MVP

O MVP deverá permitir que:

- Dois jogadores entrem na mesma sala.
- Um jogador compartilhe a sala por código, link ou QR code.
- Os dois recebam uma largada sincronizada com cinco luzes.
- Cada pessoa controle o próprio carro.
- Cada jogador veja o adversário como um carro fantasma.
- O jogo informe quem está à frente e a diferença entre os pilotos.
- Os dois completem uma corrida curta.
- O servidor determine o vencedor.
- Os jogadores possam iniciar uma revanche.

### Fora do escopo inicial

Os seguintes recursos não fazem parte do MVP:

- Campeonato ou modo carreira.
- Ranking global.
- Pit stop.
- Desgaste de pneus.
- Consumo de combustível.
- Clima dinâmico.
- Múltiplas pistas.
- Personalização avançada.
- Colisão entre jogadores.
- Corridas com mais de dois pilotos.

## 3. Regras da primeira versão

- A corrida terá uma pista e uma volta, ou um percurso único equivalente.
- A duração esperada será de 60 a 90 segundos.
- Vence quem cruzar a linha de chegada primeiro.
- O servidor será a fonte oficial do horário de largada e da ordem de chegada.
- O carro fantasma poderá atravessar o carro do jogador.
- Colidir com um obstáculo reduzirá temporariamente a velocidade.
- Sair da pista causará perda de velocidade, sem destruir o carro.
- Se um jogador se desconectar, terá um pequeno intervalo para retornar.
- Caso não retorne, o adversário vencerá por abandono.

## 4. Experiência do jogador

### Fluxo da partida

1. O jogador acessa a página inicial.
2. Escolhe um nome e cria uma sala.
3. O jogo gera um código, um link e um QR code.
4. O segundo jogador entra na sala.
5. Os dois confirmam que estão prontos.
6. O servidor agenda a largada para um horário futuro comum.
7. As cinco luzes são exibidas nos dois dispositivos.
8. A corrida começa simultaneamente.
9. Cada jogador vê o fantasma do adversário.
10. O servidor registra a chegada dos dois pilotos.
11. A tela de resultado mostra vencedor, tempos e diferença.
12. Os jogadores podem solicitar uma revanche.

### Controles no computador

- `A` e `D`, ou setas esquerda e direita: movimentação lateral.
- `Espaço`: ativação de boost ou recurso inspirado em DRS.
- Aceleração automática durante o MVP.

### Controles no celular

- Toque no lado esquerdo da tela: virar para a esquerda.
- Toque no lado direito da tela: virar para a direita.
- Botão dedicado: ativar boost.

A aceleração automática reduz a quantidade de controles e torna a demonstração mais acessível para participantes sem experiência com jogos.

## 5. Apresentação visual

A perspectiva recomendada é pseudo-3D, inspirada em jogos de corrida retrô. O carro permanece próximo à parte inferior da tela enquanto a pista e o cenário se deslocam, criando a sensação de velocidade.

A interface da corrida deverá apresentar:

- Posição atual: P1 ou P2.
- Progresso ou volta.
- Cronômetro.
- Velocidade.
- Diferença para o adversário.
- Estado do boost.
- Indicadores de penalidade.
- Minimap, se houver tempo de desenvolvimento.
- Indicação do adversário quando estiver fora do campo de visão.

Exemplos de mensagens:

```text
P2 — Rival 1,4 s à frente
```

```text
Adversário atrás — lado esquerdo
```

## 6. Modelo do jogo

### Estado de cada jogador

| Campo | Utilização |
| --- | --- |
| Identificador | Relacionar jogador, sala e conexão |
| Nome | Exibição na interface |
| Progresso | Distância percorrida no circuito |
| Posição lateral | Posição entre os limites da pista |
| Velocidade | Ritmo atual do carro |
| Estado | Aguardando, pronto, correndo, terminou ou abandonou |
| Penalidade | Tempo restante de redução de velocidade |
| Boost | Disponibilidade e duração do recurso |
| Última atualização | Horário da telemetria mais recente |

### Estado da pista

A pista precisará armazenar:

- Comprimento total.
- Largura em cada trecho.
- Curvas.
- Limites laterais.
- Obstáculos.
- Zonas de redução de velocidade.
- Zonas de boost ou DRS.
- Posição da largada e da chegada.

### Separação entre tela e progresso

O posicionamento visual do carro não representa diretamente seu avanço na corrida. O carro do jogador pode permanecer próximo à parte inferior da tela enquanto o progresso é armazenado como uma distância independente.

Exemplo:

- Jogador A: 300 metros, centro da pista.
- Jogador B: 320 metros, lado direito.
- Para o jogador A, o fantasma do jogador B aparece 20 metros à frente e à direita.
- Para o jogador B, o jogador A aparece atrás.

## 7. Arquitetura proposta

```text
Navegador do piloto A ─┐
                       ├── Servidor da partida
Navegador do piloto B ─┘
          │
          └── Renderização e animação local
```

### Front-end

Responsabilidades:

- Desenhar pista, cenário e carros.
- Capturar teclado e toque.
- Executar a física simplificada.
- Controlar animações e efeitos.
- Suavizar o movimento do fantasma.
- Exibir lobby, largada, HUD e resultado.

Tecnologias sugeridas:

- TypeScript.
- React para menus e telas.
- Phaser para o jogo 2D ou pseudo-3D.
- `requestAnimationFrame` para o ciclo de renderização.

O Phaser é recomendado para acelerar o desenvolvimento. Canvas puro pode ser utilizado se o objetivo do workshop também for ensinar os fundamentos da renderização.

### Back-end

Responsabilidades:

- Criar e encerrar salas.
- Associar dois jogadores à mesma partida.
- Controlar o estado da sala.
- Definir o horário oficial da largada.
- Receber telemetria.
- Repassar informações do adversário.
- Validar progresso e chegada.
- Registrar e distribuir o resultado.

Tecnologias sugeridas:

- Node.js.
- TypeScript.
- WebSocket ou Socket.IO.
- Estado em memória durante o MVP.
- Redis apenas se o projeto precisar executar em várias instâncias.

### Hospedagem

- O front-end poderá ser hospedado como site estático.
- O back-end precisará aceitar conexões WebSocket.
- Uma única instância do servidor será suficiente para o workshop.
- Deve existir um endereço HTTPS definitivo para gerar o QR code.

## 8. Comunicação em tempo real

Não será necessário transmitir cada quadro da animação. Cada navegador deverá enviar atualizações periódicas contendo apenas o estado essencial:

```text
progresso: 670 m
posição lateral: 72%
velocidade: 284 km/h
estado: correndo
horário da medição: 15:32:04.250
```

O navegador receptor deverá guardar as atualizações mais recentes e interpolar o movimento do fantasma. Isso evita saltos visuais quando os dados chegam em intervalos irregulares.

O sistema deverá tratar:

- Pacotes atrasados.
- Atualizações fora de ordem.
- Pequenas perdas de conexão.
- Movimentos impossíveis.
- Diferenças entre os relógios dos dispositivos.
- Abas temporariamente em segundo plano.

## 9. Largada sincronizada

O servidor não deverá apenas enviar uma mensagem dizendo que a corrida começou. Em vez disso, enviará um horário futuro comum.

Exemplo:

```text
A corrida começará no instante T + 5 segundos.
```

Os dois navegadores usarão esse horário para exibir as luzes e iniciar a simulação. Antes da largada, cada cliente deverá estimar a diferença entre o relógio local e o relógio do servidor.

## 10. Fases de desenvolvimento

### Fase 1 — Protótipo offline

Objetivo: comprovar que a corrida é jogável e divertida antes de adicionar a rede.

Tarefas:

- Criar uma pista básica.
- Desenhar um carro provisório.
- Implementar movimento lateral.
- Implementar velocidade e progresso.
- Adicionar limites da pista.
- Adicionar obstáculos.
- Criar linha de chegada.
- Implementar cronômetro.
- Testar teclado e toque.

Critério de conclusão: uma pessoa consegue iniciar, disputar e terminar uma corrida sem servidor.

### Fase 2 — Interface e sensação de velocidade

Tarefas:

- Criar menu inicial.
- Criar HUD.
- Implementar as cinco luzes da largada.
- Adicionar movimento das faixas e do cenário.
- Adicionar partículas e marcas de pneu.
- Criar efeitos sonoros.
- Mostrar boost e penalidades.
- Criar tela de chegada.

Critério de conclusão: o protótipo já transmite a sensação de uma corrida completa.

### Fase 3 — Lobby e salas

Tarefas:

- Criar sala com código curto.
- Permitir entrada por código.
- Gerar link compartilhável.
- Gerar QR code.
- Mostrar o estado “aguardando adversário”.
- Identificar os dois pilotos.
- Tratar sala cheia ou inexistente.
- Tratar saída antes da largada.

Critério de conclusão: dois dispositivos aparecem conectados à mesma sala.

### Fase 4 — Largada sincronizada

Tarefas:

- Sincronizar relógio entre cliente e servidor.
- Agendar a largada.
- Exibir as luzes nos dois dispositivos.
- Iniciar a corrida no instante combinado.
- Tratar atraso e perda momentânea de conexão.

Critério de conclusão: os dois jogadores recebem visualmente a mesma largada.

### Fase 5 — Fantasma do adversário

Tarefas:

- Enviar telemetria periodicamente.
- Repassar a telemetria ao adversário.
- Calcular a posição relativa do fantasma.
- Interpolar o movimento entre atualizações.
- Aplicar transparência e cor distinta.
- Mostrar adversário à frente ou atrás.
- Mostrar diferença em metros ou segundos.
- Indicar o adversário fora da tela.
- Tratar pacotes atrasados e desconexões.

Critério de conclusão: o fantasma representa o progresso real do adversário sem saltos excessivos.

### Fase 6 — Resultado e revanche

Tarefas:

- Registrar a passagem pela chegada.
- Comparar tempos no servidor.
- Enviar o mesmo resultado para os dois clientes.
- Mostrar vencedor, tempos e diferença.
- Permitir revanche na mesma sala.
- Reiniciar corretamente o estado da partida.

Critério de conclusão: os dois jogadores recebem o mesmo vencedor e conseguem jogar novamente.

### Fase 7 — Preparação para o workshop

Tarefas:

- Publicar front-end e back-end.
- Testar em computadores e celulares.
- Testar a rede que será utilizada no evento.
- Gerar o QR code definitivo.
- Preparar hotspot ou rede de reserva.
- Criar uma sala de demonstração.
- Ensaiar a apresentação completa.

Critério de conclusão: duas pessoas conseguem acessar e completar a corrida usando apenas o QR code apresentado.

## 11. Cronograma sugerido

### Semana 1 — Gameplay

- Protótipo offline.
- Movimento, velocidade e colisões.
- Primeira versão da pista.
- Compatibilidade com teclado e toque.

### Semana 2 — Apresentação visual

- HUD.
- Largada.
- Cenário e efeitos.
- Tela inicial e resultado provisório.
- Ajustes de dificuldade.

### Semana 3 — Multiplayer básico

- Servidor.
- WebSocket.
- Criação de salas.
- Entrada por link ou código.
- Sincronização da largada.

### Semana 4 — Fantasma e resultado

- Envio de telemetria.
- Interpolação.
- Indicadores de posição.
- Validação da chegada.
- Revanche e reconexão.

### Semana 5 — Qualidade e workshop

- Testes em diferentes dispositivos.
- Testes com internet instável.
- Correções.
- Publicação.
- QR code definitivo.
- Plano de contingência.
- Ensaio da apresentação.

Caso o tempo seja menor, a pista poderá começar como um percurso reto com mudanças de faixa e obstáculos. Curvas visuais mais elaboradas poderão ser adicionadas posteriormente.

## 12. Estratégia de testes

### Jogabilidade

- O carro não fica preso fora da pista.
- Obstáculos não aplicam várias colisões simultaneamente.
- As penalidades possuem duração previsível.
- É possível terminar a corrida no computador e no celular.
- A dificuldade permite que um iniciante complete a prova.
- O boost não decide sozinho o resultado da partida.

### Multiplayer

- Os jogadores entram na sala correta.
- Os dois recebem o mesmo horário de largada.
- O fantasma não interfere fisicamente no jogador.
- A diferença de progresso corresponde às posições exibidas.
- Pacotes atrasados não fazem o fantasma voltar abruptamente.
- Uma reconexão curta não cria um terceiro jogador.
- O vencedor é idêntico nas duas telas.

### Compatibilidade

Testar pelo menos:

- Chrome no computador.
- Chrome no Android.
- Safari no iPhone, se fizer parte da demonstração.
- Tela pequena em orientação vertical.
- Tela em orientação horizontal.
- Wi-Fi que será utilizado no workshop.
- Hotspot de contingência.

## 13. Riscos e mitigação

| Risco | Mitigação |
| --- | --- |
| Atraso de rede | Interpolação e largada agendada |
| Wi-Fi ruim no evento | Rede local ou hotspot de reserva |
| Escopo grande demais | Congelar o MVP antes de criar novas mecânicas |
| Jogo difícil no celular | Aceleração automática e controles grandes |
| Resultado divergente | Servidor como autoridade da chegada |
| Fantasma com movimentos bruscos | Buffer curto e interpolação |
| Uso excessivo de bateria | Limitar partículas e objetos simultâneos |
| Problemas de marca | Utilizar equipes e identidade fictícias |
| Pouco tempo de desenvolvimento | Começar com pista reta e arte provisória |

## 14. Divisão de trabalho

Caso exista uma equipe, a divisão sugerida é:

- **Gameplay:** física, pista, colisões e controles.
- **Interface:** menus, HUD, lobby e resultado.
- **Multiplayer:** salas, WebSocket, sincronização e servidor.
- **Arte e áudio:** carros, pista, efeitos visuais e sons.
- **Qualidade e operação:** testes, publicação e preparação do workshop.

Se o desenvolvimento for realizado por uma pessoa, a ordem recomendada é:

1. Gameplay.
2. Multiplayer.
3. Interface.
4. Arte e áudio.
5. Refinamento e testes.

## 15. Backlog priorizado

### Prioridade obrigatória

- Corrida offline funcional.
- Controles por teclado e toque.
- Salas para dois jogadores.
- Largada sincronizada.
- Telemetria do adversário.
- Carro fantasma.
- Linha de chegada validada pelo servidor.
- Resultado idêntico nas duas telas.
- Publicação acessível por HTTPS.

### Prioridade importante

- QR code.
- Reconexão curta.
- Indicador de rival fora da tela.
- Diferença em segundos.
- Revanche.
- Efeitos sonoros e visuais.

### Prioridade opcional

- Minimap.
- Escolha de carro.
- Diferentes cores de equipe.
- Modo de treino individual.
- Melhor tempo local.
- Replay simplificado.

## 16. Critérios finais de sucesso

O MVP será considerado pronto quando:

- Duas pessoas acessarem o jogo em dispositivos diferentes.
- Entrarem na mesma sala usando código, link ou QR code.
- Receberem a mesma largada.
- Completarem uma corrida curta.
- Enxergarem o adversário como fantasma.
- Receberem o mesmo vencedor e os mesmos tempos.
- Conseguirem iniciar uma revanche sem recarregar a página.
- A demonstração funcionar na rede preparada para o workshop.

## 17. Roteiro da demonstração

1. Apresentar rapidamente o conceito do carro fantasma.
2. Criar uma sala no primeiro dispositivo.
3. Ler o QR code no segundo dispositivo.
4. Mostrar os dois jogadores no lobby.
5. Iniciar a sequência das cinco luzes.
6. Disputar a corrida e mostrar o fantasma nas duas telas.
7. Demonstrar uma ultrapassagem ou mudança de liderança.
8. Exibir o resultado sincronizado.
9. Explicar como interface, animação, lógica, rede e servidor trabalham juntos.

Esse roteiro oferece uma demonstração curta, visual e fácil de compreender, sem depender de sistemas complexos que não contribuem diretamente para o objetivo do workshop.
