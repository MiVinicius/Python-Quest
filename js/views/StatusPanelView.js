/**
 * StatusPanelView.js
 * Gerenciamento dos painéis de status: barra de progresso da corrida (1 a 64),
 * placar, log de console do jogo, modal de vitória/derrota e modal do GitHub.
 */
export class StatusPanelView {
  constructor() {
    this.raceTrackPlayer = null;
    this.raceTrackBot = null;
    this.playerPosEl = null;
    this.botPosEl = null;
    this.roundEl = null;
    this.turnBadgeEl = null;
    this.playerStatusBadge = null;
    this.botStatusBadge = null;
    this.consoleLogsEl = null;
    this.gameOverModal = null;
    this.githubModal = null;
    this.disconnectModal = null;

    this.onRestartCallback = null;
    this.onReturnHomeCallback = null;
  }

  init() {
    this.raceTrackPlayer = document.getElementById('raceTrackPlayer');
    this.raceTrackBot = document.getElementById('raceTrackBot');
    this.playerPosEl = document.getElementById('playerPosText');
    this.botPosEl = document.getElementById('botPosText');
    this.roundEl = document.getElementById('roundCountText');
    this.trackerGoalLabelEl = document.getElementById('raceTrackerGoalLabel');
    this.turnBadgeEl = document.getElementById('activeTurnBadge');
    this.playerStatusBadge = document.getElementById('playerStatusBadge');
    this.botStatusBadge = document.getElementById('botStatusBadge');
    this.consoleLogsEl = document.getElementById('consoleLogsList');
    this.terminalCardEl = document.getElementById('terminalPanelCard');
    this.btnTerminalMin = document.getElementById('btnTerminalMinimize');
    this.btnTerminalMax = document.getElementById('btnTerminalMaximize');
    this.currentTotalTiles = 64;

    this.setupTerminalControls();
    this.setupModals();
  }

  setupTerminalControls() {
    if (this.btnTerminalMin && this.terminalCardEl) {
      this.btnTerminalMin.addEventListener('click', () => {
        const isMin = this.terminalCardEl.classList.toggle('terminal-minimized');
        if (isMin) {
          this.terminalCardEl.classList.remove('terminal-maximized');
          if (this.btnTerminalMax) this.btnTerminalMax.textContent = '⤢';
        }
        this.btnTerminalMin.textContent = isMin ? '➕' : '➖';
        this.btnTerminalMin.title = isMin ? 'Restaurar Terminal' : 'Minimizar Terminal';
      });
    }

    if (this.btnTerminalMax && this.terminalCardEl) {
      this.btnTerminalMax.addEventListener('click', () => {
        this.terminalCardEl.classList.remove('terminal-minimized');
        if (this.btnTerminalMin) {
          this.btnTerminalMin.textContent = '➖';
          this.btnTerminalMin.title = 'Minimizar Terminal';
        }
        const isMax = this.terminalCardEl.classList.toggle('terminal-maximized');
        this.btnTerminalMax.textContent = isMax ? '⤡' : '⤢';
        this.btnTerminalMax.title = isMax ? 'Reduzir Altura do Terminal' : 'Maximizar Altura do Terminal';
      });
    }
  }

  setupModals() {
    // Modal de Fim de Jogo
    let goModal = document.getElementById('gameOverModalOverlay');
    if (!goModal) {
      goModal = document.createElement('div');
      goModal.id = 'gameOverModalOverlay';
      goModal.className = 'modal-overlay hidden';
      goModal.innerHTML = `
        <div class="modal-card game-over-card">
          <div class="game-over-icon" id="gameOverIcon">🏆</div>
          <h2 class="modal-title" id="gameOverTitle">Vitória!</h2>
          <p class="modal-subtitle" id="gameOverSubtitle">Você alcançou a casa 64 primeiro!</p>
          <div class="stats-summary" id="gameOverStats"></div>
          <div class="modal-actions" style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
            <button id="backHomeFromGameOverBtn" class="btn-ghost btn-lg">🏠 Voltar ao Menu Inicial</button>
            <button id="restartGameBtn" class="btn-primary btn-lg">Jogar Novamente 🔄</button>
          </div>
        </div>
      `;
      document.body.appendChild(goModal);
    }
    this.gameOverModal = goModal;

    const restartBtn = document.getElementById('restartGameBtn');
    if (restartBtn) {
      restartBtn.addEventListener('click', () => {
        this.hideGameOver();
        if (this.onRestartCallback) this.onRestartCallback();
      });
    }

    const backHomeBtn = document.getElementById('backHomeFromGameOverBtn');
    if (backHomeBtn) {
      backHomeBtn.addEventListener('click', () => {
        this.hideGameOver();
        if (this.onReturnHomeCallback) this.onReturnHomeCallback();
      });
    }

    // Modal de Contribuição GitHub
    let ghModal = document.getElementById('githubModalOverlay');
    if (!ghModal) {
      ghModal = document.createElement('div');
      ghModal.id = 'githubModalOverlay';
      ghModal.className = 'modal-overlay hidden';
      ghModal.innerHTML = `
        <div class="modal-card github-guide-card">
          <div class="modal-header">
            <div class="modal-title-group">
              <span class="modal-icon">🐙</span>
              <div>
                <h2 class="modal-title">Colaboração Open Source (GitHub Driven)</h2>
                <span class="badge-meta">Alimente o Python Quest com suas perguntas!</span>
              </div>
            </div>
            <button id="closeGithubModalBtn" class="btn-ghost btn-sm">✖</button>
          </div>
          <div class="modal-body github-guide-body">
            <p>O <strong>Python Quest - Arena</strong> não usa banco de dados proprietário. Todas as perguntas são carregadas a partir de um arquivo estruturado <code>desafios.json</code>!</p>
            
            <div class="guide-step">
              <span class="step-badge">Passo 1</span>
              <h4>Faça um Fork do Repositório</h4>
              <p>Acesse o repositório do projeto no GitHub e clique no botão <strong>Fork</strong> para criar sua cópia pessoal.</p>
            </div>

            <div class="guide-step">
              <span class="step-badge">Passo 2</span>
              <h4>Adicione seu Desafio ao desafios.json</h4>
              <p>Abra o arquivo <code>desafios.json</code> e adicione um novo bloco com seu problema em Python:</p>
              <pre class="code-box"><code>{
  "id": "py-999",
  "categoria": "Estruturas de Dados",
  "dificuldade": "medio",
  "pergunta": "Qual é a complexidade média de busca em um set?",
  "codigo": "meu_set = {1, 2, 3}\nprint(2 in meu_set)",
  "opcoes": ["O(1)", "O(n)", "O(log n)", "O(n^2)"],
  "resposta_correta": 0,
  "explicacao": "Sets em Python usam hash table, oferecendo busca em tempo constante médio O(1).",
  "autor": "Seu Nome / @seu-github"
}</code></pre>
            </div>

            <div class="guide-step">
              <span class="step-badge">Passo 3</span>
              <h4>Abra um Pull Request</h4>
              <p>Envie sua contribuição via Pull Request. Assim que aprovado pelo mantenedor, o jogo web consome a versão mais recente em tempo real via GitHub Raw!</p>
            </div>
          </div>
          <div class="modal-actions">
            <button id="closeGithubModalBtn2" class="btn-primary">Entendido, quero colaborar!</button>
          </div>
        </div>
      `;
      document.body.appendChild(ghModal);
    }
    this.githubModal = ghModal;

    const close1 = document.getElementById('closeGithubModalBtn');
    const close2 = document.getElementById('closeGithubModalBtn2');
    const closeHandler = () => this.githubModal.classList.add('hidden');
    if (close1) close1.addEventListener('click', closeHandler);
    if (close2) close2.addEventListener('click', closeHandler);

    // Botão na barra de navegação para abrir o modal do GitHub
    const openGithubBtn = document.getElementById('openGithubGuideBtn');
    if (openGithubBtn) {
      openGithubBtn.addEventListener('click', () => {
        this.githubModal.classList.remove('hidden');
      });
    }

    // Modal de Aviso de Desconexão / Saída do Oponente (Multiplayer Online)
    let discModal = document.getElementById('opponentDisconnectModalOverlay');
    if (!discModal) {
      discModal = document.createElement('div');
      discModal.id = 'opponentDisconnectModalOverlay';
      discModal.className = 'modal-overlay hidden';
      discModal.innerHTML = `
        <div class="modal-card disconnect-card" role="dialog" aria-modal="true" aria-labelledby="disconnectModalTitle">
          <div class="disconnect-icon" id="disconnectModalIcon">🔌</div>
          <h2 class="modal-title" id="disconnectModalTitle">Oponente Desconectado</h2>
          <p class="modal-subtitle" id="disconnectModalSubtitle">O outro jogador perdeu a conexão ou saiu da partida.</p>
          <div class="modal-actions" style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
            <button type="button" id="disconnectKeepWaitingBtn" class="btn-ghost btn-sm">⏳ Continuar Aguardando</button>
            <button type="button" id="disconnectReturnHomeBtn" class="btn-primary">🏠 Voltar ao Menu Inicial</button>
          </div>
        </div>
      `;
      document.body.appendChild(discModal);
    }
    this.disconnectModal = discModal;

    const keepWaitingBtn = document.getElementById('disconnectKeepWaitingBtn');
    if (keepWaitingBtn) {
      keepWaitingBtn.addEventListener('click', () => {
        this.hideOpponentDisconnected();
      });
    }

    const discReturnHomeBtn = document.getElementById('disconnectReturnHomeBtn');
    if (discReturnHomeBtn) {
      discReturnHomeBtn.addEventListener('click', () => {
        this.hideOpponentDisconnected();
        if (this.onReturnHomeCallback) this.onReturnHomeCallback();
      });
    }
  }

  updateProgress(playerPos, botPos, total = 64) {
    this.currentTotalTiles = total;
    const playerPercent = Math.min(100, Math.max(0, ((playerPos - 1) / (total - 1)) * 100));
    const botPercent = Math.min(100, Math.max(0, ((botPos - 1) / (total - 1)) * 100));

    if (this.raceTrackPlayer) this.raceTrackPlayer.style.left = `${playerPercent}%`;
    if (this.raceTrackBot) this.raceTrackBot.style.left = `${botPercent}%`;

    if (this.playerPosEl) this.playerPosEl.textContent = `${playerPos} / ${total}`;
    if (this.botPosEl) this.botPosEl.textContent = `${botPos} / ${total}`;
    if (this.trackerGoalLabelEl) {
      this.trackerGoalLabelEl.textContent = total < 64
        ? `Casa ${total} (Meta Demo) 🏆`
        : `Casa ${total} (Python Master) 🏆`;
    }
  }

  updateTurn(turn, round, isOnline = false, opponentName = 'CPU') {
    if (this.roundEl) this.roundEl.textContent = `Rodada: ${round}`;
    if (this.turnBadgeEl) {
      if (turn === 'player') {
        this.turnBadgeEl.className = 'turn-badge turn-player';
        this.turnBadgeEl.innerHTML = '<span class="pulse-dot"></span> Sua Vez (Você)';
      } else {
        this.turnBadgeEl.className = 'turn-badge turn-bot';
        if (isOnline) {
          this.turnBadgeEl.innerHTML = `<span class="pulse-dot"></span> Vez de ${opponentName} (Aguardando...)`;
        } else {
          this.turnBadgeEl.innerHTML = '<span class="pulse-dot"></span> Vez da CPU (Pensando...)';
        }
      }
    }
  }

  updateStatusBadges(playerBoost, playerStun, botStun, isOnline = false, botBoost = 0, opponentPresence = 'online') {
    if (this.playerStatusBadge) {
      if (playerStun) {
        this.playerStatusBadge.textContent = '⛔ Stunned (Perde Turno)';
        this.playerStatusBadge.className = 'badge-status badge-stun';
      } else if (playerBoost > 0) {
        this.playerStatusBadge.textContent = `⚡ Boost +${playerBoost}`;
        this.playerStatusBadge.className = 'badge-status badge-boost';
      } else {
        this.playerStatusBadge.textContent = '🟢 Normal';
        this.playerStatusBadge.className = 'badge-status badge-normal';
      }
    }

    if (this.botStatusBadge) {
      if (isOnline && opponentPresence === 'left') {
        this.botStatusBadge.textContent = '🚪 Saiu da sala';
        this.botStatusBadge.className = 'badge-status badge-stun';
      } else if (isOnline && opponentPresence === 'disconnected') {
        this.botStatusBadge.textContent = '🔴 Desconectado';
        this.botStatusBadge.className = 'badge-status badge-stun';
      } else if (isOnline && opponentPresence === 'unstable') {
        this.botStatusBadge.textContent = '🟡 Sem resposta...';
        this.botStatusBadge.className = 'badge-status badge-boost';
      } else if (botStun) {
        this.botStatusBadge.textContent = '⛔ Travado';
        this.botStatusBadge.className = 'badge-status badge-stun';
      } else if (botBoost > 0) {
        this.botStatusBadge.textContent = `⚡ Boost +${botBoost}`;
        this.botStatusBadge.className = 'badge-status badge-boost';
      } else if (isOnline) {
        this.botStatusBadge.textContent = '🟢 Conectado';
        this.botStatusBadge.className = 'badge-status badge-normal';
      } else {
        this.botStatusBadge.textContent = '🟢 Operacional';
        this.botStatusBadge.className = 'badge-status badge-normal';
      }
    }
  }

  showOpponentDisconnected({ name = 'Oponente', reason = 'timeout' } = {}) {
    if (!this.disconnectModal) return;
    const iconEl = document.getElementById('disconnectModalIcon');
    const titleEl = document.getElementById('disconnectModalTitle');
    const subEl = document.getElementById('disconnectModalSubtitle');
    const waitBtn = document.getElementById('disconnectKeepWaitingBtn');

    if (reason === 'left') {
      if (iconEl) iconEl.textContent = '🚪';
      if (titleEl) titleEl.textContent = `${name} saiu da partida`;
      if (subEl) subEl.textContent = `${name} saiu da sala ou fechou o navegador. Você pode retornar ao Menu Inicial para iniciar outra partida.`;
      if (waitBtn) waitBtn.textContent = 'Fechar aviso';
    } else {
      if (iconEl) iconEl.textContent = '🔌';
      if (titleEl) titleEl.textContent = `${name} parece desconectado`;
      if (subEl) subEl.textContent = `Não recebemos sinal de ${name} há mais de 45 segundos. Se a conexão voltar, a partida continuará automaticamente.`;
      if (waitBtn) waitBtn.textContent = '⏳ Continuar Aguardando';
    }

    this.disconnectModal.classList.remove('hidden');
  }

  hideOpponentDisconnected() {
    if (this.disconnectModal) {
      this.disconnectModal.classList.add('hidden');
    }
  }

  addLog(entry) {
    if (!this.consoleLogsEl) return;
    const logItem = document.createElement('div');
    logItem.className = `log-entry log-${entry.type || 'info'}`;
    logItem.innerHTML = `
      <span class="log-time">[${entry.time}]</span>
      <span class="log-sender">${entry.sender}:</span>
      <span class="log-text">${entry.text}</span>
    `;
    this.consoleLogsEl.insertBefore(logItem, this.consoleLogsEl.firstChild);
  }

  showGameOver(winner, rounds, isOnline = false, winnerName = null) {
    if (!this.gameOverModal) return;
    const icon = document.getElementById('gameOverIcon');
    const title = document.getElementById('gameOverTitle');
    const sub = document.getElementById('gameOverSubtitle');
    const stats = document.getElementById('gameOverStats');

    const isPlayer = (winner === 'player' || winner === 'p1');
    const goalTile = this.currentTotalTiles || 64;

    if (isPlayer) {
      icon.textContent = '🏆';
      title.textContent = 'VITÓRIA SENSACIONAL!';
      sub.textContent = isOnline 
        ? `Você cruzou a Casa ${goalTile} primeiro e venceu o duelo online!` 
        : `Você alcançou a Casa ${goalTile} primeiro e derrotou o CyberBot!`;
    } else {
      icon.textContent = isOnline ? '🏁' : '💀';
      title.textContent = isOnline ? `${winnerName || 'O Adversário'} VENCEU!` : 'A CPU VENCEU A CORRIDA!';
      sub.textContent = isOnline 
        ? `${winnerName || 'Seu oponente'} cruzou a Casa ${goalTile} primeiro. Boa partida!` 
        : `O CyberBot cruzou a Casa ${goalTile} primeiro. Refatore sua estratégia e tente de novo!`;
    }

    const displayedWinner = isPlayer 
      ? 'Você' 
      : (isOnline ? (winnerName || 'Oponente') : 'CyberBot (CPU)');

    stats.innerHTML = `
      <div class="stat-pill">Total de Rodadas: <strong>${rounds}</strong></div>
      <div class="stat-pill">Vencedor: <strong>${displayedWinner}</strong></div>
    `;

    this.gameOverModal.classList.remove('hidden');
  }

  hideGameOver() {
    if (this.gameOverModal) {
      this.gameOverModal.classList.add('hidden');
    }
  }

  onRestart(cb) {
    this.onRestartCallback = cb;
  }

  onReturnHome(cb) {
    this.onReturnHomeCallback = cb;
  }
}
