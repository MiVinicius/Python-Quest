/**
 * TutorialView.js
 * Sistema de Tutorial Interativo Guiado diretamente na interface da Arena de Jogo.
 * - Exibe caixa inicial perguntando se o jogador deseja fazer o tutorial (Sim / Não).
 * - Caso escolha "Sim", conduz o jogador por 4 etapas práticas obrigatórias nos elementos reais da UI:
 *   1. Rolar o Dado (#rollDiceBtn)
 *   2. Montar os Blocos até atingir a energia exata do dado (#paletteBlocks / #workspaceDropzone)
 *   3. Inspecionar a Tradução em Python e as regras das casas especiais (.python-preview-section)
 *   4. Executar o Código (#executeCodeBtn) e ver o peão andar no tabuleiro.
 */
export class TutorialView {
  constructor() {
    this.isActive = false;
    this.currentStep = 0;
    this.promptOverlayEl = null;
    this.guideBannerEl = null;
    this.onConfirmStep3Callback = null;
    this.onSkipCallback = null;

    this.createDomElements();
  }

  createDomElements() {
    // 1. Caixa de Diálogo Inicial (Sim / Não)
    let promptEl = document.getElementById('tutorialPromptOverlay');
    if (!promptEl) {
      promptEl = document.createElement('div');
      promptEl.id = 'tutorialPromptOverlay';
      promptEl.className = 'tutorial-prompt-overlay hidden';
      promptEl.innerHTML = `
        <div class="tutorial-prompt-card" role="dialog" aria-modal="true" aria-labelledby="tutorialPromptTitle">
          <div class="tutorial-prompt-badge">🎓 Guia Interativo na Prática</div>
          <h2 id="tutorialPromptTitle" class="tutorial-prompt-title">Deseja fazer o tutorial antes de jogar?</h2>
          <p class="tutorial-prompt-desc">
            Aprenda rapidamente na própria tela do jogo, passo a passo, como rolar o dado, montar os blocos em Python e mover seu peão pela trilha.
          </p>
          <div class="tutorial-prompt-actions">
            <button type="button" id="btnTutorialYes" class="btn-success tutorial-btn-choice">
              ✅ Sim, fazer o tutorial
            </button>
            <button type="button" id="btnTutorialNo" class="btn-ghost tutorial-btn-choice">
              ❌ Não, jogar direto
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(promptEl);
    }
    this.promptOverlayEl = promptEl;

    // 2. Painel Guiado de Etapas (Flutuante na Arena)
    let guideEl = document.getElementById('tutorialGuideBanner');
    if (!guideEl) {
      guideEl = document.createElement('div');
      guideEl.id = 'tutorialGuideBanner';
      guideEl.className = 'tutorial-guide-banner hidden';
      guideEl.innerHTML = `
        <div class="tutorial-guide-header">
          <div class="tutorial-guide-step-indicator">
            <span class="tutorial-step-pill" id="tutorialStepPill">ETAPA 1 DE 4</span>
            <div class="tutorial-dots" id="tutorialDots">
              <span class="tut-dot active"></span>
              <span class="tut-dot"></span>
              <span class="tut-dot"></span>
              <span class="tut-dot"></span>
            </div>
          </div>
          <button type="button" id="btnTutorialSkip" class="tutorial-skip-btn" title="Encerrar tutorial e jogar livremente">
            Pular Tutorial ✖
          </button>
        </div>

        <div class="tutorial-guide-body">
          <h3 class="tutorial-guide-title" id="tutorialGuideTitle">Título da Etapa</h3>
          <p class="tutorial-guide-text" id="tutorialGuideText">Instrução da etapa...</p>
          <div class="tutorial-guide-task" id="tutorialGuideTask"></div>
        </div>

        <div class="tutorial-guide-footer hidden" id="tutorialGuideFooter">
          <button type="button" id="btnTutorialNextStep" class="btn-success btn-sm">
            ✅ Entendi! Continuar ➔
          </button>
        </div>
      `;
      document.body.appendChild(guideEl);
    }
    this.guideBannerEl = guideEl;

    // Eventos fixos
    document.getElementById('btnTutorialSkip')?.addEventListener('click', () => {
      const skipCb = this.onSkipCallback;
      this.stop();
      if (skipCb) skipCb();
    });

    document.getElementById('btnTutorialNextStep')?.addEventListener('click', () => {
      if (this.onConfirmStep3Callback) {
        this.onConfirmStep3Callback();
      }
    });
  }

  /**
   * Exibe a pergunta inicial (Sim / Não) antes de começar a partida.
   */
  promptTutorial({ onAccept, onDecline }) {
    this.stop();
    if (!this.promptOverlayEl) return;

    this.promptOverlayEl.classList.remove('hidden');

    const btnYes = document.getElementById('btnTutorialYes');
    const btnNo = document.getElementById('btnTutorialNo');

    const cleanupPrompt = () => {
      this.promptOverlayEl.classList.add('hidden');
      btnYes?.replaceWith(btnYes.cloneNode(true));
      btnNo?.replaceWith(btnNo.cloneNode(true));
    };

    document.getElementById('btnTutorialYes')?.addEventListener('click', () => {
      cleanupPrompt();
      if (onAccept) onAccept();
    });

    document.getElementById('btnTutorialNo')?.addEventListener('click', () => {
      cleanupPrompt();
      if (onDecline) onDecline();
    });
  }

  /**
   * Inicia o modo tutorial guiado na Etapa 1.
   */
  start({ onSkip, onStep3Confirmed } = {}) {
    this.isActive = true;
    this.onSkipCallback = onSkip || null;
    this.onConfirmStep3Callback = onStep3Confirmed || null;
    if (this.promptOverlayEl) this.promptOverlayEl.classList.add('hidden');
    if (this.guideBannerEl) this.guideBannerEl.classList.remove('hidden');
    this.showStep1();
  }

  stop() {
    this.isActive = false;
    this.currentStep = 0;
    this.clearHighlights();
    if (this.promptOverlayEl) this.promptOverlayEl.classList.add('hidden');
    if (this.guideBannerEl) this.guideBannerEl.classList.add('hidden');
  }

  clearHighlights() {
    document.querySelectorAll('.tutorial-highlight-target').forEach(el => {
      el.classList.remove('tutorial-highlight-target');
    });
  }

  highlightElements(selectors = []) {
    this.clearHighlights();
    selectors.forEach((sel) => {
      const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
      if (el) {
        el.classList.add('tutorial-highlight-target');
      }
    });
  }

  /**
   * Alterna a posição da janela do tutorial conforme a etapa e verifica
   * geometricamente se há sobreposição com o elemento a interagir.
   */
  setBannerPosition(preferredClass, targetSelectors = []) {
    if (!this.guideBannerEl) return;
    const posClasses = [
      'tut-pos-bottom-left',
      'tut-pos-top-left',
      'tut-pos-top-center',
      'tut-pos-bottom-center'
    ];
    this.guideBannerEl.classList.remove(...posClasses);
    this.guideBannerEl.classList.add(preferredClass);

    requestAnimationFrame(() => {
      if (!this.guideBannerEl || this.guideBannerEl.classList.contains('hidden')) return;
      const targets = targetSelectors
        .map(s => (typeof s === 'string' ? document.querySelector(s) : s))
        .filter(Boolean);
      if (!targets.length) return;

      const overlapsAny = () => {
        const bRect = this.guideBannerEl.getBoundingClientRect();
        return targets.some(t => {
          const r = t.getBoundingClientRect();
          return !(
            bRect.right < r.left - 8 ||
            bRect.left > r.right + 8 ||
            bRect.bottom < r.top - 8 ||
            bRect.top > r.bottom + 8
          );
        });
      };

      if (overlapsAny()) {
        for (const altClass of posClasses) {
          if (altClass === preferredClass) continue;
          this.guideBannerEl.classList.remove(...posClasses);
          this.guideBannerEl.classList.add(altClass);
          if (!overlapsAny()) break;
        }
      }
    });
  }

  updateDots(stepNumber) {
    const pill = document.getElementById('tutorialStepPill');
    if (pill) {
      pill.textContent = stepNumber <= 4 ? `🎓 TUTORIAL • ETAPA ${stepNumber} DE 4` : '🎉 TUTORIAL CONCLUÍDO';
    }
    const dots = this.guideBannerEl?.querySelectorAll('.tut-dot') || [];
    dots.forEach((dot, idx) => {
      dot.classList.toggle('done', idx + 1 < stepNumber);
      dot.classList.toggle('active', idx + 1 === stepNumber);
    });
  }

  /**
   * ETAPA 1: Rolar o Dado
   */
  showStep1() {
    this.currentStep = 1;
    this.updateDots(1);
    const targets = ['#rollDiceBtn', '#diceContainer'];
    this.highlightElements(targets);
    this.setBannerPosition('tut-pos-bottom-left', targets);

    const titleEl = document.getElementById('tutorialGuideTitle');
    const textEl = document.getElementById('tutorialGuideText');
    const taskEl = document.getElementById('tutorialGuideTask');
    const footerEl = document.getElementById('tutorialGuideFooter');

    if (titleEl) titleEl.textContent = '1. Gere sua Energia no Dado';
    if (textEl) {
      textEl.innerHTML = 'Todo turno começa sorteando o <strong>Dado D6</strong>. O valor obtido define exatamente quantos passos seu algoritmo precisará executar.';
    }
    if (taskEl) {
      taskEl.innerHTML = '👉 <strong>Tarefa obrigatória:</strong> Clique no botão brilhante <strong>🎲 Rolar Dado</strong> no painel à direita.';
    }
    if (footerEl) footerEl.classList.add('hidden');

    const rollBtn = document.getElementById('rollDiceBtn');
    rollBtn?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /**
   * ETAPA 2: Montar Blocos até bater com o valor do dado
   */
  showStep2(targetSteps, currentSteps = 0) {
    this.currentStep = 2;
    this.updateDots(2);
    const targets = ['#paletteBlocks', '#workspaceDropzone'];
    this.highlightElements(targets);
    this.setBannerPosition('tut-pos-top-left', targets);

    const titleEl = document.getElementById('tutorialGuideTitle');
    const textEl = document.getElementById('tutorialGuideText');
    const taskEl = document.getElementById('tutorialGuideTask');
    const footerEl = document.getElementById('tutorialGuideFooter');

    if (titleEl) titleEl.textContent = `2. Programe ${targetSteps} Passo(s) com Blocos`;
    if (textEl) {
      textEl.innerHTML = `O dado gerou <strong>${targetSteps} passo(s)</strong>! Clique ou arraste blocos da <strong>Paleta de Blocos</strong> (como <strong>➡️ Avançar</strong>, <strong>🦘 Pular</strong> ou <strong>🔁 Loop for</strong>) e ajuste os números dentro dos parênteses.`;
    }
    if (taskEl) {
      const diff = targetSteps - currentSteps;
      const statusBadge = diff === 0
        ? `<span class="tut-status-ok">✅ ${currentSteps}/${targetSteps} passos prontos!</span>`
        : `<span class="tut-status-pending">⏳ Atual: ${currentSteps} de ${targetSteps} passo(s) ${diff > 0 ? `(faltam ${diff})` : `(remova ${Math.abs(diff)})`}</span>`;
      taskEl.innerHTML = `👉 <strong>Tarefa obrigatória:</strong> Monte blocos na Linha de Execução até somar exatamente <strong>${targetSteps} passo(s)</strong>. ${statusBadge}`;
    }
    if (footerEl) footerEl.classList.add('hidden');
  }

  /**
   * ETAPA 3: Inspecionar Código Python e Casas do Tabuleiro
   */
  showStep3(pythonCodeSample = '') {
    this.currentStep = 3;
    this.updateDots(3);
    const targets = ['.python-preview-section'];
    this.highlightElements(targets);
    this.setBannerPosition('tut-pos-bottom-left', targets);

    const titleEl = document.getElementById('tutorialGuideTitle');
    const textEl = document.getElementById('tutorialGuideText');
    const taskEl = document.getElementById('tutorialGuideTask');
    const footerEl = document.getElementById('tutorialGuideFooter');
    const nextBtn = document.getElementById('btnTutorialNextStep');

    if (titleEl) titleEl.textContent = '3. Tradução em Python & Regras da Trilha';
    if (textEl) {
      textEl.innerHTML = `Veja na caixa destacada como seus blocos viraram <strong>código Python real</strong>! Durante a corrida, fique atento às casas do tabuleiro: <strong>⚡ Atalhos</strong> avançam casas extras, <strong>🐛 Bugs</strong> recuam (use <strong>🦘 Pular</strong> ou <strong>🛡️ Escudo try/except</strong> para evitá-los) e <strong>❓ Desafios</strong> dão bônus ao acertar perguntas de Python.`;
    }
    if (taskEl) {
      taskEl.innerHTML = `👉 <strong>Tarefa obrigatória:</strong> Confira seu código no terminal <em>🐍 Tradução em Python</em> e clique no botão abaixo para liberar a execução.`;
    }
    if (nextBtn) {
      nextBtn.textContent = '✅ Conferi o código! Liberar Execução ➔';
    }
    if (footerEl) footerEl.classList.remove('hidden');

    document.querySelector('.python-preview-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /**
   * ETAPA 4: Clicar em Executar Código
   */
  showStep4() {
    this.currentStep = 4;
    this.updateDots(4);
    const targets = ['#executeCodeBtn'];
    this.highlightElements(targets);
    this.setBannerPosition('tut-pos-top-left', targets);

    const titleEl = document.getElementById('tutorialGuideTitle');
    const textEl = document.getElementById('tutorialGuideText');
    const taskEl = document.getElementById('tutorialGuideTask');
    const footerEl = document.getElementById('tutorialGuideFooter');

    if (titleEl) titleEl.textContent = '4. Execute seu Algoritmo!';
    if (textEl) {
      textEl.innerHTML = 'Seu algoritmo está validado e pronto para rodar! Ao executar, seu peão caminhará pela trilha seguindo as instruções que você montou.';
    }
    if (taskEl) {
      taskEl.innerHTML = '👉 <strong>Tarefa final:</strong> Clique no botão verde <strong>⚡ Executar Código</strong> para concluir o tutorial e mover seu peão!';
    }
    if (footerEl) footerEl.classList.add('hidden');

    document.getElementById('executeCodeBtn')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /**
   * Exibe mensagem rápida de conclusão após o peão se mover na Etapa 4.
   */
  showCompletedBanner() {
    this.clearHighlights();
    this.currentStep = 5;
    this.updateDots(5);
    this.setBannerPosition('tut-pos-bottom-center', []);

    const titleEl = document.getElementById('tutorialGuideTitle');
    const textEl = document.getElementById('tutorialGuideText');
    const taskEl = document.getElementById('tutorialGuideTask');
    const footerEl = document.getElementById('tutorialGuideFooter');
    const nextBtn = document.getElementById('btnTutorialNextStep');

    if (titleEl) titleEl.textContent = '🎉 Tutorial Concluído com Sucesso!';
    if (textEl) {
      textEl.innerHTML = 'Você dominou todas as etapas! Agora continue jogando normalmente contra o oponente até alcançar a casa final.';
    }
    if (taskEl) {
      taskEl.innerHTML = '💡 Dica: Você pode rever este tutorial a qualquer momento clicando no botão <strong>🎓 Tutorial</strong> no topo da tela.';
    }
    if (nextBtn) {
      nextBtn.textContent = '🚀 Continuar Jogando';
    }
    if (footerEl) footerEl.classList.remove('hidden');

    this.onConfirmStep3Callback = () => {
      this.stop();
    };
  }
}
