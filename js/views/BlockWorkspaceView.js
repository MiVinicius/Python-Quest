/**
 * BlockWorkspaceView.js
 * Interface hierárquica de programação em blocos com suporte a:
 * - Loops aninhados (for dentro de for)
 * - Condicionais if com avaliação em tempo real (Live Badge)
 * - Comandos sequenciais posicionáveis
 * - Drag & Drop avançado com áreas de indentação + Clique rápido
 * - Reordenação rápida via botões ⬆️ ⬇️
 * - Avaliação de fórmulas em tempo real e Syntax Highlighting de Python
 */
export class BlockWorkspaceView {
  constructor(containerId, blockProgramModel, gameStateModel = null, boardModel = null) {
    this.container = document.getElementById(containerId);
    this.model = blockProgramModel;
    this.gameState = gameStateModel;
    this.boardModel = boardModel;
    
    this.onExecuteCallback = null;
    this.onUnlockPythonCallback = null;
    this.blockChangedListeners = [];
    this.isSpectatorMode = false;
    this.tutorialFreePreview = false;
    this.activeContainerId = null;
    this.draggedBlockId = null;

    this.render();
    this.setupEvents();
  }

  notifyBlockChanged() {
    this.clearValidationFeedback();
    this.blockChangedListeners.forEach((cb) => cb());
  }

  /**
   * Aplica Syntax Highlighting seguro ao código Python gerado.
   */
  formatPythonSyntax(rawCode = '') {
    const escapeHtml = (str) => String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    return String(rawCode)
      .split('\n')
      .map((line) => {
        const commentIdx = line.indexOf('#');
        let codePart = commentIdx !== -1 ? line.slice(0, commentIdx) : line;
        const commentPart = commentIdx !== -1 ? line.slice(commentIdx) : '';

        let html = escapeHtml(codePart);

        // Destaca keywords Python
        html = html.replace(
          /\b(for|in|range|if|try|except|pass|True|False)\b/g,
          '<span class="py-kw">$1</span>'
        );

        // Destaca exceções
        html = html.replace(
          /\b(BugTrapException)\b/g,
          '<span class="py-exc">$1</span>'
        );

        // Destaca métodos
        html = html.replace(
          /\.(avancar|pular|ativar_escudo|passo_bonus|tem_bug|acelerar)\b/g,
          '.<span class="py-fn">$1</span>'
        );

        // Destaca números
        html = html.replace(
          /\b(\d+)\b/g,
          '<span class="py-num">$1</span>'
        );

        if (commentPart) {
          html += `<span class="py-comment">${escapeHtml(commentPart)}</span>`;
        }

        return html;
      })
      .join('\n');
  }

  render() {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="workspace-card">
        <div class="workspace-header">
          <div class="header-left">
            <span class="icon">🧩</span>
            <h3>Painel de Instruções</h3>
          </div>
          <button id="clearWorkspaceBtn" class="btn-ghost btn-xs" title="Limpar todos os blocos">
            🗑️ Limpar
          </button>
        </div>

        <!-- Banner do Modo Espectador (Jogada do Oponente) -->
        <div id="spectatorBanner" class="spectator-banner" style="display: none;">
          <div class="spectator-badge-title">
            <span class="spectator-pulse">👁️</span>
            <span id="spectatorOpponentName">Turno do Oponente</span>
          </div>
          <span id="spectatorStatusText" class="spectator-status-badge">Aguardando jogada...</span>
        </div>

        <!-- Paleta com Blocos Arrastáveis -->
        <div class="block-palette-section">
          <span class="section-tag">Paleta de Blocos (Arraste ou clique para adicionar):</span>
          <div class="tokens-palette" id="paletteBlocks">
            
            <!-- 1. Loop for -->
            <button class="token-block token-loop-for" draggable="true" data-type="loop_for" data-default-val="2" title="Loop repetidor: for i in range(N)">
              <div class="token-top-row">
                <span class="token-icon">🔁</span>
                <span class="token-label">Loop for</span>
              </div>
              <span class="token-sublabel">for i in range(2):</span>
            </button>

            <!-- 2. Avançar -->
            <button class="token-block token-action-forward" draggable="true" data-type="action_forward" data-default-val="1" title="Avançar casas normais">
              <div class="token-top-row">
                <span class="token-icon">➡️</span>
                <span class="token-label">Avançar</span>
              </div>
              <span class="token-sublabel">player.avancar(N)</span>
            </button>

            <!-- 3. Pular -->
            <button id="paletteJumpBtn" class="token-block token-action-jump" draggable="true" data-type="action_jump" data-default-val="1" title="Pular direto ignorando armadilhas (consome 1 carga; recarregue nos Desafios)">
              <div class="token-top-row">
                <span class="token-icon">🦘</span>
                <span class="token-label">Pular</span>
                <span id="jumpChargesBadge" class="token-charge-badge" title="Cargas de Pular disponíveis">×2</span>
              </div>
              <span class="token-sublabel">player.pular(N)</span>
            </button>

            <!-- 4. Escudo -->
            <button id="paletteShieldBtn" class="token-block token-action-shield" draggable="true" data-type="action_shield" data-default-val="0" title="Blindagem try/except contra bugs (consome 1 carga; recarregue nos Desafios)">
              <div class="token-top-row">
                <span class="token-icon">🛡️</span>
                <span class="token-label">Escudo</span>
                <span id="shieldChargesBadge" class="token-charge-badge" title="Cargas de Escudo disponíveis">×2</span>
              </div>
              <span class="token-sublabel">try / except</span>
            </button>

            <!-- 5. Condicional if -->
            <button class="token-block token-conditional-if" draggable="true" data-type="conditional_if" data-condition="dado_par" title="Decisão Tática: if condicao: (+1 passo bônus se True; ignora corpo se False)">
              <div class="token-top-row">
                <span class="token-icon">🔀</span>
                <span class="token-label">Condicional if</span>
              </div>
              <span class="token-sublabel">if dado % 2 == 0:</span>
            </button>

          </div>
        </div>

        <!-- Janela de Linha de Execução -->
        <div class="workspace-dropzone-section">
          <div class="dropzone-header">
            <span class="section-tag">Linha de Execução & Algoritmo:</span>
            <span id="blockCountBadge" class="badge-step-count">0 passos</span>
          </div>

          <div class="tokens-dropzone" id="workspaceDropzone" data-parent-id="root">
            <div class="dropzone-empty" id="dropzoneEmpty">
              <span class="empty-icon">💡</span>
              <p>Arraste ou clique nos blocos! Você pode aninhar <strong>for dentro de for</strong> ou usar <strong>if</strong>.</p>
            </div>
            <div class="tokens-chain" id="dropzoneList"></div>
          </div>
        </div>

        <!-- Preview do Código Python (Desbloqueado por Turno com Moedas ou Assistência Grátis) -->
        <div class="python-preview-section">
          <div class="preview-header">
            <span class="terminal-title">🐍 Tradução em Python:</span>
            <div class="preview-header-badges">
              <span id="pythonAssistBadge" class="badge-python-assist hidden"></span>
              <span id="workspaceCoinsBadge" class="badge-coins" title="Moedas da partida (use para tradução Python ou +15s em Desafios)">🪙 10 moedas</span>
              <span class="badge-lang">Python 3.12</span>
            </div>
          </div>
          <div class="python-preview-container">
            <pre id="pythonCodePre" class="python-code-view is-locked-blur"><code id="pythonCodeDisplay"># Arraste blocos para montar seu algoritmo...</code></pre>
            <div id="pythonLockOverlay" class="python-lock-overlay">
              <span class="python-lock-title">🔒 Tradução Python Bloqueada neste Turno</span>
              <button type="button" id="unlockPythonBtn" class="btn-unlock-python">
                🔓 Desbloquear neste Turno (🪙 10 moedas)
              </button>
              <span class="python-lock-hint">💡 Grátis se estiver atrás na corrida ou após errar uma Carta Comum</span>
            </div>
          </div>
        </div>

        <!-- Feedback Inline de Validação e Execução -->
        <div id="workspaceFeedbackBanner" class="workspace-feedback-banner hidden" role="alert"></div>

        <!-- Botão Executar -->
        <div class="workspace-actions">
          <button id="executeCodeBtn" class="btn-success btn-execute">
            <span class="btn-icon">⚡</span>
            <span class="btn-text">Executar Código</span>
          </button>
        </div>
      </div>
    `;

    this.dropzoneListEl = document.getElementById('dropzoneList');
    this.dropzoneEmptyEl = document.getElementById('dropzoneEmpty');
    this.pythonCodePreEl = document.getElementById('pythonCodePre');
    this.pythonCodeEl = document.getElementById('pythonCodeDisplay');
    this.pythonLockOverlayEl = document.getElementById('pythonLockOverlay');
    this.pythonAssistBadgeEl = document.getElementById('pythonAssistBadge');
    this.unlockPythonBtn = document.getElementById('unlockPythonBtn');
    this.workspaceCoinsBadgeEl = document.getElementById('workspaceCoinsBadge');
    this.jumpChargesBadgeEl = document.getElementById('jumpChargesBadge');
    this.shieldChargesBadgeEl = document.getElementById('shieldChargesBadge');
    this.jumpPaletteBtn = document.getElementById('paletteJumpBtn');
    this.shieldPaletteBtn = document.getElementById('paletteShieldBtn');
    this.feedbackBannerEl = document.getElementById('workspaceFeedbackBanner');
    this.executeBtn = document.getElementById('executeCodeBtn');
    this.clearBtn = document.getElementById('clearWorkspaceBtn');
    this.stepCountBadge = document.getElementById('blockCountBadge');
    this.spectatorBannerEl = document.getElementById('spectatorBanner');
    this.spectatorOpponentNameEl = document.getElementById('spectatorOpponentName');
    this.spectatorStatusTextEl = document.getElementById('spectatorStatusText');
  }

  setupEvents() {
    const palette = document.getElementById('paletteBlocks');
    const rootDropzone = document.getElementById('workspaceDropzone');

    // 1. Clique rápido na paleta adiciona na raiz ou no container (for/if) selecionado
    palette.addEventListener('click', (e) => {
      if (this.isSpectatorMode) return;
      const blockEl = e.target.closest('.token-block');
      if (!blockEl) return;
      const type = blockEl.getAttribute('data-type');
      if (!this.canUseTacticalBlock(type)) return;
      const val = parseInt(blockEl.getAttribute('data-default-val'), 10) || 1;
      const cond = blockEl.getAttribute('data-condition') || (type === 'conditional_if' ? 'dado_par' : null);

      let targetParentId = null;
      if (this.activeContainerId) {
        if (this.model.findBlock(this.activeContainerId)) {
          targetParentId = this.activeContainerId;
        } else {
          this.activeContainerId = null;
        }
      }

      this.model.addBlock({ type, value: val, condition: cond }, targetParentId);
      this.updateUI();
      this.notifyBlockChanged();
    });

    // 2. Drag Start na paleta
    palette.addEventListener('dragstart', (e) => {
      if (this.isSpectatorMode) {
        e.preventDefault();
        return;
      }
      const blockEl = e.target.closest('.token-block');
      if (!blockEl) return;
      const type = blockEl.getAttribute('data-type');
      if (!this.canUseTacticalBlock(type)) {
        e.preventDefault();
        return;
      }
      const val = parseInt(blockEl.getAttribute('data-default-val'), 10) || 1;
      const cond = blockEl.getAttribute('data-condition') || (type === 'conditional_if' ? 'dado_par' : null);

      this.draggedBlockId = null;
      e.dataTransfer.setData('application/json', JSON.stringify({
        isNew: true,
        type,
        value: val,
        condition: cond
      }));
      e.dataTransfer.effectAllowed = 'copy';
    });

    // 3. Suporte a Drag & Drop (da paleta e interno entre blocos/containers) com posição exata
    rootDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (this.isSpectatorMode) return;

      this.clearDropIndicators();
      const target = this.computeDropTarget(e, rootDropzone);
      if (this.draggedBlockId && target.parentId && this.model.isDescendant(this.draggedBlockId, target.parentId)) {
        e.dataTransfer.dropEffect = 'none';
        return;
      }

      target.containerEl.classList.add('drag-active');
      if (target.indicatorCard && target.indicatorCard.dataset.blockId !== this.draggedBlockId) {
        target.indicatorCard.classList.add(
          target.position === 'before' ? 'drop-indicator-before' : 'drop-indicator-after'
        );
      }
      e.dataTransfer.dropEffect = this.draggedBlockId ? 'move' : 'copy';
    });

    rootDropzone.addEventListener('dragleave', (e) => {
      if (!rootDropzone.contains(e.relatedTarget)) {
        this.clearDropIndicators();
      }
    });

    rootDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      const target = this.computeDropTarget(e, rootDropzone);
      this.clearDropIndicators();

      if (this.isSpectatorMode) return;

      try {
        const raw = e.dataTransfer.getData('application/json');
        if (!raw) return;
        const data = JSON.parse(raw);

        if (data.isNew && data.type) {
          this.model.addBlock(
            { type: data.type, value: data.value, condition: data.condition },
            target.parentId,
            target.insertIndex
          );
          this.updateUI();
          this.notifyBlockChanged();
        } else if (!data.isNew && data.blockId) {
          if (this.model.moveBlockTo(data.blockId, target.parentId, target.insertIndex)) {
            this.updateUI();
            this.notifyBlockChanged();
          }
        }
      } catch (err) {
        console.warn('Erro ao processar drop:', err);
      } finally {
        this.draggedBlockId = null;
      }
    });

    // Limpar
    this.clearBtn.addEventListener('click', () => {
      this.activeContainerId = null;
      this.model.clear();
      this.updateUI();
      this.notifyBlockChanged();
    });

    // Executar
    this.executeBtn.addEventListener('click', () => {
      if (this.onExecuteCallback) this.onExecuteCallback();
    });

    // Desbloquear Tradução em Python neste Turno com Moedas
    if (this.unlockPythonBtn) {
      this.unlockPythonBtn.addEventListener('click', () => {
        if (!this.gameState) return;
        const res = this.gameState.unlockPythonForTurn();
        this.updatePythonLockState();
        if (this.onUnlockPythonCallback) {
          this.onUnlockPythonCallback(res);
        }
      });
    }
  }

  clearDropIndicators() {
    if (!this.container) return;
    this.container
      .querySelectorAll('.drag-active, .drop-indicator-before, .drop-indicator-after')
      .forEach((el) => {
        el.classList.remove('drag-active', 'drop-indicator-before', 'drop-indicator-after');
      });
  }

  computeDropTarget(e, rootDropzone) {
    const innerContainer = e.target.closest('.loop-body-dropzone, .if-body-dropzone');
    const containerEl = innerContainer || rootDropzone;
    const parentId = innerContainer ? innerContainer.getAttribute('data-parent-id') : null;
    const listHost = innerContainer || this.dropzoneListEl;

    const childCards = listHost
      ? Array.from(listHost.children).filter((el) =>
          el.classList.contains('chain-action-card') ||
          el.classList.contains('chain-loop-card') ||
          el.classList.contains('chain-if-card')
        )
      : [];

    if (childCards.length === 0) {
      return { containerEl, parentId, insertIndex: -1, indicatorCard: null, position: null };
    }

    for (let i = 0; i < childCards.length; i++) {
      const card = childCards[i];
      const rect = card.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        return { containerEl, parentId, insertIndex: i, indicatorCard: card, position: 'before' };
      }
    }

    return {
      containerEl,
      parentId,
      insertIndex: childCards.length,
      indicatorCard: childCards[childCards.length - 1],
      position: 'after'
    };
  }

  canUseTacticalBlock(type) {
    if (!this.gameState) return true;
    if (type === 'action_jump' && this.gameState.jumpCharges <= 0) {
      this.showValidationFeedback(
        'Sem cargas de Pular (🦘)! Acerte um Desafio Python na trilha para recarregar.',
        'warning'
      );
      return false;
    }
    if (type === 'action_shield' && this.gameState.shieldCharges <= 0) {
      this.showValidationFeedback(
        'Sem cargas de Escudo (🛡️)! Acerte um Desafio Python na trilha para recarregar.',
        'warning'
      );
      return false;
    }
    return true;
  }

  updateTacticalChargesUI() {
    const jumpCharges = this.gameState ? this.gameState.jumpCharges : 2;
    const shieldCharges = this.gameState ? this.gameState.shieldCharges : 2;

    if (this.jumpChargesBadgeEl) {
      this.jumpChargesBadgeEl.textContent = `×${jumpCharges}`;
      this.jumpChargesBadgeEl.classList.toggle('is-empty', jumpCharges <= 0);
    }
    if (this.jumpPaletteBtn) {
      this.jumpPaletteBtn.classList.toggle('is-depleted', jumpCharges <= 0);
      this.jumpPaletteBtn.title = jumpCharges > 0
        ? `Pular direto ignorando armadilhas (${jumpCharges} carga(s) restante(s); recarregue nos Desafios)`
        : 'Sem cargas de Pular! Acerte um Desafio Python para recarregar.';
    }

    if (this.shieldChargesBadgeEl) {
      this.shieldChargesBadgeEl.textContent = `×${shieldCharges}`;
      this.shieldChargesBadgeEl.classList.toggle('is-empty', shieldCharges <= 0);
    }
    if (this.shieldPaletteBtn) {
      this.shieldPaletteBtn.classList.toggle('is-depleted', shieldCharges <= 0);
      this.shieldPaletteBtn.title = shieldCharges > 0
        ? `Blindagem try/except contra bugs (${shieldCharges} carga(s) restante(s); recarregue nos Desafios)`
        : 'Sem cargas de Escudo! Acerte um Desafio Python para recarregar.';
    }
  }

  showValidationFeedback(message, type = 'error') {
    if (!this.feedbackBannerEl) return;
    const icons = { error: '⚠️', warning: '💡', success: '✅' };
    this.feedbackBannerEl.className = `workspace-feedback-banner is-${type}`;
    this.feedbackBannerEl.innerHTML = `<span class="wf-icon">${icons[type] || '⚠️'}</span><span class="wf-text"></span>`;
    const textEl = this.feedbackBannerEl.querySelector('.wf-text');
    if (textEl) textEl.textContent = message;
    void this.feedbackBannerEl.offsetWidth;
    this.feedbackBannerEl.classList.add('wf-animate');
  }

  clearValidationFeedback() {
    if (!this.feedbackBannerEl) return;
    this.feedbackBannerEl.className = 'workspace-feedback-banner hidden';
    this.feedbackBannerEl.innerHTML = '';
  }

  setTutorialFreePreview(enabled) {
    this.tutorialFreePreview = Boolean(enabled);
    this.updatePythonLockState();
  }

  updatePythonLockState() {
    const coins = this.gameState ? this.gameState.playerCoins : 10;
    const cost = this.gameState ? (this.gameState.PYTHON_UNLOCK_COST || 10) : 10;
    const reason = this.gameState ? this.gameState.pythonUnlockReason : null;
    const isUnlocked = Boolean(
      (this.gameState && this.gameState.pythonUnlockedThisTurn) || this.tutorialFreePreview
    );

    if (this.workspaceCoinsBadgeEl) {
      this.workspaceCoinsBadgeEl.textContent = `🪙 ${coins} ${coins === 1 ? 'moeda' : 'moedas'}`;
    }

    const playerCoinsBadge = document.getElementById('playerCoinsBadge');
    if (playerCoinsBadge) {
      playerCoinsBadge.textContent = `🪙 ${coins} ${coins === 1 ? 'moeda' : 'moedas'}`;
    }

    if (this.pythonAssistBadgeEl) {
      if (isUnlocked && !this.tutorialFreePreview && reason === 'behind') {
        this.pythonAssistBadgeEl.textContent = '🎓 Grátis (atrás)';
        this.pythonAssistBadgeEl.title = 'Assistência ativa: tradução Python gratuita enquanto você estiver atrás na corrida!';
        this.pythonAssistBadgeEl.classList.remove('hidden');
      } else if (isUnlocked && !this.tutorialFreePreview && reason === 'common_miss') {
        this.pythonAssistBadgeEl.textContent = '🎁 Grátis (bônus)';
        this.pythonAssistBadgeEl.title = 'Bônus ativo: tradução Python gratuita por tentar uma Carta Comum!';
        this.pythonAssistBadgeEl.classList.remove('hidden');
      } else {
        this.pythonAssistBadgeEl.classList.add('hidden');
      }
    }

    if (!this.pythonLockOverlayEl || !this.pythonCodePreEl) return;

    if (isUnlocked) {
      this.pythonLockOverlayEl.classList.add('hidden');
      this.pythonCodePreEl.classList.remove('is-locked-blur');
    } else {
      this.pythonLockOverlayEl.classList.remove('hidden');
      this.pythonCodePreEl.classList.add('is-locked-blur');

      if (this.unlockPythonBtn) {
        if (coins >= cost) {
          this.unlockPythonBtn.disabled = false;
          this.unlockPythonBtn.textContent = `🔓 Desbloquear neste Turno (🪙 ${cost} moedas)`;
        } else {
          this.unlockPythonBtn.disabled = true;
          this.unlockPythonBtn.textContent = `🔒 Saldo insuficiente (${coins}/${cost} 🪙 — acerte Desafios!)`;
        }
      }
    }
  }

  updateUI() {
    if (this.isSpectatorMode) return;
    if (this.activeContainerId && !this.model.findBlock(this.activeContainerId)) {
      this.activeContainerId = null;
    }

    this.dropzoneListEl.innerHTML = '';
    const rootBlocks = this.model.rootBlocks;

    if (rootBlocks.length === 0) {
      this.dropzoneEmptyEl.style.display = 'flex';
      this.stepCountBadge.textContent = '0 passos';
      this.stepCountBadge.className = 'badge-step-count';
    } else {
      this.dropzoneEmptyEl.style.display = 'none';

      // Renderiza árvore de blocos
      this.renderBlockList(rootBlocks, this.dropzoneListEl, 0);
      this.updateCodeAndSteps();
    }

    this.pythonCodeEl.innerHTML = this.formatPythonSyntax(this.model.toPythonCode());
    this.updatePythonLockState();
    this.updateTacticalChargesUI();
  }

  /**
   * Renderiza recursivamente listas de blocos (raiz ou filhos de um loop).
   */
  renderBlockList(blocks, containerEl, depth = 0) {
    const loopVars = ['i', 'j', 'k', 'n'];
    const currentVar = loopVars[depth % loopVars.length];
    const canEdit = !this.isSpectatorMode;

    blocks.forEach((block, index) => {
      const unnestBtnHtml = (depth > 0 && canEdit)
        ? `<button type="button" class="btn-unnest-token" data-id="${block.id}" title="Tirar bloco de dentro do for/if">↩️</button>`
        : '';

      if (block.type === 'loop_for') {
        const isTarget = canEdit && this.activeContainerId === block.id;
        const loopCard = document.createElement('div');
        loopCard.className = 'chain-loop-card';
        loopCard.setAttribute('data-id', block.id);
        loopCard.setAttribute('data-block-id', block.id);
        if (canEdit) loopCard.setAttribute('draggable', 'true');

        loopCard.innerHTML = `
          <div class="loop-header">
            <div class="loop-title-group">
              <span class="drag-handle-grip" title="Arraste para mover este bloco">⋮⋮</span>
              <span>🔁</span>
              <span>for ${currentVar} in range(</span>
              <input type="number" class="block-input-number" min="1" max="12" value="${block.value}" data-id="${block.id}" title="Repetições do loop">
              <span>):</span>
            </div>
            <div class="block-actions-controls">
              ${unnestBtnHtml}
              <button type="button" class="btn-move-token" data-action="up" data-id="${block.id}" title="Mover para cima" ${index === 0 ? 'disabled' : ''}>⬆️</button>
              <button type="button" class="btn-move-token" data-action="down" data-id="${block.id}" title="Mover para baixo" ${index === blocks.length - 1 ? 'disabled' : ''}>⬇️</button>
              <button type="button" class="btn-remove-token" data-id="${block.id}" title="Remover loop">✖</button>
            </div>
          </div>
          <div class="loop-body-dropzone ${isTarget ? 'is-insert-target' : ''}" data-parent-id="${block.id}">
            ${(!block.children || block.children.length === 0) 
              ? `<div class="loop-empty-placeholder">➕ Arraste blocos aqui ou use o botão abaixo para inserir por clique...</div>` 
              : ''}
          </div>
          ${canEdit ? `
            <button type="button" class="btn-target-container ${isTarget ? 'active' : ''}" data-target-id="${block.id}" title="Selecionar este loop como destino ao clicar nos blocos da paleta">
              ${isTarget ? '✓ Inserindo aqui • Clique na paleta (Voltar à raiz)' : '➕ Inserir aqui (por clique)'}
            </button>
          ` : ''}
        `;

        if (block.children && block.children.length > 0) {
          const bodyContainer = loopCard.querySelector('.loop-body-dropzone');
          this.renderBlockList(block.children, bodyContainer, depth + 1);
        }

        this.bindCardEvents(loopCard, block);
        containerEl.appendChild(loopCard);

      } else if (block.type === 'conditional_if') {
        const isTarget = canEdit && this.activeContainerId === block.id;
        const ifCard = document.createElement('div');
        ifCard.className = 'chain-if-card';
        ifCard.setAttribute('data-id', block.id);
        ifCard.setAttribute('data-block-id', block.id);
        if (canEdit) ifCard.setAttribute('draggable', 'true');

        ifCard.innerHTML = `
          <div class="if-header">
            <div class="if-title-group" style="flex-wrap: wrap; gap: 6px;">
              <span class="drag-handle-grip" title="Arraste para mover este bloco">⋮⋮</span>
              <span>🔀</span>
              <span>if</span>
              <select class="block-select-condition" data-id="${block.id}" title="Escolha a condição booleana (avaliada na execução)">
                <option value="dado_par" ${block.condition === 'dado_par' ? 'selected' : ''}>dado % 2 == 0 (Par)</option>
                <option value="dado_impar" ${block.condition === 'dado_impar' ? 'selected' : ''}>dado % 2 != 0 (Ímpar)</option>
                <option value="oponente_a_frente" ${block.condition === 'oponente_a_frente' ? 'selected' : ''}>oponente.a_frente</option>
                <option value="casa_com_bug" ${block.condition === 'casa_com_bug' ? 'selected' : ''}>proxima_casa.tem_bug()</option>
              </select>
              <span>:</span>
              <span class="cond-live-badge badge-cond-pending" title="A expressão booleana é avaliada somente ao executar! Se for False, todo o corpo interno é ignorado (como no Python real).">
                🧠 Avaliada ao executar
              </span>
            </div>
            <div class="block-actions-controls">
              ${unnestBtnHtml}
              <button type="button" class="btn-move-token" data-action="up" data-id="${block.id}" title="Mover para cima" ${index === 0 ? 'disabled' : ''}>⬆️</button>
              <button type="button" class="btn-move-token" data-action="down" data-id="${block.id}" title="Mover para baixo" ${index === blocks.length - 1 ? 'disabled' : ''}>⬇️</button>
              <button type="button" class="btn-remove-token" data-id="${block.id}" title="Remover if">✖</button>
            </div>
          </div>
          <div class="if-body-dropzone ${isTarget ? 'is-insert-target' : ''}" data-parent-id="${block.id}">
            ${(!block.children || block.children.length === 0) 
              ? `<div class="loop-empty-placeholder" style="color: #fde68a;">⚡ Se <strong>True</strong> ao executar: roda os blocos internos + <strong>+1 passo bônus</strong> (máx. +1/turno). Se <strong>False</strong>: ignora tudo aqui dentro!</div>` 
              : ''}
          </div>
          ${canEdit ? `
            <button type="button" class="btn-target-container ${isTarget ? 'active' : ''}" data-target-id="${block.id}" title="Selecionar este if como destino ao clicar nos blocos da paleta">
              ${isTarget ? '✓ Inserindo aqui • Clique na paleta (Voltar à raiz)' : '➕ Inserir aqui (por clique)'}
            </button>
          ` : ''}
        `;

        if (block.children && block.children.length > 0) {
          const bodyContainer = ifCard.querySelector('.if-body-dropzone');
          this.renderBlockList(block.children, bodyContainer, depth + 1);
        }

        this.bindCardEvents(ifCard, block);
        containerEl.appendChild(ifCard);

      } else {
        // Bloco de Ação Simples
        const actionCard = document.createElement('div');
        actionCard.className = `chain-action-card card-${block.type.replace('_', '-')}`;
        actionCard.setAttribute('data-id', block.id);
        actionCard.setAttribute('data-block-id', block.id);
        if (canEdit) actionCard.setAttribute('draggable', 'true');

        let icon = '➡️';
        let codeLabel = '';
        let showInput = true;

        switch (block.type) {
          case 'action_forward':
            icon = '➡️';
            codeLabel = 'player.avancar';
            break;
          case 'action_jump':
            icon = '🦘';
            codeLabel = 'player.pular';
            break;
          case 'action_shield':
            icon = '🛡️';
            codeLabel = 'player.ativar_escudo';
            showInput = false;
            break;
          case 'action_turbo':
            icon = '⚡';
            codeLabel = 'player.acelerar';
            break;
        }

        actionCard.innerHTML = `
          <div class="block-code-label">
            <span class="drag-handle-grip" title="Arraste para mover este bloco">⋮⋮</span>
            <span>${icon}</span>
            <span>${codeLabel}(</span>
            ${showInput ? `<input type="number" class="block-input-number" min="1" max="12" value="${block.value}" data-id="${block.id}">` : ''}
            <span>)</span>
          </div>
          <div class="block-actions-controls">
            ${unnestBtnHtml}
            <button type="button" class="btn-move-token" data-action="up" data-id="${block.id}" title="Mover para cima" ${index === 0 ? 'disabled' : ''}>⬆️</button>
            <button type="button" class="btn-move-token" data-action="down" data-id="${block.id}" title="Mover para baixo" ${index === blocks.length - 1 ? 'disabled' : ''}>⬇️</button>
            <button type="button" class="btn-remove-token" data-id="${block.id}" title="Remover bloco">✖</button>
          </div>
        `;

        this.bindCardEvents(actionCard, block);
        containerEl.appendChild(actionCard);
      }
    });
  }

  /**
   * Conecta eventos aos inputs, drag interno, alvo de clique e botões de mover/extrair/remover de cada bloco.
   */
  bindCardEvents(cardEl, block) {
    // 0. Drag & Drop interno do bloco já montado
    cardEl.addEventListener('dragstart', (ev) => {
      ev.stopPropagation();
      if (this.isSpectatorMode || ev.target.closest('input, select, button')) {
        ev.preventDefault();
        return;
      }
      this.draggedBlockId = block.id;
      cardEl.classList.add('is-dragging-block');
      ev.dataTransfer.setData('application/json', JSON.stringify({
        isNew: false,
        blockId: block.id
      }));
      ev.dataTransfer.effectAllowed = 'move';
    });

    cardEl.addEventListener('dragend', (ev) => {
      ev.stopPropagation();
      this.draggedBlockId = null;
      cardEl.classList.remove('is-dragging-block');
      this.clearDropIndicators();
    });

    // 1. Mudança de número
    const numInput = cardEl.querySelector(`.block-input-number[data-id="${block.id}"]`);
    if (numInput) {
      numInput.addEventListener('change', (ev) => {
        this.model.updateBlockValue(block.id, ev.target.value);
        this.updateUI();
        this.notifyBlockChanged();
      });
      numInput.addEventListener('input', (ev) => {
        if (ev.target.value !== '') {
          this.model.updateBlockValue(block.id, ev.target.value);
          this.updateCodeAndSteps();
          this.notifyBlockChanged();
        }
      });
    }

    // 1.1 Mudança de condição no if
    const condSelect = cardEl.querySelector(`.block-select-condition[data-id="${block.id}"]`);
    if (condSelect) {
      const handleCondChange = (ev) => {
        this.model.updateBlockCondition(block.id, ev.target.value);
        this.updateUI();
        this.notifyBlockChanged();
      };
      condSelect.addEventListener('change', handleCondChange);
      condSelect.addEventListener('input', handleCondChange);
    }

    // 1.2 Alvo de inserção por clique em containers (for / if)
    const targetBtn = cardEl.querySelector(`.btn-target-container[data-target-id="${block.id}"]`);
    if (targetBtn) {
      targetBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.activeContainerId = this.activeContainerId === block.id ? null : block.id;
        this.updateUI();
      });
    }

    // 1.3 Botão Extrair do bloco pai (unnest)
    const unnestBtn = cardEl.querySelector(`.btn-unnest-token[data-id="${block.id}"]`);
    if (unnestBtn) {
      unnestBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (this.model.unnestBlock(block.id)) {
          this.updateUI();
          this.notifyBlockChanged();
        }
      });
    }

    // 2. Botão Mover para cima/baixo
    cardEl.querySelectorAll(`.btn-move-token[data-id="${block.id}"]`).forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const action = btn.getAttribute('data-action');
        if (this.model.moveBlock(block.id, action)) {
          this.updateUI();
          this.notifyBlockChanged();
        }
      });
    });

    // 3. Botão Remover
    const removeBtn = cardEl.querySelector(`.btn-remove-token[data-id="${block.id}"]`);
    if (removeBtn) {
      removeBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (this.activeContainerId === block.id || this.model.isDescendant(block.id, this.activeContainerId)) {
          this.activeContainerId = null;
        }
        this.model.removeBlock(block.id);
        this.updateUI();
        this.notifyBlockChanged();
      });
    }
  }

  updateCodeAndSteps() {
    const tree = this.model.evaluateTree();
    this.stepCountBadge.textContent = `${tree.formula} = ${tree.totalSteps} passo(s)`;
    this.pythonCodeEl.innerHTML = this.formatPythonSyntax(this.model.toPythonCode());
    this.updatePythonLockState();
    this.updateTacticalChargesUI();
  }

  setExecuteDisabled(disabled) {
    if (this.executeBtn) {
      this.executeBtn.disabled = disabled;
      if (disabled) {
        this.executeBtn.classList.add('btn-disabled');
      } else {
        this.executeBtn.classList.remove('btn-disabled');
      }
    }
  }

  onExecute(callback) {
    this.onExecuteCallback = callback;
  }

  onUnlockPython(callback) {
    this.onUnlockPythonCallback = callback;
  }

  onBlockChanged(callback) {
    if (typeof callback === 'function') {
      this.blockChangedListeners.push(callback);
    }
  }

  evaluateConditionPreview(condition) {
    const rawRoll = this.gameState ? (this.gameState.lastDiceRoll || this.gameState.lastDiceValue) : 0;

    if (condition === 'dado_par') {
      if (rawRoll <= 0) {
        return { isTrue: false, text: 'Rolar dado p/ avaliar', tooltip: 'Aguardando rolagem do dado' };
      }
      const isTrue = (rawRoll % 2 === 0);
      return {
        isTrue,
        text: isTrue ? `dado=${rawRoll} (PAR) ➔ True (+1 passo)` : `dado=${rawRoll} (ÍMPAR) ➔ False`,
        tooltip: isTrue ? `${rawRoll} % 2 == 0 é Verdadeiro!` : `${rawRoll} % 2 == 1 != 0 (Dica: use dado % 2 != 0)`
      };
    }

    if (condition === 'dado_impar') {
      if (rawRoll <= 0) {
        return { isTrue: false, text: 'Rolar dado p/ avaliar', tooltip: 'Aguardando rolagem do dado' };
      }
      const isTrue = (rawRoll % 2 !== 0);
      return {
        isTrue,
        text: isTrue ? `dado=${rawRoll} (ÍMPAR) ➔ True (+1 passo)` : `dado=${rawRoll} (PAR) ➔ False`,
        tooltip: isTrue ? `${rawRoll} % 2 != 0 é Verdadeiro!` : `${rawRoll} % 2 == 0 (Dica: use dado % 2 == 0)`
      };
    }

    if (condition === 'oponente_a_frente') {
      const botPos = this.gameState ? this.gameState.botPos : 1;
      const playerPos = this.gameState ? this.gameState.playerPos : 1;
      const isTrue = (botPos > playerPos);
      return {
        isTrue,
        text: isTrue ? `Oponente=${botPos} > Você=${playerPos} ➔ True (+1)` : `Oponente atrás ➔ False`,
        tooltip: isTrue ? 'O oponente está à frente na trilha!' : 'O oponente está atrás ou empatado com você.'
      };
    }

    if (condition === 'casa_com_bug') {
      const playerPos = this.gameState ? this.gameState.playerPos : 1;
      const treeSteps = this.model ? this.model.evaluateTree().totalSteps : 0;
      const checkSteps = treeSteps > 0 ? treeSteps : rawRoll;

      if (checkSteps <= 0) {
        return {
          isTrue: false,
          text: 'Rolar dado p/ verificar destino',
          tooltip: 'Verifica se a casa de destino (posição + passos) contém um Bug'
        };
      }

      const maxTile = this.boardModel ? this.boardModel.TOTAL_TILES : 64;
      const targetPos = Math.min(maxTile, playerPos + checkSteps);
      const tile = this.boardModel ? this.boardModel.getTile(targetPos) : null;
      const isTrue = Boolean(tile && (tile.type === 'trap' || tile.type === 'bug'));

      return {
        isTrue,
        text: isTrue ? `Casa ${targetPos} tem Bug! ➔ True (+1)` : `Casa ${targetPos} sem Bug ➔ False`,
        tooltip: isTrue
          ? `A casa ${targetPos} possui uma armadilha (${tile.label})!`
          : `A casa ${targetPos} é livre de bugs.`
      };
    }

    return { isTrue: false, text: 'Condição', tooltip: '' };
  }

  /**
   * Ativa ou desativa o Modo Espectador para exibir a jogada e código do oponente.
   */
  setSpectatorMode(active, data = {}) {
    this.isSpectatorMode = active;
    const containerCard = this.container ? this.container.querySelector('.workspace-card') : null;
    
    if (active) {
      if (containerCard) containerCard.classList.add('workspace-spectator-mode');
      if (this.clearBtn) this.clearBtn.disabled = true;
      if (this.executeBtn) {
        this.executeBtn.disabled = true;
        this.executeBtn.innerHTML = `
          <span class="btn-icon">👁️</span>
          <span class="btn-text">${data.name || 'Oponente'} jogando...</span>
        `;
      }
      
      if (this.spectatorBannerEl) {
        this.spectatorBannerEl.style.display = 'flex';
        if (this.spectatorOpponentNameEl) {
          this.spectatorOpponentNameEl.innerHTML = `${data.avatar || '🤖'} Turno de <strong>${data.name || 'Oponente'}</strong>`;
        }
        if (this.spectatorStatusTextEl) {
          let phaseMsg = 'Aguardando jogada...';
          if (data.phase === 'thinking') phaseMsg = '🧠 Analisando tabuleiro...';
          if (data.phase === 'rolling') phaseMsg = `🎲 Rolou o dado: ${data.roll} passos!`;
          if (data.phase === 'coding') phaseMsg = `⚡ Programando blocos (${data.roll} passos)...`;
          if (data.phase === 'executing') phaseMsg = `✅ Código Compilado (${data.steps || 0} passos)!`;
          this.spectatorStatusTextEl.textContent = phaseMsg;
        }
      }

      if (data.blocks && data.blocks.length > 0) {
        this.dropzoneListEl.innerHTML = '';
        this.dropzoneEmptyEl.style.display = 'none';
        this.renderBlockList(data.blocks, this.dropzoneListEl, 0);
        
        const formula = data.formula || `${data.steps} passos`;
        this.stepCountBadge.textContent = `${data.name || 'Oponente'}: ${formula} = ${data.steps} passo(s)`;
        this.stepCountBadge.className = 'badge-step-count badge-opponent-step';
      } else if (data.phase === 'thinking' || data.phase === 'rolling' || data.phase === 'coding') {
        this.dropzoneListEl.innerHTML = `
          <div class="spectator-thinking-box">
            <div class="spectator-spinner"></div>
            <span>${data.name || 'Oponente'} está montando sua estratégia de código...</span>
          </div>
        `;
        this.dropzoneEmptyEl.style.display = 'none';
        this.stepCountBadge.textContent = `${data.name || 'Oponente'}: pensando...`;
        this.stepCountBadge.className = 'badge-step-count badge-opponent-step';
      }

      if (data.code) {
        this.pythonCodeEl.innerHTML = this.formatPythonSyntax(`# 👁️ Código compilado por ${data.name || 'Oponente'}:\n${data.code}`);
      } else if (data.phase === 'thinking' || data.phase === 'rolling' || data.phase === 'coding') {
        this.pythonCodeEl.innerHTML = this.formatPythonSyntax(`# Aguardando ${data.name || 'Oponente'} compilar seu script em Python...`);
      }
      this.updatePythonLockState();
    } else {
      this.activeContainerId = null;
      if (containerCard) containerCard.classList.remove('workspace-spectator-mode');
      if (this.spectatorBannerEl) this.spectatorBannerEl.style.display = 'none';
      if (this.clearBtn) this.clearBtn.disabled = false;
      if (this.executeBtn) {
        this.executeBtn.disabled = false;
        this.executeBtn.innerHTML = `
          <span class="btn-icon">⚡</span>
          <span class="btn-text">Executar Código</span>
        `;
      }
      this.stepCountBadge.className = 'badge-step-count';
      this.updateUI();
    }
  }
}
