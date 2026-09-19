# Prompt — Curvas, cenário, sensação de velocidade e carro

Trabalhe no projeto **Corrida Fantasma**, um jogo de corrida pseudo-3D para navegador desenvolvido com React, TypeScript e Canvas 2D. Implemente os três grupos de melhorias abaixo usando uma abordagem integrada: pista, cenário, simulação, renderização, multiplayer e animações precisam continuar coerentes entre si.

Antes de alterar código, leia a implementação atual, especialmente:

- `src/game/track.ts`
- `src/game/RaceCanvas.tsx`
- `src/game/simulation.ts`
- `src/game/particles.ts`
- `src/game/ghost.ts`
- `src/multiplayer/types.ts`
- `server/rooms.ts`
- `server/app.ts`
- `scripts/piloto-virtual.ts`
- testes relacionados a pista, simulação, partículas, fantasma, salas e demonstração

Primeiro faça um diagnóstico curto da implementação atual e apresente um plano com os arquivos que serão afetados. Depois implemente em etapas pequenas e valide cada etapa. Não reescreva sistemas estáveis sem necessidade e não altere regras do multiplayer silenciosamente.

## 1. Curvas, vegetação e cenário determinístico

Melhore a pista para que ela tenha curvas visualmente mais interessantes e naturais durante o percurso.

### Curvas da estrada

- Crie uma sequência variada de retas, curvas leves e curvas moderadas.
- Não permita curvas fechadas equivalentes a 90 graus ou mais, mudanças instantâneas de direção ou transições que produzam quinas.
- Como o jogo usa projeção pseudo-3D, não trate esse limite apenas como um ângulo literal de uma malha 3D. Defina e documente limites adequados para curvatura, variação de curvatura e mudança de direção ao longo da distância.
- Use transições suaves de entrada, ápice e saída da curva.
- Evite sequências impossíveis de antecipar ou que prejudiquem a leitura de obstáculos.
- A estrada, suas bordas, faixas, obstáculos, linha de chegada, partículas, carro local e fantasma devem continuar usando o mesmo referencial de projeção.
- O desenho da curva não deve alterar sozinho a posição lateral competitiva do jogador nem causar colisões invisíveis.

### Cenário lateral

Adicione variedade visual ao longo da estrada, incluindo, quando adequado:

- árvores com pequenas variações de forma, tamanho e tonalidade;
- pasto e vegetação baixa;
- arbustos, cercas, postes, placas ou marcadores de distância;
- pequenas variações de terreno, silhuetas e agrupamentos naturais;
- trechos mais abertos e trechos mais densos.

Os objetos devem ser posicionados em coordenadas da pista e projetados com profundidade. Eles precisam aumentar de escala e se deslocar de modo coerente ao se aproximarem do jogador. Respeite a ordem de profundidade e impeça que o cenário esconda a pista, os obstáculos, o fantasma ou elementos importantes do HUD.

Não espalhe objetos de forma uniformemente aleatória. Use regras de composição para evitar repetição perceptível:

- varie espaçamento, agrupamento, lado da pista, escala e categoria;
- evite o mesmo padrão ou a mesma sequência em trechos próximos;
- imponha distância mínima entre objetos quando necessário;
- use conjuntos de variações visuais reutilizáveis, sem criar uma nova alocação pesada a cada frame;
- mantenha áreas de respiro para que o cenário não fique excessivamente carregado.

### Sincronização entre os jogadores

O cenário e a geometria da pista podem parecer aleatórios, mas devem ser **determinísticos e idênticos para os dois jogadores da mesma corrida**.

- Não use `Math.random()` diretamente para gerar pista ou cenário em cada cliente.
- Use um gerador pseudoaleatório determinístico alimentado por uma `trackSeed`.
- Se a pista variar entre corridas, a seed deve ser criada e mantida pelo servidor como parte do estado oficial da sala/corrida e enviada aos dois clientes antes da largada.
- Reconexões devem recuperar a mesma seed da corrida em andamento.
- Uma revanche pode receber uma nova seed, desde que os dois jogadores recebam exatamente o mesmo valor.
- A geração precisa depender apenas da seed e de índices ou distâncias estáveis, nunca da taxa de quadros, horário local ou ordem variável de renderização.
- Os dois jogadores devem receber a mesma pista e o mesmo cenário; cada um os verá naturalmente a partir do próprio progresso na corrida.
- Se a aleatoriedade for apenas visual e não afetar jogabilidade, mantenha essa separação explícita. Se afetar curvas ou obstáculos, trate a seed e o layout como estado competitivo oficial.

Crie testes que provem que:

- a mesma seed produz exatamente o mesmo layout;
- seeds diferentes produzem variação real;
- nenhum trecho excede os limites definidos de curvatura;
- a geração não cria transições descontínuas;
- reconexão e revanche preservam a seed esperada;
- cliente, servidor e piloto virtual continuam compatíveis com o protocolo.

## 2. Arrancada, ganho e perda de velocidade

A aceleração atual se aproxima muito rapidamente da velocidade normal, fazendo o carro parecer começar a corrida já perto de 200 km/h. Refaça a progressão para que o jogador perceba claramente as etapas:

```text
parado → arrancada → aceleração progressiva → velocidade de cruzeiro → boost
```

Não resolva o problema apenas diminuindo a velocidade máxima. Trabalhe a curva de aceleração e o feedback visual em conjunto.

### Aceleração

- Meça e registre quanto tempo o carro leva atualmente para alcançar marcos relevantes de velocidade.
- Defina uma curva de aceleração perceptível, com arrancada forte mas não instantânea e ganho progressivo até a velocidade normal.
- Evite tanto uma interpolação linear artificial quanto uma aproximação exponencial tão agressiva que esconda a progressão.
- A entrada e a saída do boost devem ser perceptíveis, suaves e coerentes com a velocidade real.
- Preserve a proposta de aceleração automática e não adicione acelerador ou câmbio sem autorização explícita.

### Perda de velocidade

- A colisão com obstáculos deve causar uma queda de velocidade clara, imediata e proporcional, seguida por recuperação compreensível.
- Sair da pista deve produzir desaceleração contínua e perceptível enquanto o carro permanecer fora do asfalto.
- Movimentos laterais agressivos, mudanças rápidas de direção ou zigue-zague sustentado devem provocar perda controlada de velocidade ou aderência.
- Não penalize correções leves necessárias para acompanhar uma curva normal.
- Baseie a penalidade de direção na intensidade e na variação do comando ao longo do tempo, ou em uma aproximação de esforço lateral, em vez de apenas verificar a posição lateral absoluta.
- Evite empilhar penalidades de forma que o carro fique travado, frustrante ou incapaz de retornar à pista.

Centralize ou derive grandezas úteis, se a arquitetura se beneficiar delas, por exemplo:

- velocidade normalizada;
- aceleração longitudinal;
- intensidade de direção;
- taxa de mudança da direção;
- intensidade de impacto;
- intensidade da condição fora de pista;
- intensidade de boost.

Esses valores devem vir da simulação ou ser derivados dela. Não crie uma segunda fonte de verdade apenas para os efeitos visuais.

### Restrições competitivas

Qualquer mudança na física deve permanecer determinística e independente da taxa de quadros. Preserve ou atualize conscientemente:

- duração-alvo da corrida;
- velocidade máxima e tempo mínimo plausível usados pelo servidor;
- validação de progresso e chegada;
- telemetria e interpolação do fantasma;
- piloto virtual;
- testes que comparam 60, 30 e 20 FPS;
- equilíbrio do boost;
- regras de colisão e saída da pista.

Adicione testes objetivos para tempos de aceleração, intensidade de desaceleração, recuperação após impacto, perda por saída de pista, zigue-zague e consistência entre taxas de quadros. Os valores exatos devem ser definidos após medir a linha de base, não escolhidos arbitrariamente.

## 3. Modelo e animações do carro

Melhore o carro desenhado no Canvas para que tenha aparência mais trabalhada e profissional, mantendo a identidade fictícia do projeto e boa leitura em telas pequenas.

### Modelo visual

Refine a silhueta e os detalhes do carro, considerando:

- proporções mais convincentes para a perspectiva atual;
- carroceria com volumes e recortes mais bem definidos;
- pneus e rodas visualmente separados;
- asas dianteira e traseira mais detalhadas;
- cockpit, halo, entradas de ar e elementos aerodinâmicos simplificados;
- luz, sombra e pequenos realces para dar volume;
- identidade de cor consistente com o jogador e com o fantasma;
- sombra de contato coerente com a posição do carro.

Prefira desenho vetorial no próprio Canvas ou assets locais leves. Não use marcas, equipes ou carros licenciados. Não adicione dependências pesadas ou assets remotos.

O carro fantasma deve compartilhar uma silhueta e animações coerentes, mas continuar imediatamente distinguível por cor e transparência. A melhoria visual não pode prejudicar a leitura da distância ou da posição lateral do rival.

### Animações

Adicione animações sutis guiadas pelo estado real ou por valores derivados da simulação:

- leve compressão ou deslocamento na arrancada;
- resposta adicional durante boost;
- inclinação da carroceria ao esterçar;
- esterçamento visual das rodas dianteiras, se legível nesta escala;
- retorno amortecido ao centro;
- reação curta e amortecida a impactos;
- vibração ou instabilidade controlada fora da pista;
- coerência entre rodas, rastros, poeira, faíscas e posição do carro.

As animações devem alterar apenas a apresentação. Não atrase os controles, não desloque a hitbox e não modifique a posição competitiva para criar efeitos cosméticos.

Evite tremor constante, deformações exageradas ou animações que façam o carro parecer flutuar. Respeite `prefers-reduced-motion` quando forem adicionados movimentos intensos ou repetitivos.

## 4. Integração da sensação de velocidade

Faça os três sistemas trabalharem juntos. Use a velocidade e a aceleração reais para controlar suavemente, quando apropriado:

- força aparente da perspectiva;
- movimento das marcações da pista e do cenário lateral;
- resposta visual do carro;
- intensidade de partículas e rastros;
- feedback de boost, impacto e saída de pista;
- equivalentes 2D de câmera, como deslocamento, look-ahead ou shake transitório.

Evite efeitos binários do tipo `speed > X` quando uma curva contínua produzir transição melhor. Não use motion blur caro ou speed lines excessivas como substitutos para uma boa projeção, referências laterais e animação coerente.

## 5. Ordem de implementação

Implemente e valide em lotes:

1. Linha de base, diagnóstico e mapa de dependências.
2. Geração determinística da pista/cenário e contrato da seed.
3. Curvas e cenário projetados no Canvas.
4. Curvas de aceleração, colisão, saída de pista e esforço lateral.
5. Valores derivados para feedback visual.
6. Novo desenho e animações do carro e do fantasma.
7. Integração visual, responsividade, acessibilidade e desempenho.
8. Testes completos e comparação antes/depois.

Após cada lote, execute os testes relacionados. Não acumule todas as mudanças antes de validar.

## 6. Critérios de aceite

A implementação só estará concluída quando:

- a pista possuir retas e curvas suaves variadas, sem quinas ou curvas equivalentes a 90 graus ou mais;
- cenário lateral variado aparecer ao longo de toda a corrida sem padrão repetitivo evidente;
- os dois jogadores da mesma sala receberem exatamente a mesma seed e o mesmo layout;
- reconexão e revanche tratarem a seed corretamente;
- pista, cenário, obstáculos, partículas, linha de chegada e fantasma permanecerem alinhados;
- a arrancada partir visual e numericamente de baixa velocidade e demonstrar ganho progressivo claro;
- colisões, saída de pista e zigue-zague produzirem perdas de velocidade perceptíveis e equilibradas;
- o boost continuar útil sem decidir sozinho a corrida;
- o carro possuir silhueta, detalhes e animações visivelmente mais profissionais;
- o fantasma continuar legível e não interferir na física;
- a corrida continuar jogável em desktop e celular, nas orientações vertical e horizontal;
- não houver regressões em largada, telemetria, chegada, resultado, reconexão e revanche;
- a simulação continuar consistente em 60, 30 e 20 FPS;
- não houver crescimento ilimitado de objetos, partículas, listeners, timers ou alocações no loop;
- a duração da corrida e as validações do servidor permanecerem coerentes com a nova física;
- a suíte completa e o build forem aprovados.

Execute no mínimo:

```bash
npm test
npm run build
npx vitest run server/demonstracao.test.ts
```

Também faça uma verificação visual comparável em desktop e mobile, observando largada, velocidade normal, boost, curva, colisão, saída de pista, fantasma, chegada e revanche.

## 7. Formato da entrega

Ao final, apresente:

1. diagnóstico da implementação anterior;
2. mapa das dependências afetadas;
3. estratégia de seed e sincronização entre jogadores;
4. mudanças realizadas por arquivo;
5. métricas antes/depois da aceleração e das perdas de velocidade;
6. comparação visual antes/depois;
7. testes executados e resultados;
8. impacto de desempenho em desktop e mobile;
9. limitações ou decisões de produto que ainda precisem de aprovação.

O objetivo é produzir uma pista mais viva e variada, uma progressão de velocidade realmente perceptível e um carro visualmente mais profissional, mantendo a simplicidade, a estabilidade e a justiça competitiva do Corrida Fantasma.
