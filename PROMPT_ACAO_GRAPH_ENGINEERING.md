# Ação de Graph Engineering — Evolução da experiência de corrida

Execute uma ação de **Graph Engineering** no projeto **Corrida Fantasma** para evoluir três resultados conectados:

1. pista com curvas suaves e cenário procedural variado, idêntico para os dois jogadores;
2. arrancada, ganho e perda de velocidade mais perceptíveis e coerentes;
3. carro e animações mais trabalhados e profissionais.

Não trate esses itens como tarefas independentes. Modele primeiro o sistema como um grafo, identifique contratos e invariantes, calcule o impacto de cada alteração e implemente na ordem das dependências.

O projeto usa React, TypeScript, Canvas 2D e projeção pseudo-3D. Não presuma a existência de câmera 3D, FOV real, rigid bodies, suspensão física ou modelos 3D. Traduza esses conceitos para a arquitetura existente quando forem realmente úteis.

## Objetivo da ação

Transformar o fluxo atual:

```text
entrada → simulação → progresso → projeção → pista/carro/efeitos → percepção
                         └──────→ telemetria → servidor → fantasma
```

em um sistema no qual geometria, física, apresentação e multiplayer compartilhem contratos explícitos, permaneçam sincronizados e produzam uma sensação de corrida mais convincente.

## Regra principal

Antes de modificar qualquer arquivo, produza o **grafo atual** e o **grafo proposto**. Não implemente enquanto não estiver claro:

- qual nó é fonte de verdade;
- quais nós apenas derivam ou apresentam dados;
- quais arestas mudam;
- quais invariantes precisam permanecer verdadeiros;
- quais testes comprovam cada contrato.

## 1. Descoberta do grafo atual

Leia, no mínimo:

- `README.md`
- `PLANO_DESENVOLVIMENTO.md`
- `src/game/track.ts`
- `src/game/RaceCanvas.tsx`
- `src/game/simulation.ts`
- `src/game/particles.ts`
- `src/game/ghost.ts`
- `src/multiplayer/types.ts`
- `src/App.tsx`
- `server/rooms.ts`
- `server/app.ts`
- `scripts/piloto-virtual.ts`
- testes associados a esses módulos

Mapeie cada nó usando o formato:

```text
[ID] Nome do nó
Responsabilidade:
Fonte de verdade ou derivado:
Entradas:
Saídas:
Consumidores:
Invariantes:
Riscos de alteração:
Testes que o protegem:
```

O grafo deve conter pelo menos estes nós, corrigidos ou subdivididos conforme o código real:

```text
[N1] Estado oficial da corrida e seed no servidor
[N2] Gerador determinístico do layout da pista
[N3] Função de curvatura e projeção pseudo-3D
[N4] Gerador determinístico do cenário lateral
[N5] Simulação local do veículo
[N6] Estado derivado de feedback de velocidade
[N7] Renderização da pista, cenário e obstáculos
[N8] Modelo e animação do carro local
[N9] Partículas e efeitos de estado
[N10] Telemetria, interpolação e carro fantasma
[N11] Validação de progresso, velocidade e chegada no servidor
[N12] HUD e feedback ao jogador
[N13] Piloto virtual
[N14] Testes e documentação operacional
```

Registre também as arestas reais. Use como hipótese inicial:

```text
N1 ─seed──────────────→ N2
N1 ─seed──────────────→ N4
N2 ─curvas/layout─────→ N3
N2 ─layout competitivo→ N5/N7/N11/N13
N3 ─coordenadas───────→ N7/N8/N9/N10
N4 ─objetos───────────→ N7
N5 ─estado físico─────→ N6/N9/N10/N11/N12
N6 ─intensidades──────→ N3/N7/N8/N9/N12
N10 ─telemetria───────→ N1/N11
N11 ─resultado oficial→ N12
```

Confirme cada aresta no código. Não apresente uma relação presumida como existente.

## 2. Invariantes do grafo

Preserve os seguintes contratos, salvo decisão de produto explicitamente aprovada:

- A aceleração continua automática; o jogador controla direção e boost.
- O carro do jogador permanece visualmente próximo à base da tela, enquanto `progress` representa o avanço real.
- O fantasma é apenas apresentação e nunca interfere na simulação local.
- A mesma corrida apresenta exatamente a mesma pista e o mesmo cenário para os dois jogadores.
- A geração não depende de FPS, horário local, ordem de renderização ou `Math.random()` chamado durante o frame.
- A simulação permanece consistente em diferentes taxas de quadros.
- A duração da prova continua adequada ao objetivo de 60 a 90 segundos, a menos que uma nova meta seja justificada e aprovada.
- Validações do servidor continuam coerentes com a velocidade máxima e o progresso possíveis.
- Largada, telemetria, chegada, reconexão, resultado e revanche não podem regredir.
- A apresentação deve continuar utilizável em desktop e celular.
- Cenário e efeitos não podem esconder obstáculos, fantasma, limites da pista ou HUD.
- Animações visuais não alteram hitbox, posição competitiva ou resposta dos controles.
- O custo de renderização e a quantidade de partículas permanecem limitados.

Transforme cada invariante alterável em teste ou verificação objetiva.

## 3. Grafo proposto e análise de impacto

Antes da implementação, produza um delta do grafo:

```text
Nó/aresta alterado:
Motivo:
Contrato anterior:
Novo contrato:
Dependentes transitivos:
Arquivos afetados:
Migração necessária:
Teste de aceitação:
Risco e estratégia de reversão:
```

Classifique cada mudança como:

- **estrutural** — muda contrato, protocolo ou fonte de verdade;
- **comportamental** — muda física ou regra competitiva;
- **derivada** — transforma dados sem mudar a regra;
- **visual** — altera somente apresentação;
- **verificação** — adiciona testes, métricas ou instrumentação.

Implemente primeiro mudanças estruturais, depois comportamentais, derivadas e visuais. Não faça um nó consumidor assumir um contrato que o produtor ainda não fornece.

## 4. Subgrafo A — Pista e cenário sincronizados

### Contrato desejado

```text
Servidor da sala
   └─ trackSeed oficial
        ├─ gerador de curvas
        ├─ gerador de cenário
        └─ reconstrução em reconexão
```

Implemente uma `trackSeed` autoritativa quando o layout variar entre corridas.

- O servidor cria e guarda a seed da corrida.
- Os dois clientes recebem a mesma seed antes da largada.
- Reconexão recupera a seed existente.
- Revanche pode gerar outra seed, distribuída igualmente aos dois pilotos.
- O piloto virtual e os tipos compartilhados acompanham o contrato quando necessário.
- A mesma seed sempre produz os mesmos elementos, posições e variações.

Não use `Math.random()` para gerar layout competitivo ou cenário sincronizado. Use PRNG determinístico ou hash estável baseado em seed e índice do trecho.

### Curvas

Gere uma sequência equilibrada de retas, curvas leves e curvas moderadas.

- Não permita quinas, inversões instantâneas ou curvas equivalentes a 90 graus ou mais.
- Como a estrada é pseudo-3D, defina limites verificáveis de curvatura, variação de curvatura e mudança acumulada de direção por trecho.
- Modele entrada, ápice e saída com continuidade.
- Mantenha tempo de leitura suficiente antes de obstáculos.
- Use a mesma projeção para estrada, bordas, faixas, obstáculos, linha de chegada, partículas e fantasma.
- A curvatura visual não deve deslocar a posição competitiva do carro por conta própria.

### Cenário

Distribua árvores, pasto, vegetação, arbustos, cercas, postes, placas, marcadores e pequenas variações do terreno.

Evite repetição por regras determinísticas:

- famílias visuais diferentes por trecho;
- variação de lado, distância, espaçamento, escala, cor e densidade;
- distância mínima e áreas de respiro;
- ausência de sequências idênticas em trechos vizinhos;
- agrupamentos naturais em vez de distribuição uniforme;
- geração estável por distância, sem objetos piscando entre frames.

Objetos devem usar coordenadas da pista, projeção e ordenação de profundidade. Não gere novas estruturas pesadas a cada frame se elas puderem ser calculadas uma vez ou por trechos.

### Testes do subgrafo A

- mesma seed → mesmo layout completo;
- seeds diferentes → variação mensurável;
- limites de curvatura nunca excedidos;
- continuidade nas transições;
- ausência de sobreposição proibida com a pista;
- seed idêntica para os dois jogadores;
- reconexão mantém a seed;
- revanche aplica a política definida para nova seed.

## 5. Subgrafo B — Física e sensação de velocidade

### Diagnóstico obrigatório

Antes de alterar `stepRace`, meça a linha de base:

- tempo de 0 a 50, 100, 150, 200 km/h e velocidade de cruzeiro;
- velocidade imediatamente antes e depois de uma colisão;
- tempo de recuperação após colisão;
- desaceleração e velocidade estabilizada fora da pista;
- efeito de zigue-zague contínuo sobre a velocidade;
- tempo total da corrida com e sem boost;
- diferença entre 60, 30 e 20 FPS.

### Contrato desejado

```text
entrada + estado da pista
          ↓
simulação determinística
          ├─ velocidade/progresso competitivos
          └─ valores derivados de feedback
                 ├─ projeção
                 ├─ carro
                 ├─ partículas
                 └─ HUD
```

Refine a progressão para comunicar:

```text
parado → arrancada → aceleração progressiva → cruzeiro → boost
```

- A arrancada deve ser forte, mas não colocar o carro quase imediatamente perto de 200 km/h.
- Use uma curva de aceleração perceptível e documentada.
- Entrada e saída do boost devem ser suaves e claramente reconhecíveis.
- Não resolva o problema apenas reduzindo a velocidade máxima.

Melhore as perdas de velocidade:

- colisão gera queda clara e recuperação controlada;
- permanência fora da pista gera desaceleração contínua;
- zigue-zague ou inversões agressivas de direção geram perda proporcional ao esforço lateral;
- pequenas correções necessárias em curvas não são penalizadas indevidamente;
- penalidades combinadas não deixam o carro irrecuperável.

Quando útil, derive uma única vez valores como:

- `normalizedSpeed`;
- aceleração longitudinal suavizada;
- intensidade e taxa de mudança da direção;
- intensidade de impacto;
- intensidade de off-road;
- intensidade de boost.

Esses valores não substituem a fonte de verdade da simulação e não criam uma segunda física.

### Propagação obrigatória

Se velocidade, aceleração, progressão ou duração mudarem, revise todos os dependentes transitivos:

- `speedForState` e `stepRace`;
- validação de telemetria e chegada;
- tempo mínimo plausível no servidor;
- extrapolação e apresentação do fantasma;
- piloto virtual;
- HUD e resultados;
- testes e documentação.

### Testes do subgrafo B

Adicione testes para marcos de aceleração, colisão, recuperação, off-road, zigue-zague, boost, duração total e consistência entre FPS. Defina tolerâncias com base nas medições, não em números arbitrários.

## 6. Subgrafo C — Carro e animação

### Contrato desejado

```text
estado físico real
       ↓
estado visual derivado e amortecido
       ↓
renderização do carro
```

Refine o modelo vetorial do carro no Canvas mantendo identidade fictícia e boa leitura em telas pequenas:

- silhueta e proporções mais convincentes;
- carroceria com volumes, recortes e realces;
- pneus visualmente separados;
- asas dianteira e traseira mais detalhadas;
- cockpit, halo e entradas de ar simplificados;
- sombra de contato coerente;
- paletas distintas e consistentes para jogador e fantasma.

Adicione animações derivadas da simulação:

- compressão ou deslocamento sutil na arrancada;
- resposta adicional durante boost;
- inclinação da carroceria ao esterçar;
- esterçamento visual das rodas dianteiras, se legível;
- retorno amortecido ao estado neutro;
- reação curta e amortecida a impactos;
- instabilidade controlada fora da pista;
- alinhamento entre rodas, rastros, poeira e faíscas.

As animações não podem atrasar input, deslocar hitbox ou modificar física. Evite tremor constante, deformações exageradas e movimentos que façam o carro flutuar. Considere `prefers-reduced-motion` para movimentos intensos.

O fantasma deve reutilizar o modelo e o contrato de animação sempre que possível, mantendo cor e transparência próprias. Não duplique lógica de desenho sem necessidade.

## 7. Execução topológica

Execute na seguinte ordem, alterando-a somente com justificativa baseada no grafo:

```text
1. Linha de base e grafo atual
2. Contratos, invariantes e grafo proposto
3. Seed oficial e protocolo
4. Geradores determinísticos
5. Curvas e projeção
6. Cenário lateral
7. Simulação de velocidade e direção
8. Estado visual derivado
9. Modelo e animação do carro/fantasma
10. Integração de partículas, HUD e feedback
11. Validação transitiva do servidor e piloto virtual
12. Testes completos, desempenho e comparação visual
```

Após cada nó alterado:

1. execute os testes diretos do nó;
2. execute os testes dos consumidores imediatos;
3. verifique os invariantes das arestas afetadas;
4. só então avance para o próximo nó.

Não acumule todos os subgrafos em uma única alteração sem validação intermediária.

## 8. Critérios de conclusão do grafo

A ação estará concluída somente quando:

- todo nó alterado tiver contrato e responsabilidade claros;
- toda aresta nova ou modificada estiver validada;
- a mesma seed reproduzir a mesma pista e cenário nos dois clientes;
- curvas forem suaves e permanecerem dentro dos limites definidos;
- o cenário for variado sem repetição evidente ou instabilidade entre frames;
- a arrancada e o ganho de velocidade forem claramente perceptíveis;
- colisão, off-road e zigue-zague causarem perdas equilibradas;
- o carro estiver visualmente mais detalhado e suas animações seguirem o estado real;
- pista, cenário, obstáculos, carro, partículas, fantasma e chegada permanecerem espacialmente alinhados;
- não houver regressões em largada, telemetria, reconexão, resultado e revanche;
- cliente, servidor e piloto virtual compartilharem contratos compatíveis;
- simulação e geração forem determinísticas e independentes de FPS;
- desempenho e legibilidade continuarem adequados em desktop e celular;
- não houver crescimento ilimitado de partículas, listas, timers, listeners ou alocações no loop;
- testes e build passarem.

Execute no mínimo:

```bash
npm test
npm run build
npx vitest run server/demonstracao.test.ts
```

Faça também verificação visual comparável em desktop e mobile para largada, aceleração, velocidade estabilizada, boost, curvas, zigue-zague, colisão, off-road, fantasma, chegada, reconexão e revanche.

## 9. Relatório final

Entregue o resultado no formato:

1. **Grafo anterior** — nós, arestas, fontes de verdade e fragilidades.
2. **Delta do grafo** — contratos e arestas alterados.
3. **Matriz de impacto** — produtores, consumidores e testes executados.
4. **Implementação por subgrafo** — pista/cenário, física/velocidade e carro/animação.
5. **Sincronização** — ciclo de vida da seed em criação, largada, reconexão e revanche.
6. **Antes vs. depois** — métricas de aceleração, perdas de velocidade e duração da corrida.
7. **Validação visual** — desktop e mobile.
8. **Desempenho** — custo de geração, renderização e partículas.
9. **Riscos residuais e decisões de produto** — itens que exigem aprovação adicional.

Não considere o trabalho concluído apenas porque os três recursos aparecem isoladamente. A conclusão exige que todo o caminho entre seed, layout, simulação, projeção, apresentação, telemetria e validação permaneça coerente como um único grafo funcional.
