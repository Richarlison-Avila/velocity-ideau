# Prompt adaptado — Graph Engineering para sensação de velocidade

Você está trabalhando no projeto **Corrida Fantasma**, um jogo de corrida pseudo-3D para navegador, feito com React, TypeScript, Vite e Canvas 2D. O jogo possui modo treino e partidas online para dois pilotos, com largada sincronizada, telemetria, carro fantasma e resultado oficial calculado pelo servidor.

Sua tarefa é **analisar, planejar, implementar e validar** melhorias no sistema de movimentação e, principalmente, na sensação de velocidade. Use uma abordagem de **Graph Engineering**: trate simulação, projeção da pista, renderização, feedback visual, partículas, controles, HUD, fantasma e validações do servidor como partes conectadas de um mesmo sistema.

Não aplique soluções próprias de engines 3D sem antes verificar se elas fazem sentido nesta arquitetura. Este projeto não possui, atualmente, rigid bodies, suspensão física, câmera 3D, FOV real ou modelos de rodas animadas. Quando um efeito equivalente for desejável, traduza-o para os recursos existentes do Canvas 2D e da projeção pseudo-3D.

## 1. Contexto e restrições do projeto

Antes de propor mudanças, leia pelo menos:

- `README.md`
- `PLANO_DESENVOLVIMENTO.md`
- `src/game/simulation.ts`
- `src/game/simulation.test.ts`
- `src/game/track.ts`
- `src/game/track.test.ts`
- `src/game/RaceCanvas.tsx`
- `src/game/particles.ts`
- `src/game/particles.test.ts`
- `src/game/ghost.ts`
- `src/game/ghost.test.ts`
- `src/App.tsx`
- `server/rooms.ts`
- testes de servidor relacionados a telemetria, chegada e demonstração
- `scripts/piloto-virtual.ts`

Considere como invariantes, salvo se houver justificativa explícita e testes atualizados:

- A aceleração é automática; o jogador controla apenas direção e boost.
- Não introduza freio ou novos controles sem demonstrar que isso é necessário e compatível com o MVP.
- O carro do jogador permanece próximo à base da tela; o avanço real é armazenado em `progress`.
- O fantasma é apenas visual e nunca interfere na simulação local.
- A corrida deve continuar adequada a computador e celular.
- Um iniciante em linha reta deve concluir a prova na faixa de duração definida pelo projeto, atualmente entre 60 e 90 segundos.
- A simulação deve permanecer estável em diferentes taxas de quadros.
- A largada sincronizada, o relógio oficial, a telemetria e a decisão do vencedor não podem regredir.
- O servidor deve continuar rejeitando avanços e tempos fisicamente impossíveis.
- O limite de partículas e o custo de renderização devem continuar apropriados para aparelhos móveis modestos.
- O projeto deve continuar funcionando sem depender de assets ou serviços externos durante a demonstração.

Se velocidades, comprimento da pista ou regras de progressão forem alterados, rastreie e atualize, quando necessário, todas as dependências correspondentes: validação do servidor, tempo mínimo plausível, telemetria, piloto virtual, testes, HUD e documentação. Não deixe constantes semanticamente equivalentes divergirem entre cliente, servidor, scripts e testes.

## 2. Grafo funcional a ser investigado

Mapeie as dependências reais do projeto. Comece pelo grafo abaixo, mas confirme cada aresta no código e corrija o modelo quando necessário:

```text
Entrada do jogador (direção/boost)
              ↓
stepRace + estado da corrida
              ↓
velocidade / aceleração / lateral / offRoad / penalidade / boost
       ├───────────────┬────────────────┬─────────────────┐
       ↓               ↓                ↓                 ↓
progresso         telemetria       feedback visual       HUD
       ↓               ↓                ↓
pista/curvas      servidor → rival      ├─ projeção pseudo-3D
obstáculos        → GhostTracker        ├─ movimento aparente da pista
chegada                 ↓               ├─ posição/escala do carro
                  carro fantasma        ├─ partículas e rastros
                                       ├─ deslocamento do cenário
                                       └─ equivalentes 2D de câmera
```

Investigue especialmente:

- Quem é a fonte de verdade para velocidade, progresso e estado da corrida.
- Como `speedForState`, a suavização em `stepRace` e o passo máximo de simulação produzem aceleração e desaceleração.
- Como velocidade e progresso alimentam `roadProjection`, `trackCurve`, faixas da pista, obstáculos, partículas, carro local e fantasma.
- Quais constantes visuais ou físicas estão espalhadas, duplicadas ou implicitamente acopladas.
- Quais efeitos reagem apenas a estados binários (`boosting`, `offRoad`, `penalty`) e quais poderiam usar intensidades contínuas.
- Onde alterações visuais poderiam acidentalmente alterar regras de corrida, telemetria ou validação do servidor.
- Quais atualizações acontecem a cada frame e quais provocam renderizações React; preserve a separação entre o loop do Canvas e o HUD com frequência limitada.
- Como resize, `devicePixelRatio`, orientação do celular, perda de foco e retorno de aba afetam a experiência.
- Possíveis alocações, gradientes, arrays, ordenações ou cálculos repetidos no loop de animação que possam afetar dispositivos modestos.

Entregue primeiro um mapa textual do grafo contendo, para cada nó relevante: arquivo, símbolos responsáveis, entradas, saídas, consumidores e riscos de alteração.

## 3. Diagnóstico antes da implementação

Antes de modificar código:

1. Execute a suíte existente e registre a linha de base.
2. Inspecione o jogo em execução nos tamanhos de tela desktop e mobile, se o ambiente permitir.
3. Descreva, com evidências do código ou da execução, por que a velocidade parece ou não parece convincente.
4. Diferencie problemas de **simulação** de problemas apenas de **percepção visual**.
5. Identifique os menores pontos de intervenção capazes de produzir o maior ganho perceptivo.

Não presuma que aumentar a velocidade máxima melhora a experiência. Priorize legibilidade de movimento, progressão perceptível e resposta coerente.

Classifique os achados por impacto, risco e custo. Não implemente mudanças significativas antes de apresentar um plano curto com arquivos afetados, dependências, riscos e forma de validação.

## 4. Direção de melhoria por sistema

### 4.1 Simulação e resposta

Revise a curva de aproximação à velocidade-alvo, arrancada, recuperação após impacto ou saída de pista, transição para boost e retorno à velocidade normal.

A progressão deve comunicar claramente:

```text
largada → ganho de velocidade → ritmo normal → boost → recuperação
```

Evite degraus perceptíveis entre velocidades-alvo. Se adicionar valores derivados, prefira grandezas com significado claro, por exemplo:

- `normalizedSpeed`
- aceleração longitudinal suavizada
- intensidade de direção
- intensidade de boost
- intensidade de impacto ou penalidade
- estado fora da pista

Não crie uma camada central nova se o `RaceState` ou um pequeno estado derivado de renderização já resolver o problema. Não replique a fonte de verdade da simulação.

### 4.2 Direção e sensação de peso no pseudo-3D

O projeto não simula suspensão física. Represente peso por sinais visuais sutis e coerentes, quando úteis:

- inclinação lateral do desenho do carro durante mudanças de direção;
- pequeno deslocamento ou escala durante aceleração, boost e impacto;
- atraso visual controlado entre entrada lateral e resposta de apresentação, sem atrasar a simulação competitiva;
- recentralização suave do feedback visual;
- marcas de pneu ou partículas proporcionais à intensidade da manobra, e não apenas à posição lateral absoluta.

Não altere a posição competitiva ou a resposta do controle apenas para produzir animação. Separe estado físico de estado visual derivado sempre que isso preservar a jogabilidade.

### 4.3 Câmera e equivalente de FOV

Não existe câmera 3D ou FOV real. Avalie equivalentes compatíveis com `roadProjection`:

- horizonte;
- largura aparente da pista;
- potência da perspectiva;
- distância visível;
- posição vertical e escala do carro;
- deslocamento lateral ou inclinação global sutil;
- look-ahead baseado na curva da pista e na direção;
- shake transitório em impacto e vibração mínima em alta velocidade.

Qualquer variação deve ser suave, limitada e baseada em intensidade contínua. Evite alterar a geometria competitiva, a detecção de colisões ou a posição real do carro. Não use tremor constante nem amplitudes que prejudiquem leitura, acessibilidade ou controles por toque.

Se uma ampliação dinâmica da perspectiva for implementada como equivalente de FOV, mantenha a projeção de pista, obstáculos, partículas, linha de chegada e fantasma no mesmo sistema de coordenadas. Nenhum elemento pode “descolar” da pista.

### 4.4 Cenário e referências de deslocamento

O cenário atual deve ser avaliado como parte central da percepção de velocidade. Considere adicionar ou refinar referências próximas às laterais da pista, como postes, placas, vegetação, barreiras, marcadores de distância ou elementos repetidos.

Esses elementos devem:

- ser posicionados por distância absoluta na pista;
- usar a mesma projeção e ordenação de profundidade dos demais elementos;
- passar mais rapidamente nas bordas sem criar inconsistência espacial;
- ser determinísticos quando necessário e evitar “piscar” entre frames;
- respeitar orçamento de desenho e legibilidade em telas pequenas;
- não esconder obstáculos, fantasma, HUD ou limites da pista.

Não redesenhe destrutivamente a pista nem dependa de imagens externas sem necessidade.

### 4.5 Partículas e feedback de estado

Reaproveite `ParticleField` e `EmissionRate` quando forem adequados. Revise poeira, faíscas, rastro de boost e marcas de pneu para que intensidade, tamanho, vida e cadência respondam de forma coerente à velocidade e ao evento que os originou.

Prefira transições contínuas a regras do tipo `speed > X`. Preserve o teto de partículas ou justifique qualquer mudança com medição de desempenho.

Motion blur genérico, filtros caros sobre o Canvas e speed lines intensas não são requisitos. Só os use se forem compatíveis com a identidade visual, trouxerem ganho claro e tiverem fallback ou intensidade segura para mobile. Prefira referências espaciais, contraste, cadência da pista e efeitos locais de baixo custo.

### 4.6 Carro, rodas e animação

O carro atual é desenhado vetorialmente no Canvas e não possui rodas independentes em perspectiva. Não implemente “rotação física das rodas” apenas para cumprir uma lista genérica.

Avalie melhorias que sejam perceptíveis nesta vista, como:

- esterçamento ou deslocamento visual sutil dos pneus;
- inclinação da carroceria;
- compressão visual estilizada em arrancada, boost e impacto;
- sombra reativa;
- vibração curta e amortecida após colisões;
- rastro alinhado corretamente atrás das rodas.

Toda animação deve usar o mesmo referencial espacial do carro e continuar legível em telas pequenas.

### 4.7 Áudio e HUD

O áudio atual é procedural e concentrado na largada e em impactos. Áudio contínuo de motor ou vento é opcional, não obrigatório. Se proposto, considere políticas de autoplay, retomada do `AudioContext`, consumo de bateria, limpeza de recursos e opção de reduzir movimento/som.

O velocímetro não deve ser o único indicador de intensidade. Ao mesmo tempo, alterações visuais não podem reduzir a legibilidade do cronômetro, posição, rival, progresso, avisos e boost.

## 5. Implementação incremental

Depois que o plano estiver claro, implemente em lotes pequenos e verificáveis. Ordem preferencial, ajustável conforme o diagnóstico:

1. Extrair ou organizar parâmetros realmente compartilhados, sem criar abstrações prematuras.
2. Refinar curvas da simulação apenas se o diagnóstico demonstrar necessidade.
3. Criar intensidades derivadas e suavizadas para apresentação.
4. Melhorar projeção/câmera pseudo-3D mantendo um único sistema de coordenadas.
5. Refinar animação do carro e feedback de direção, boost e impacto.
6. Melhorar cenário lateral e partículas.
7. Polir HUD ou áudio apenas onde contribuírem diretamente.
8. Fazer uma passagem final de desempenho, acessibilidade e responsividade.

Após cada lote:

- execute os testes relacionados;
- verifique o grafo de dependências afetado;
- compare o comportamento com a linha de base;
- reverta complexidade que não produza ganho perceptível;
- não misture refatorações não relacionadas.

## 6. Critérios de aceite

A solução final deve demonstrar, sem depender apenas do número no HUD, diferenças claras entre:

- largada e baixa velocidade;
- aproximação ao ritmo normal;
- ritmo normal estabilizado;
- boost;
- desaceleração por saída de pista ou colisão;
- recuperação para o ritmo normal.

Valide obrigatoriamente:

- transições sem saltos visuais bruscos;
- controle lateral responsivo e previsível;
- ausência de desalinhamento entre pista, obstáculos, partículas, linha de chegada, carro e fantasma;
- ausência de interferência do fantasma na física local;
- consistência entre 60, 30 e 20 FPS nos testes de simulação;
- comportamento correto após resize, mudança de orientação, perda de foco e retorno à aba;
- legibilidade em desktop e celular, em orientação vertical e horizontal;
- duração da corrida dentro do objetivo do projeto;
- boost, saída de pista, colisões, chegada, telemetria, reconexão e revanche sem regressões;
- limites e validações de velocidade/progresso do servidor coerentes com a simulação;
- ausência de crescimento ilimitado de partículas, timers, listeners ou recursos de áudio;
- build e suíte completa aprovadas.

Use como comandos mínimos de validação:

```bash
npm test
npm run build
npx vitest run server/demonstracao.test.ts
```

Quando possível, registre também observações visuais comparáveis nos mesmos pontos da pista e tamanhos de viewport.

## 7. Regras de implementação

- Respeite a arquitetura atual e prefira mudanças localizadas.
- Não reescreva sistemas que já funcionam corretamente.
- Não crie uma segunda simulação para alimentar efeitos.
- Não acople o resultado competitivo a animações ou efeitos visuais.
- Não espalhe números mágicos; agrupe apenas parâmetros que tenham responsabilidade comum.
- Não transforme todos os estados em React state nem atualize o React a cada frame.
- Não use condições binárias quando uma intensidade contínua produzir transição melhor, mas preserve estados discretos que representam regras reais do jogo.
- Não aumente artificialmente a velocidade máxima como solução principal.
- Não adicione dependências pesadas ou assets remotos sem necessidade comprovada.
- Não sacrifique desempenho mobile, legibilidade, acessibilidade ou estabilidade do multiplayer por efeitos cosméticos.
- Preserve comentários úteis e adicione testes para toda lógica extraída ou comportamento mensurável novo.
- Se uma ideia exigir mudança de produto — novos controles, regras, física competitiva ou protocolo de rede — apresente-a separadamente e não a implemente sem autorização explícita.

## 8. Formato da entrega

Ao concluir, apresente:

1. **Mapa do grafo atual** — nós, arestas, arquivos e riscos.
2. **Diagnóstico priorizado** — evidências, impacto, risco e custo.
3. **Plano executado** — mudanças por lote e justificativa.
4. **Arquivos alterados** — responsabilidade de cada alteração.
5. **Antes vs. depois** — comparação objetiva da simulação e da percepção visual.
6. **Validação** — comandos executados, resultados e verificações visuais.
7. **Desempenho e compatibilidade** — desktop/mobile, FPS, resize e orientação.
8. **Pendências ou decisões de produto** — itens que não deveriam ser assumidos tecnicamente.

O objetivo não é apenas deixar o código diferente ou acumular efeitos. O resultado deve fazer com que simulação, projeção pseudo-3D, carro, pista, cenário, partículas, HUD e multiplayer trabalhem juntos para transmitir uma condução mais fluida, clara, responsiva e profissional, sem comprometer a simplicidade e a confiabilidade do MVP.
