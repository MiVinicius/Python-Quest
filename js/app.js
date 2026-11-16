/**
 * app.js
 * Ponto de entrada da aplicação Python Quest.
 * Inicializa Models, Views, Controllers e dispara o loop principal.
 */
import { GameStateModel } from './models/GameStateModel.js';
import { BoardModel } from './models/BoardModel.js';
import { DiceModel } from './models/DiceModel.js';
import { BlockProgramModel } from './models/BlockProgramModel.js';
import { BotModel } from './models/BotModel.js';
import { ChallengeModel } from './models/ChallengeModel.js';
import { UserProfileModel } from './models/UserProfileModel.js';
import { OnlineMultiplayerModel } from './models/OnlineMultiplayerModel.js';

import { BoardView } from './views/BoardView.js';
import { DiceView } from './views/DiceView.js';
import { BlockWorkspaceView } from './views/BlockWorkspaceView.js';
import { ChallengeModalView } from './views/ChallengeModalView.js';
import { ChallengeCardsView } from './views/ChallengeCardsView.js';
import { StatusPanelView } from './views/StatusPanelView.js';
import { SoundView } from './views/SoundView.js';
import { HomeView } from './views/HomeView.js?v=0.4.0';
import { TutorialView } from './views/TutorialView.js?v=0.4.0';

import { CodingController } from './controllers/CodingController.js';
import { ChallengeController } from './controllers/ChallengeController.js';
import { GameController } from './controllers/GameController.js';

document.addEventListener('DOMContentLoaded', () => {
  // 1. Instanciação dos Models
  const userProfile = new UserProfileModel();
  const onlineModel = new OnlineMultiplayerModel();
  const gameState = new GameStateModel();
  const boardModel = new BoardModel();
  const diceModel = new DiceModel();
  const blockModel = new BlockProgramModel();
  const botModel = new BotModel('normal');
  const challengeModel = new ChallengeModel();

  // 2. Instanciação das Views
  const soundView = new SoundView();
  const homeView = new HomeView(userProfile);
  const boardView = new BoardView('boardContainer', boardModel);
  const diceView = new DiceView('diceContainer');
  const workspaceView = new BlockWorkspaceView('workspaceContainer', blockModel, gameState, boardModel);
  const challengeView = new ChallengeModalView();
  const cardsView = new ChallengeCardsView('challengeCardsModal');
  const statusView = new StatusPanelView();
  const tutorialView = new TutorialView();

  // 3. Instanciação dos Sub-Controllers
  const codingController = new CodingController(
    blockModel,
    workspaceView,
    diceModel,
    gameState,
    soundView
  );

  const challengeController = new ChallengeController(
    challengeModel,
    challengeView,
    cardsView,
    gameState,
    soundView,
    statusView,
    userProfile
  );

  // 4. Instanciação e Inicialização do Controller Principal
  const gameController = new GameController({
    gameState,
    boardModel,
    diceModel,
    blockModel,
    botModel,
    challengeModel,
    userProfileModel: userProfile,
    onlineModel,
    boardView,
    diceView,
    workspaceView,
    challengeView,
    statusView,
    soundView,
    homeView,
    tutorialView,
    codingController,
    challengeController
  });

  gameController.init();

  // Ouvinte único de conexão de oponente no lobby (para Salas Criadas e Partida Rápida)
  onlineModel.onStateChange((event) => {
    if (event.type === 'OPPONENT_CONNECTED' && event.room) {
      homeView.resetQuickMatchUI();
      homeView.closeModal('modalMultiplayer');
      homeView.showGameArena();
      gameController.startOnlineGame(
        event.room.code,
        'host',
        event.room.host,
        event.room.guest
      );
    }
  });

  // 5. Conexão das Ações da Tela Inicial (Home Hub)
  homeView.onStartDemo(() => {
    gameController.startDemoGame();
  });

  homeView.onStartSolo(() => {
    gameController.startSoloGame();
  });

  homeView.onStartMultiplayer(async (data) => {
    if (data.action === 'cancel_quickmatch') {
      onlineModel.cancelQuickMatch();
      return;
    }

    if (data.action === 'quickmatch') {
      try {
        const result = await onlineModel.startQuickMatch(userProfile.data);
        if (!result) return;

        if (result.mode === 'matched_as_guest' && result.room) {
          homeView.resetQuickMatchUI();
          homeView.closeModal('modalMultiplayer');
          homeView.showGameArena();
          gameController.startOnlineGame(
            result.roomCode,
            'guest',
            result.room.host,
            result.room.guest
          );
        } else if (result.mode === 'waiting_as_host') {
          homeView.setLobbyRoomCode(result.roomCode);
        }
      } catch (err) {
        console.error('Erro na Partida Rápida:', err);
        homeView.resetQuickMatchUI();
      }
      return;
    }

    if (data.action === 'create') {
      try {
        const room = await onlineModel.createRoom(userProfile.data);
        homeView.setLobbyRoomCode(room.code);
      } catch (err) {
        console.error('Erro ao criar sala:', err);
        alert('Erro ao criar sala multiplayer.');
      }
    } else if (data.action === 'join') {
      try {
        const result = await onlineModel.joinRoom(data.roomCode, userProfile.data);
        if (result.success) {
          homeView.closeModal('modalMultiplayer');
          homeView.showGameArena();
          gameController.startOnlineGame(data.roomCode, 'guest', result.room.host, result.room.guest);
        } else {
          alert(result.message || 'Código de sala inválido ou não encontrado.');
          homeView.resetJoinButton();
        }
      } catch (err) {
        console.error('Erro ao entrar na sala:', err);
        alert('Erro ao conectar à sala multiplayer.');
        homeView.resetJoinButton();
      }
    }
  });

  // Configurações globais da barra de ferramentas (Áudio Mute, Dificuldade, etc.)
  const soundToggleBtn = document.getElementById('soundToggleBtn');
  if (soundToggleBtn) {
    soundToggleBtn.addEventListener('click', () => {
      const isMuted = soundView.toggleMute();
      soundToggleBtn.textContent = isMuted ? '🔇 Mudo' : '🔊 Som';
    });
  }

  const restartTopBtn = document.getElementById('restartTopBtn');
  if (restartTopBtn) {
    restartTopBtn.addEventListener('click', () => {
      if (confirm('Deseja reiniciar a corrida do início?')) {
        gameController.restartGame();
      }
    });
  }

  const difficultySelect = document.getElementById('difficultySelect');
  if (difficultySelect) {
    const difficultyLabels = {
      easy: 'Dificuldade: Iniciante',
      normal: 'Dificuldade: Equilibrada',
      hard: 'Dificuldade: Mestre'
    };

    const syncDifficultyMarkers = (selectedVal) => {
      Array.from(difficultySelect.options).forEach((opt) => {
        const baseLabel = difficultyLabels[opt.value] || opt.textContent.replace(/^✓\s*/, '');
        opt.textContent = opt.value === selectedVal ? `✓ ${baseLabel}` : baseLabel;
      });
    };

    syncDifficultyMarkers(difficultySelect.value);

    difficultySelect.addEventListener('change', (e) => {
      const val = e.target.value;
      syncDifficultyMarkers(val);
      botModel.setDifficulty(val);
      gameState.addLog('Config', `Dificuldade da CPU ajustada para: ${val.toUpperCase()}`, 'info');
    });
  }

  // Desbloqueia contexto de áudio no primeiro clique do usuário
  document.body.addEventListener('click', () => {
    soundView.init();
  }, { once: true });

  // Controle de acessibilidade: Tamanho da Fonte (IHM)
  const FONT_SCALE_KEY = 'python_quest_font_scale_v2';
  const DEFAULT_SCALE = 100;
  const MIN_SCALE = 90;
  const MAX_SCALE = 140;
  const STEP_SCALE = 10;

  const btnFontDecrease = document.getElementById('btnFontDecrease');
  const btnFontIncrease = document.getElementById('btnFontIncrease');
  const btnFontReset = document.getElementById('btnFontReset');

  const clampScale = (val) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, val));

  let currentFontScale = DEFAULT_SCALE;
  try {
    const saved = parseInt(localStorage.getItem(FONT_SCALE_KEY), 10);
    if (!Number.isNaN(saved)) currentFontScale = clampScale(saved);
  } catch (_) {}

  const applyFontScale = (scale) => {
    currentFontScale = clampScale(scale);
    document.documentElement.style.fontSize = `${currentFontScale}%`;
    if (btnFontReset) btnFontReset.textContent = `${currentFontScale}%`;
    if (btnFontDecrease) btnFontDecrease.disabled = currentFontScale <= MIN_SCALE;
    if (btnFontIncrease) btnFontIncrease.disabled = currentFontScale >= MAX_SCALE;
    try {
      localStorage.setItem(FONT_SCALE_KEY, String(currentFontScale));
    } catch (_) {}
  };

  applyFontScale(currentFontScale);

  btnFontDecrease?.addEventListener('click', () => applyFontScale(currentFontScale - STEP_SCALE));
  btnFontIncrease?.addEventListener('click', () => applyFontScale(currentFontScale + STEP_SCALE));
  btnFontReset?.addEventListener('click', () => applyFontScale(DEFAULT_SCALE));
});
