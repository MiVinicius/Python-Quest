/**
 * ChallengeModalView.js
 * Modal de Desafio Time Attack com contagem regressiva,
 * formatação de código Python, botões de alternativa e feedback explicativo.
 */
export class ChallengeModalView {
  constructor() {
    this.modalOverlay = null;
    this.timerBar = null;
    this.timerText = null;
    this.questionTitle = null;
    this.codeBlock = null;
    this.optionsContainer = null;
    this.feedbackArea = null;
    this.closeBtn = null;
    
    this.timerInterval = null;
    this.timeLeft = 25;
    this.totalTime = 25;
    this.timeExtendedThisChallenge = false;
    this.extendCost = 10;

    this.onAnswerCallback = null;
    this.onTimeoutCallback = null;
    this.onCloseCallback = null;
    this.onExtendTimeCallback = null;

    this.render();
  }

  /**
   * Aplica Syntax Highlighting seguro em passada única ao trecho de código Python do desafio.
   */
  formatPythonSyntax(rawCode = '') {
    const escapeHtml = (str) => String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const keywords = new Set([
      'def', 'class', 'return', 'yield', 'for', 'in', 'while', 'if', 'elif', 'else',
      'break', 'continue', 'pass', 'try', 'except', 'finally', 'and', 'or', 'not',
      'nonlocal', 'global', 'lambda', 'as', 'from', 'import', 'with', 'is',
      'True', 'False', 'None'
    ]);
    const builtins = new Set([
      'print', 'len', 'range', 'int', 'str', 'float', 'bool', 'list', 'dict',
      'set', 'tuple', 'zip', 'sorted', 'enumerate', 'all', 'any', 'next', 'type'
    ]);

    const tokenRegex = /(#.*$)|([frbFRB]?(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"))|(@[A-Za-z_]\w*)|(\.[A-Za-z_]\w*)|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_]\w*\b)/g;

    return String(rawCode)
      .split('\n')
      .map((line) => {
        let out = '';
        let lastIndex = 0;
        tokenRegex.lastIndex = 0;
        let m;
        while ((m = tokenRegex.exec(line)) !== null) {
          if (m.index > lastIndex) {
            out += escapeHtml(line.slice(lastIndex, m.index));
          }
          const [, comment, str, dec, method, num, ident] = m;
          if (comment) {
            out += `<span class="py-comment">${escapeHtml(comment)}</span>`;
          } else if (str) {
            out += `<span class="py-str">${escapeHtml(str)}</span>`;
          } else if (dec) {
            out += `<span class="py-dec">${escapeHtml(dec)}</span>`;
          } else if (method) {
            out += `.<span class="py-fn">${escapeHtml(method.slice(1))}</span>`;
          } else if (num) {
            out += `<span class="py-num">${escapeHtml(num)}</span>`;
          } else if (ident) {
            if (keywords.has(ident)) {
              out += `<span class="py-kw">${escapeHtml(ident)}</span>`;
            } else if (/^[A-Z]\w*Error$/.test(ident) || ident === 'StopIteration' || ident === 'Exception') {
              out += `<span class="py-exc">${escapeHtml(ident)}</span>`;
            } else if (builtins.has(ident) && /^\s*\(/.test(line.slice(tokenRegex.lastIndex))) {
              out += `<span class="py-builtin">${escapeHtml(ident)}</span>`;
            } else {
              out += escapeHtml(ident);
            }
          }
          lastIndex = tokenRegex.lastIndex;
        }
        if (lastIndex < line.length) {
          out += escapeHtml(line.slice(lastIndex));
        }
        return out;
      })
      .join('\n');
  }

  render() {
    let modal = document.getElementById('challengeModalOverlay');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'challengeModalOverlay';
      modal.className = 'modal-overlay hidden';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="modal-card challenge-card">
        <div class="modal-header">
          <div class="modal-title-group">
            <span class="modal-icon">⚡</span>
            <div>
              <h2 class="modal-title">Desafio Python - Time Attack!</h2>
              <span id="challengeMetaBadge" class="badge-meta">Categoria: Geral | Fácil</span>
            </div>
          </div>
          <div class="timer-controls-group">
            <button type="button" id="challengeExtendTimeBtn" class="btn-extend-time" title="Comprar +15 segundos neste desafio usando moedas">
              ⏱️ +15s (🪙 10)
            </button>
            <div class="timer-box" id="challengeTimerBox">
              <span class="timer-icon">⏱️</span>
              <span id="challengeTimerText" class="timer-digits">25s</span>
            </div>
          </div>
        </div>

        <div class="timer-progress-container">
          <div id="challengeTimerBar" class="timer-bar" style="width: 100%;"></div>
        </div>

        <div class="modal-body">
          <p id="challengeQuestionText" class="question-text">Carregando pergunta...</p>
          
          <pre id="challengeCodePre" class="code-box"><code id="challengeCodeBlock"></code></pre>

          <div id="challengeOptionsList" class="options-grid"></div>

          <div id="challengeFeedback" class="challenge-feedback hidden">
            <div id="feedbackIcon" class="feedback-icon"></div>
            <div class="feedback-content">
              <h4 id="feedbackTitle" class="feedback-title"></h4>
              <p id="feedbackExplanation" class="feedback-desc"></p>
              <span id="feedbackAuthor" class="feedback-author"></span>
            </div>
            <button id="challengeContinueBtn" class="btn-primary btn-sm">Continuar Corrida ⏩</button>
          </div>
        </div>
      </div>
    `;

    this.modalOverlay = modal;
    this.timerBar = document.getElementById('challengeTimerBar');
    this.timerBox = document.getElementById('challengeTimerBox');
    this.timerText = document.getElementById('challengeTimerText');
    this.extendTimeBtn = document.getElementById('challengeExtendTimeBtn');
    this.questionTitle = document.getElementById('challengeQuestionText');
    this.metaBadge = document.getElementById('challengeMetaBadge');
    this.codeBlock = document.getElementById('challengeCodeBlock');
    this.codePre = document.getElementById('challengeCodePre');
    this.optionsContainer = document.getElementById('challengeOptionsList');
    this.feedbackArea = document.getElementById('challengeFeedback');
    this.feedbackIcon = document.getElementById('feedbackIcon');
    this.feedbackTitle = document.getElementById('feedbackTitle');
    this.feedbackDesc = document.getElementById('feedbackExplanation');
    this.feedbackAuthor = document.getElementById('feedbackAuthor');
    this.continueBtn = document.getElementById('challengeContinueBtn');

    this.continueBtn.addEventListener('click', () => {
      this.close();
      if (this.onCloseCallback) this.onCloseCallback();
    });

    if (this.extendTimeBtn) {
      this.extendTimeBtn.addEventListener('click', () => {
        if (this.timeExtendedThisChallenge || this.extendTimeBtn.disabled) return;
        if (this.onExtendTimeCallback) {
          this.onExtendTimeCallback();
        }
      });
    }
  }

  show(challenge, durationSeconds = 25, options = {}) {
    if (!this.modalOverlay) return;

    this.totalTime = durationSeconds;
    this.timeLeft = durationSeconds;
    this.timeExtendedThisChallenge = false;
    this.extendCost = options.extendCost ?? 10;
    const coins = options.coins ?? 0;

    this.feedbackArea.classList.add('hidden');
    this.continueBtn.classList.add('hidden');
    this.optionsContainer.innerHTML = '';

    if (this.extendTimeBtn) {
      this.extendTimeBtn.classList.remove('hidden', 'is-used');
      if (coins >= this.extendCost) {
        this.extendTimeBtn.disabled = false;
        this.extendTimeBtn.textContent = `⏱️ +15s (🪙 ${this.extendCost})`;
        this.extendTimeBtn.title = `Adicionar +15 segundos neste desafio por ${this.extendCost} moedas`;
      } else {
        this.extendTimeBtn.disabled = true;
        this.extendTimeBtn.textContent = `⏱️ +15s (${coins}/${this.extendCost} 🪙)`;
        this.extendTimeBtn.title = `Saldo insuficiente: você precisa de ${this.extendCost} moedas`;
      }
    }

    this.metaBadge.textContent = `${challenge.categoria || 'Geral'} • Dificuldade: ${challenge.dificuldade || 'Média'}`;
    this.questionTitle.textContent = challenge.pergunta;

    if (challenge.codigo && challenge.codigo.trim() !== '') {
      this.codePre.style.display = 'block';
      this.codeBlock.innerHTML = this.formatPythonSyntax(challenge.codigo);
    } else {
      this.codePre.style.display = 'none';
    }

    const letters = ['A', 'B', 'C', 'D'];
    challenge.opcoes.forEach((opcao, idx) => {
      const btn = document.createElement('button');
      btn.className = 'option-btn';
      btn.innerHTML = `
        <span class="option-letter">${letters[idx] || (idx + 1)}</span>
        <span class="option-text">${opcao}</span>
      `;
      btn.addEventListener('click', () => {
        this.stopTimer();
        if (this.onAnswerCallback) {
          this.onAnswerCallback(idx);
        }
      });
      this.optionsContainer.appendChild(btn);
    });

    this.modalOverlay.classList.remove('hidden');
    this.startTimer();
  }

  startTimer() {
    this.stopTimer();
    this.updateTimerDisplay();

    this.timerInterval = setInterval(() => {
      this.timeLeft -= 1;
      this.updateTimerDisplay();

      if (this.timeLeft <= 0) {
        this.stopTimer();
        if (this.onTimeoutCallback) {
          this.onTimeoutCallback();
        }
      }
    }, 1000);
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  updateTimerDisplay() {
    const percentage = Math.max(0, (this.timeLeft / this.totalTime) * 100);
    this.timerBar.style.width = `${percentage}%`;
    this.timerText.textContent = `${this.timeLeft}s`;

    if (this.timeLeft <= 5) {
      this.timerBar.style.backgroundColor = 'var(--color-danger)';
      this.timerText.classList.add('pulse-urgent');
    } else {
      this.timerBar.style.backgroundColor = 'var(--color-warning)';
      this.timerText.classList.remove('pulse-urgent');
    }
  }

  addTime(extraSeconds = 15) {
    this.timeLeft += extraSeconds;
    this.totalTime = Math.max(this.totalTime, this.timeLeft);
    this.timeExtendedThisChallenge = true;

    if (this.extendTimeBtn) {
      this.extendTimeBtn.disabled = true;
      this.extendTimeBtn.classList.add('is-used');
      this.extendTimeBtn.textContent = `✓ +${extraSeconds}s usado`;
    }

    this.updateTimerDisplay();

    if (this.timerBox) {
      this.timerBox.classList.add('pulse-time-added');
      setTimeout(() => this.timerBox.classList.remove('pulse-time-added'), 650);
    }
  }

  displayFeedback(result) {
    this.stopTimer();
    if (this.extendTimeBtn) {
      this.extendTimeBtn.classList.add('hidden');
    }
    
    // Desabilita as opções e marca claramente a correta e a escolha incorreta do estudante
    const buttons = this.optionsContainer.querySelectorAll('.option-btn');
    buttons.forEach((btn, idx) => {
      btn.disabled = true;
      if (idx === result.correctIndex) {
        btn.classList.add('option-correct');
        const tag = document.createElement('span');
        tag.className = 'option-result-tag tag-correct';
        tag.textContent = '✔ Correta';
        btn.appendChild(tag);
      } else if (!result.correct && !result.timeout && idx === result.selectedIndex) {
        btn.classList.add('option-wrong');
        const tag = document.createElement('span');
        tag.className = 'option-result-tag tag-wrong';
        tag.textContent = '✖ Sua resposta';
        btn.appendChild(tag);
      } else {
        btn.classList.add('option-disabled');
      }
    });

    this.feedbackArea.classList.remove('hidden');
    this.continueBtn.classList.remove('hidden');

    if (result.correct) {
      this.feedbackArea.className = 'challenge-feedback feedback-success';
      this.feedbackIcon.textContent = '🎉';
      const coinsMsg = result.coinsEarned ? ` (+${result.coinsEarned} 🪙)` : '';
      this.feedbackTitle.textContent = `Resposta Correta! Boost Ativado${coinsMsg}!`;
    } else {
      this.feedbackArea.className = 'challenge-feedback feedback-error';
      this.feedbackIcon.textContent = '⚠️';
      if (result.timeout) {
        this.feedbackTitle.textContent = 'Tempo Esgotado!';
      } else if (result.freePythonUnlockGranted) {
        this.feedbackTitle.textContent = 'Resposta Incorreta! (+1 Tradução Python Grátis 🎁)';
      } else {
        this.feedbackTitle.textContent = 'Resposta Incorreta!';
      }
    }

    const baseExplanation = result.explanation || '';
    const bonusNote = result.freePythonUnlockGranted
      ? ' Bônus de apoio: a Tradução em Python ficará grátis no seu próximo turno!'
      : '';
    this.feedbackDesc.textContent = `${baseExplanation}${bonusNote}`;
    this.feedbackAuthor.textContent = result.author ? `Contribuição de: ${result.author}` : '';
  }

  close() {
    this.stopTimer();
    if (this.modalOverlay) {
      this.modalOverlay.classList.add('hidden');
    }
  }

  onAnswer(cb) {
    this.onAnswerCallback = cb;
  }

  onTimeout(cb) {
    this.onTimeoutCallback = cb;
  }

  onClose(cb) {
    this.onCloseCallback = cb;
  }

  onExtendTime(cb) {
    this.onExtendTimeCallback = cb;
  }
}
