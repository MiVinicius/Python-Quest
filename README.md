# 🐍 Python Quest

**Python Quest** é um jogo de tabuleiro digital educativo que combina corrida em trilha com **programação visual em blocos** traduzida em tempo real para **Python**.

🌐 **Jogue online:** [https://mivinicius.github.io/python-quest/](https://mivinicius.github.io/python-quest/)

O jogador avança pelo tabuleiro montando pequenos algoritmos (usando loops `for`, condicionais `if`, desvios de armadilhas e escudos `try/except`) com base na energia obtida no dado, além de responder desafios de código Python para ganhar bônus de movimento.

---

## 🎮 Modos de Jogo

- **Demonstração (22 casas vs Robô):** versão compacta para testar todas as mecânicas em poucos minutos.
- **Solo vs CPU (64 casas):** partida completa contra o bot com três níveis de dificuldade (*Iniciante*, *Equilibrada* e *Mestre*).
- **Multiplayer Online (P2P):** partidas em tempo real via WebRTC (PeerJS) ou entre abas locais (`BroadcastChannel`), por **Partida Rápida** ou **Sala Privada (`PY-XXXX`)**.

---

## 🕹️ Como Jogar

1. **Role o dado:** no início do turno, o dado D6 define a quantidade exata de passos base que o seu algoritmo precisa somar.
2. **Monte seu algoritmo com blocos:**
   - **Avançar (`avancar(N)`):** move o peão normalmente pela trilha.
   - **Pular (`pular(N)`):** salta sobre a casa de destino evitando Bugs.
   - **Loop `for`:** repete os blocos internos `N` vezes (aceita loops aninhados).
   - **Condicional `if`:** avalia condições do turno (ex.: `dado % 2 == 0`, `oponente.a_frente`, `proxima_casa.tem_bug()`) e concede **+1 passo bônus** quando verdadeira.
   - **Escudo (`try / except`):** protege contra o recuo do próximo Bug.
3. **Execute o código:** quando o total de passos dos blocos corresponder ao valor do dado, execute o programa para mover o peão e visualizar o código Python equivalente.
4. **Casas especiais do tabuleiro:**
   - **⚡ Atalho:** avança casas extras.
   - **🐛 Bug:** faz o peão recuar (anulado se você pular sobre a casa ou tiver um escudo ativo).
   - **❓ Desafio:** abre 3 cartas de dificuldade (**Comum +2**, **Rara +4**, **Épica +6**) com uma pergunta de Python e tempo limite de 25 segundos.
5. **Vitória:** vence quem chegar primeiro à casa final (**64** no modo padrão ou **22** na demonstração).

---

## ➕ Como Adicionar Novos Desafios

As perguntas ficam no arquivo [`desafios.json`](./desafios.json), organizado em três níveis (`facil`, `medio` e `dificil` — atualmente com 45 questões).

Para adicionar um novo desafio, insira um objeto seguindo este formato no array do `desafios.json`:

```json
{
  "id": "py-046",
  "categoria": "Compreensão de Conjuntos",
  "dificuldade": "medio",
  "pergunta": "Quantos elementos terá o conjunto resultante?",
  "codigo": "s = {x % 3 for x in range(6)}\nprint(len(s))",
  "opcoes": ["6", "3", "2", "1"],
  "resposta_correta": 1,
  "explicacao": "O operador % 3 gera os restos 0, 1 e 2. Como sets não armazenam duplicatas, restam 3 elementos.",
  "autor": "@seu-usuario"
}
```

### Campos obrigatórios
| Campo | Tipo | Descrição |
| :--- | :--- | :--- |
| `id` | `string` | Identificador único (ex.: `"py-046"`). |
| `categoria` | `string` | Tema do desafio exibido na carta e no modal. |
| `dificuldade` | `string` | `"facil"`, `"medio"` ou `"dificil"` (define em qual carta o desafio aparece). |
| `pergunta` | `string` | Enunciado da questão. |
| `codigo` | `string` | Trecho de código Python exibido ao jogador. |
| `opcoes` | `string[]` | Lista com exatamente **4** alternativas. |
| `resposta_correta` | `number` | Índice da alternativa correta (`0` a `3`). |
| `explicacao` | `string` | Explicação exibida após a resposta. |
| `autor` | `string` | Nome ou usuário de quem criou o desafio. |

---

## 🏛️ Arquitetura

A aplicação é uma **SPA estática** construída em **HTML, CSS e JavaScript (ES Modules)** seguindo o padrão **MVC (Model-View-Controller)**, sem dependências de backend ou build.

```text
python-quest/
├── .gitignore
├── .nojekyll                      # Habilita entrega direta de ES Modules no GitHub Pages
├── index.html                     # Estrutura principal da aplicação
├── desafios.json                  # Banco de desafios Python
├── DESIGN.md                      # Guia visual da interface
├── css/
│   ├── styles.css                 # Layout da arena, tabuleiro e terminal
│   ├── blocks.css                 # Blocos de programação e área de montagem
│   ├── home.css                   # Tela inicial, login/cadastro e modais
│   └── cards.css                  # Cartas de seleção de desafio
└── js/
    ├── app.js                     # Inicialização e injeção de dependências
    ├── services/
    │   └── AuthService.js         # Autenticação local (SHA-256) e exportação/importação JSON
    ├── models/
    │   ├── GameStateModel.js      # Estado da partida (turnos, posições, escudos e logs)
    │   ├── BoardModel.js          # Geração do tabuleiro (64 casas / 22 na Demo)
    │   ├── DiceModel.js           # Rolagem do dado e cálculo de bônus
    │   ├── BlockProgramModel.js   # Árvore de blocos (AST), avaliador e gerador de código Python
    │   ├── BotModel.js            # Lógica de decisão da CPU
    │   ├── ChallengeModel.js      # Carregamento e validação dos desafios
    │   ├── UserProfileModel.js    # Perfil, conquistas e histórico de partidas
    │   └── OnlineMultiplayerModel.js # Sincronização P2P (WebRTC PeerJS + BroadcastChannel)
    ├── views/
    │   ├── HomeView.js            # Autenticação inicial, menu principal e perfil/histórico
    │   ├── BoardView.js           # Renderização do tabuleiro e janela do oponente
    │   ├── DiceView.js            # Dado e barra de energia
    │   ├── BlockWorkspaceView.js  # Área de montagem dos blocos e preview Python
    │   ├── ChallengeCardsView.js  # Seleção das 3 cartas de desafio
    │   ├── ChallengeModalView.js  # Modal do desafio e cronômetro
    │   ├── StatusPanelView.js     # Placar, histórico de ações e fim de jogo
    │   └── SoundView.js           # Efeitos sonoros via Web Audio API
    └── controllers/
        ├── GameController.js      # Fluxo principal da partida (Demo, Solo e Online)
        ├── CodingController.js    # Validação entre blocos montados e energia do dado
        └── ChallengeController.js # Sorteio de desafios e aplicação de bônus/penalidades
```

---

## 💻 Executando Localmente

Como o projeto utiliza **ES Modules**, abra através de um servidor HTTP local (não diretamente via `file://`):

```bash
# Com Python
python -m http.server 8000

# Ou com Node.js
npx serve .
```

Acesse `http://localhost:8000` no navegador.
