// Canvas dimensions (must match server.js)
const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = 576;

// Character Definitions
const CHARACTERS = [
  { id: 0, name: 'Kızıl Savaşçı', color: '#ff3b30', accent: '#ffcc00' },
  { id: 1, name: 'Siber Haydut', color: '#00f0ff', accent: '#004080' },
  { id: 2, name: 'Doğa Bekçisi', color: '#34c759', accent: '#8b5a2b' },
  { id: 3, name: 'Yıldız Pilotu', color: '#ff9500', accent: '#007aff' },
  { id: 4, name: 'Gölge Ninja', color: '#af52de', accent: '#1d1d1f' }
];

// Screen management helper
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(screenId);
  if (target) {
    target.classList.add('active');
  }
}

// Toast notification helper
function showToast(message) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerText = message;
  container.appendChild(toast);
  
  // Remove toast after animation completes
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// Main Game Controller
class GameController {
  constructor() {
    this.ws = null;
    this.username = '';
    this.roomCode = '';
    this.playerState = null; // Info about lobby players
    this.gameState = null;  // Current active gameplay state
    this.mapId = 0;
    this.tick = 0;
    this.isOwner = false;

    // Controls input states
    this.inputs = {
      A: false,
      D: false,
      W: false,
      S: false,
      fire: false,
      special: false
    };

    // Canvas elements
    this.canvas = document.getElementById('game-canvas');
    this.ctx = this.canvas.getContext('2d');

    // Dance loops for end screen
    this.winnerDanceCanvas = document.getElementById('winner-dance-canvas');
    this.winnerDanceCtx = this.winnerDanceCanvas.getContext('2d');
    this.loserDanceCanvas = document.getElementById('loser-dance-canvas');
    this.loserDanceCtx = this.loserDanceCanvas.getContext('2d');
    this.danceAnimationId = null;
    this.danceTick = 0;

    // Setup DOM Listeners
    this.setupListeners();
    
    // Auto-login check
    this.checkAutoLogin();
  }

  checkAutoLogin() {
    const savedName = localStorage.getItem('username');
    if (savedName) {
      this.username = savedName;
      document.getElementById('input-name').value = savedName;
      this.connectWebSocket(() => {
        showScreen('screen-lobby');
        this.updateLobbyProfile();
      });
    }
  }

  updateLobbyProfile() {
    document.getElementById('lobby-username').innerText = this.username;
    document.getElementById('lobby-avatar').innerText = this.username.charAt(0).toUpperCase();
  }

  connectWebSocket(onOpenCallback) {
    // Dynamic ws url configuration as requested:
    // "window.location.hostname localhost ise ws://localhost:8080 kullanılır, değilse wss:// artı window.location.hostname"
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const protocol = isLocal ? 'ws://' : 'wss://';
    const host = isLocal ? 'localhost:8080' : window.location.host; // fallback to host if production, user says wss:// plus window.location.hostname, but host retains port if any
    const wsUrl = `${protocol}${isLocal ? 'localhost:8080' : window.location.hostname}`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('WebSocket Connected to:', wsUrl);
      if (onOpenCallback) onOpenCallback();
    };

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      this.handleServerMessage(msg.type, msg.payload);
    };

    this.ws.onclose = () => {
      console.log('WebSocket Disconnected');
      // Show disconnect screen if game or select screen was active
      const activeScreen = document.querySelector('.screen.active');
      if (activeScreen && (activeScreen.id === 'screen-game' || activeScreen.id === 'screen-selection' || activeScreen.id === 'screen-end')) {
        document.getElementById('disconnect-overlay').classList.add('active');
        setTimeout(() => {
          document.getElementById('disconnect-overlay').classList.remove('active');
          showScreen('screen-lobby');
        }, 3000);
      }
    };

    this.ws.onerror = (err) => {
      console.error('WebSocket Error:', err);
    };
  }

  send(type, payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }

  handleServerMessage(type, payload) {
    switch (type) {
      case 'toast':
        showToast(payload.message);
        break;

      case 'error':
        // Lobby invalid code styling
        if (payload.message === 'Geçersiz kod') {
          const lobbyCard = document.querySelector('.profile-card');
          lobbyCard.classList.add('shake');
          setTimeout(() => lobbyCard.classList.remove('shake'), 400);
          document.getElementById('lobby-error').innerText = payload.message;
        } else {
          showToast(payload.message);
        }
        break;

      case 'room_created':
        this.roomCode = payload.code;
        document.getElementById('display-room-code').innerText = payload.code;
        document.getElementById('modal-room-code').classList.add('active');
        break;

      case 'joined_room':
        this.roomCode = payload.code;
        document.getElementById('modal-room-code').classList.remove('active');
        document.getElementById('lobby-error').innerText = '';
        showScreen('screen-selection');
        break;

      case 'room_state':
        this.updateRoomState(payload);
        break;

      case 'game_start':
        this.mapId = payload.mapId;
        // Switch to game screen first, then show BAŞLA! overlay (which lives inside screen-game)
        showScreen('screen-game');
        this.setupKeyboardListeners();
        this.startGameRenderLoop();
        {
          const overlay = document.getElementById('countdown-overlay');
          const numEl = document.getElementById('countdown-number');
          if (overlay && numEl) {
            numEl.innerText = 'BAŞLA!';
            overlay.classList.remove('hidden');
            setTimeout(() => {
              overlay.classList.add('hidden');
            }, 1000);
          }
        }
        break;

      case 'game_state':
        this.gameState = payload;
        break;

      case 'game_over':
        this.stopGameRenderLoop();
        this.showEndScreen(payload);
        break;
    }
  }

  updateRoomState(payload) {
    this.playerState = payload.players;
    
    // Close modal if opponent connects (state moves past lobby)
    if (payload.status === 'selection') {
      document.getElementById('modal-room-code').classList.remove('active');
      showScreen('screen-selection');
    }

    // Determine ownership
    const me = payload.players.find(p => p.name === this.username);
    const opp = payload.players.find(p => p.name !== this.username);
    
    if (me) {
      this.isOwner = me.isOwner;
    }

    // Render Character Grid
    this.renderCharacterGrid(me ? me.characterId : 0);

    // Update settings panel (only editable by owner)
    const toggleWeapon = document.getElementById('toggle-weapon-mode');
    const mapOptions = document.querySelectorAll('.map-option');
    const weaponDesc = document.getElementById('weapon-mode-desc');

    toggleWeapon.checked = payload.settings.weaponMode === 'auto';
    weaponDesc.innerText = toggleWeapon.checked ? 'Başlangıçta silah verilir' : 'Kutulardan silah çıkar';

    mapOptions.forEach(opt => {
      const mapId = parseInt(opt.getAttribute('data-map-id'));
      if (mapId === payload.settings.mapId) {
        opt.classList.add('active');
      } else {
        opt.classList.remove('active');
      }
    });

    if (this.isOwner) {
      toggleWeapon.disabled = false;
      mapOptions.forEach(opt => opt.style.pointerEvents = 'auto');
    } else {
      toggleWeapon.disabled = true;
      mapOptions.forEach(opt => opt.style.pointerEvents = 'none');
    }

    // Update ready state cards
    const selfCard = document.getElementById('ready-card-self');
    const oppCard = document.getElementById('ready-card-opp');

    if (me) {
      selfCard.querySelector('.player-name').innerText = me.name + ' (Sen)';
      const badge = selfCard.querySelector('.status-badge');
      badge.innerText = me.ready ? 'Hazır' : 'Hazırlanıyor...';
      badge.className = 'status-badge ' + (me.ready ? 'ready' : 'waiting');

      const btnReady = document.getElementById('btn-ready');
      btnReady.innerText = me.ready ? 'Hazır Değil' : 'Hazır';
      btnReady.disabled = me.characterId === null; // must select a character
    }

    if (opp) {
      oppCard.style.display = 'flex';
      oppCard.querySelector('.player-name').innerText = opp.name;
      const badge = oppCard.querySelector('.status-badge');
      badge.innerText = opp.ready ? 'Hazır' : 'Hazırlanıyor...';
      badge.className = 'status-badge ' + (opp.ready ? 'ready' : 'waiting');
    } else {
      oppCard.style.display = 'none';
    }

    // Countdown: just update the visible number in the selection screen label (overlay is inside screen-game)
    if (payload.status === 'countdown') {
      document.getElementById('countdown-number').innerText = payload.countdown;
    }
  }

  renderCharacterGrid(selectedId) {
    const grid = document.getElementById('char-grid');
    grid.innerHTML = '';

    CHARACTERS.forEach(char => {
      const opt = document.createElement('div');
      opt.className = `char-option ${char.id === selectedId ? 'selected' : ''}`;
      
      const canvas = document.createElement('canvas');
      canvas.width = 80;
      canvas.height = 80;
      
      const name = document.createElement('span');
      name.className = 'char-name';
      name.innerText = char.name;

      opt.appendChild(canvas);
      opt.appendChild(name);
      grid.appendChild(opt);

      // Render character preview inside canvas
      const ctx = canvas.getContext('2d');
      // Draw static standing frame
      this.drawCharacterDirect(ctx, char.id, 20, 10, 40, 60, 'right', false, false, false, false, 0, null, false);

      opt.addEventListener('click', () => {
        this.send('select_character', { characterId: char.id });
      });
    });
  }

  setupListeners() {
    // Screen 1: Login
    document.getElementById('btn-login').addEventListener('click', () => {
      const nameInput = document.getElementById('input-name');
      const name = nameInput.value.trim();
      if (name.length > 0) {
        this.username = name;
        localStorage.setItem('username', name);
        this.connectWebSocket(() => {
          showScreen('screen-lobby');
          this.updateLobbyProfile();
        });
      }
    });

    // Screen 2: Lobby
    document.getElementById('btn-create-room').addEventListener('click', () => {
      this.send('create_room', { name: this.username });
    });

    document.getElementById('btn-join-room').addEventListener('click', () => {
      const code = document.getElementById('input-room-code').value.trim();
      if (code.length === 6) {
        this.send('join_room', { name: this.username, code });
      }
    });

    document.getElementById('btn-copy-code').addEventListener('click', () => {
      const codeText = document.getElementById('display-room-code').innerText;
      navigator.clipboard.writeText(codeText).then(() => {
        showToast('Oda kodu kopyalandı!');
      });
    });

    document.getElementById('btn-cancel-room').addEventListener('click', () => {
      this.send('leave_room', {});
      document.getElementById('modal-room-code').classList.remove('active');
    });

    // Screen 3: Selection / Settings
    document.getElementById('toggle-weapon-mode').addEventListener('change', (e) => {
      if (!this.isOwner) return;
      this.send('set_settings', {
        weaponMode: e.target.checked ? 'auto' : 'box',
        mapId: this.mapId
      });
    });

    const mapOptions = document.querySelectorAll('.map-option');
    mapOptions.forEach(opt => {
      opt.addEventListener('click', () => {
        if (!this.isOwner) return;
        const id = parseInt(opt.getAttribute('data-map-id'));
        this.mapId = id;
        this.send('set_settings', {
          weaponMode: document.getElementById('toggle-weapon-mode').checked ? 'auto' : 'box',
          mapId: id
        });
      });
    });

    document.getElementById('btn-ready').addEventListener('click', () => {
      const me = this.playerState.find(p => p.name === this.username);
      if (me) {
        this.send('set_ready', { ready: !me.ready });
      }
    });

    document.getElementById('btn-leave-selection').addEventListener('click', () => {
      this.send('leave_room', {});
      showScreen('screen-lobby');
    });

    // Screen 5: End Game
    document.getElementById('btn-play-again').addEventListener('click', () => {
      this.send('play_again', {});
    });

    document.getElementById('btn-exit-game').addEventListener('click', () => {
      this.send('leave_room', {});
      showScreen('screen-lobby');
    });
  }

  // Handle Keyboard Inputs for character controls
  setupKeyboardListeners() {
    this.keyState = { W: false, A: false, S: false, D: false, fire: false, special: false };

    const updateInputs = () => {
      // Send inputs if changed
      let changed = false;
      for (const k in this.keyState) {
        if (this.keyState[k] !== this.inputs[k]) {
          this.inputs[k] = this.keyState[k];
          changed = true;
        }
      }
      if (changed) {
        this.send('player_input', this.inputs);
      }
    };

    window.onkeydown = (e) => {
      const key = e.key.toLowerCase();
      if (key === 'a') this.keyState.A = true;
      if (key === 'd') this.keyState.D = true;
      if (key === 'w') this.keyState.W = true;
      if (key === 's') this.keyState.S = true;
      if (key === 'i') this.keyState.fire = true;
      // Support Turkish layout 'ş'/'Ş' and alternative 'q'/'Q' for special power/melee punch
      if (key === 'ş' || key === 'q') this.keyState.special = true;
      updateInputs();
    };

    window.onkeyup = (e) => {
      const key = e.key.toLowerCase();
      if (key === 'a') this.keyState.A = false;
      if (key === 'd') this.keyState.D = false;
      if (key === 'w') this.keyState.W = false;
      if (key === 's') this.keyState.S = false;
      if (key === 'i') this.keyState.fire = false;
      if (key === 'ş' || key === 'q') this.keyState.special = false;
      updateInputs();
    };
  }

  removeKeyboardListeners() {
    window.onkeydown = null;
    window.onkeyup = null;
  }

  // HUD Bar Renderer
  updateHUD(selfState, oppState) {
    document.getElementById('hud-name-self').innerText = selfState.name;
    document.getElementById('hud-name-opp').innerText = oppState ? oppState.name : 'Rakip Bekleniyor';

    // Update HP bars
    const selfHpBar = document.getElementById('hud-hp-bar-self');
    selfHpBar.style.width = selfState.hp + '%';
    document.getElementById('hud-hp-text-self').innerText = selfState.hp + ' HP';
    selfHpBar.className = 'hud-hp-bar ' + (selfState.hp < 25 ? 'critical' : selfState.hp < 50 ? 'low' : '');

    if (oppState) {
      const oppHpBar = document.getElementById('hud-hp-bar-opp');
      oppHpBar.style.width = oppState.hp + '%';
      document.getElementById('hud-hp-text-opp').innerText = oppState.hp + ' HP';
      oppHpBar.className = 'hud-hp-bar ' + (oppState.hp < 25 ? 'critical' : oppState.hp < 50 ? 'low' : '');
    }

    // Render Hearts
    const renderHearts = (lives) => {
      let heartsHtml = '';
      for (let i = 0; i < 5; i++) {
        if (i < lives) {
          heartsHtml += '<span>♥</span>';
        } else {
          heartsHtml += '<span class="empty">♥</span>';
        }
      }
      return heartsHtml;
    };

    document.getElementById('hud-lives-self').innerHTML = renderHearts(selfState.lives);
    if (oppState) {
      document.getElementById('hud-lives-opp').innerHTML = renderHearts(oppState.lives);
    }

    // Render Ammo Info
    document.getElementById('hud-ammo-self').innerText = selfState.hasWeapon 
      ? (selfState.reloadTimer > 0 ? 'YÜKLENİYOR...' : `Mermi: ${selfState.ammo}/20`) 
      : 'SİLAHSIZ';

    if (oppState) {
      document.getElementById('hud-ammo-opp').innerText = oppState.hasWeapon
        ? (oppState.reloadTimer > 0 ? 'YÜKLENİYOR...' : `Mermi: ${oppState.ammo}/20`)
        : 'SİLAHSIZ';
    }

    // Render Active Powerups
    const updatePowerBadge = (elementId, player) => {
      const badge = document.getElementById(elementId);
      if (player.powerUp) {
        badge.classList.remove('hidden');
        
        let powerName = 'Güç';
        let barColor = '#007aff';
        let maxTime = 1;

        if (player.powerUp === 'double_jump') { powerName = 'Çift Zıplama'; maxTime = 10 * 60; barColor = '#34c759'; }
        if (player.powerUp === 'shield') { powerName = 'Kalkan'; maxTime = 5 * 60; barColor = '#5856d6'; }
        if (player.powerUp === 'speed') { powerName = 'Hız Artırıcı'; maxTime = 8 * 60; barColor = '#ff9500'; }
        if (player.powerUp === 'shrink') { powerName = 'Boyut Küçültme'; maxTime = 8 * 60; barColor = '#ff2d55'; }
        if (player.powerUp === 'minigun') { powerName = 'Minigun'; maxTime = 6 * 60; barColor = '#ffcc00'; }
        if (player.powerUp === 'wind') { powerName = 'Rüzgar (Ş)'; maxTime = 1; barColor = '#af52de'; }
        if (player.powerUp === 'magnet') { powerName = 'Mıknatıs (Ş)'; maxTime = 1; barColor = '#5ac8fa'; }

        badge.querySelector('.power-label').innerText = powerName;
        
        const fill = badge.querySelector('.power-progress-fill');
        fill.style.backgroundColor = barColor;
        
        if (maxTime > 1) {
          const ratio = Math.max(0, player.powerUpTimer / maxTime);
          fill.style.width = (ratio * 100) + '%';
        } else {
          fill.style.width = '100%';
        }
      } else {
        badge.classList.add('hidden');
      }
    };

    updatePowerBadge('hud-powerup-self', selfState);
    if (oppState) {
      updatePowerBadge('hud-powerup-opp', oppState);
    }
  }

  // Active Game Rendering loop
  startGameRenderLoop() {
    this.tick = 0;
    this.renderActive = true;

    const render = () => {
      if (!this.renderActive) return;
      this.tick++;

      // Clear canvas
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

      if (this.gameState) {
        // Draw background map style
        this.drawMapBackground(this.ctx, this.mapId, this.tick);

        // Draw platforms
        this.drawPlatforms(this.ctx, this.mapId);

        // Find self & opponent state
        const selfState = this.gameState.players.find(p => p.name === this.username);
        const oppState = this.gameState.players.find(p => p.name !== this.username);

        if (selfState) {
          this.updateHUD(selfState, oppState);
        }

        // Draw players
        this.gameState.players.forEach(p => {
          if (p.fadeOutTimer === 0) {
            this.drawCharacterDirect(
              this.ctx,
              p.characterId,
              p.x,
              p.y,
              p.width,
              p.height,
              p.facing,
              p.isCrouching,
              p.invincibleTimer > 0,
              p.flashTimer > 0,
              false, // isWinnerDance
              this.tick,
              p.powerUp,
              p.disarmedTimer > 0
            );
          } else {
            // Fade out animation
            // Render at current position, fading out
            this.ctx.save();
            this.ctx.globalAlpha = p.fadeOutTimer / 30;
            this.drawCharacterDirect(this.ctx, p.characterId, p.x, p.y, p.width, p.height, p.facing, p.isCrouching, false, false, false, this.tick, p.powerUp, p.disarmedTimer > 0);
            this.ctx.restore();
          }
        });

        // Draw bullets
        this.gameState.bullets.forEach(b => {
          this.drawBullet(this.ctx, b.x, b.y, b.vx);
        });

        // Draw power-up box
        if (this.gameState.box) {
          this.drawBox(this.ctx, this.gameState.box.x, this.gameState.box.y, this.gameState.box.type, this.tick);
        }
      }

      requestAnimationFrame(render);
    };

    requestAnimationFrame(render);
  }

  stopGameRenderLoop() {
    this.renderActive = false;
    this.removeKeyboardListeners();
  }

  // Draw Maps
  drawMapBackground(ctx, mapId, tick) {
    if (mapId === 0) {
      // Şehir Çatıları (City night theme)
      // Dark gradient sky
      const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
      grad.addColorStop(0, '#0a0518');
      grad.addColorStop(1, '#1b1233');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Stars
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      for (let i = 0; i < 20; i++) {
        const sx = (i * 73) % CANVAS_WIDTH;
        const sy = (i * 29) % (CANVAS_HEIGHT - 200);
        ctx.fillRect(sx, sy, 2, 2);
      }

      // Neon buildings in background
      ctx.fillStyle = '#0f0b1f';
      const buildingWidths = [120, 160, 100, 200, 140, 180];
      const buildingHeights = [320, 250, 400, 280, 360, 310];
      let offset = 20;
      buildingWidths.forEach((w, idx) => {
        const h = buildingHeights[idx];
        ctx.fillRect(offset, CANVAS_HEIGHT - h, w, h);
        
        // Draw neon rows of windows
        ctx.fillStyle = (idx % 2 === 0) ? 'rgba(0, 240, 255, 0.15)' : 'rgba(175, 82, 222, 0.15)';
        for (let row = CANVAS_HEIGHT - h + 30; row < CANVAS_HEIGHT - 50; row += 40) {
          for (let col = offset + 15; col < offset + w - 15; col += 30) {
            ctx.fillRect(col, row, 10, 15);
          }
        }
        ctx.fillStyle = '#0f0b1f';
        offset += w + 40;
      });

    } else if (mapId === 1) {
      // Orman (Forest day theme)
      // Soft blue sky
      const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
      grad.addColorStop(0, '#8ec5fc');
      grad.addColorStop(1, '#e0c3fc');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Clouds
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath();
      ctx.arc(200, 100, 40, 0, Math.PI * 2);
      ctx.arc(250, 90, 50, 0, Math.PI * 2);
      ctx.arc(300, 100, 40, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(800, 120, 30, 0, Math.PI * 2);
      ctx.arc(840, 110, 40, 0, Math.PI * 2);
      ctx.arc(880, 120, 30, 0, Math.PI * 2);
      ctx.fill();

      // Green rolling hills
      ctx.fillStyle = '#3f9a56';
      ctx.beginPath();
      ctx.moveTo(0, CANVAS_HEIGHT);
      ctx.quadraticCurveTo(CANVAS_WIDTH * 0.25, CANVAS_HEIGHT - 120, CANVAS_WIDTH * 0.5, CANVAS_HEIGHT - 60);
      ctx.quadraticCurveTo(CANVAS_WIDTH * 0.75, CANVAS_HEIGHT - 20, CANVAS_WIDTH, CANVAS_HEIGHT - 80);
      ctx.lineTo(CANVAS_WIDTH, CANVAS_HEIGHT);
      ctx.fill();

      ctx.fillStyle = '#2f7c43';
      ctx.beginPath();
      ctx.moveTo(0, CANVAS_HEIGHT);
      ctx.quadraticCurveTo(CANVAS_WIDTH * 0.3, CANVAS_HEIGHT - 60, CANVAS_WIDTH * 0.6, CANVAS_HEIGHT - 80);
      ctx.quadraticCurveTo(CANVAS_WIDTH * 0.8, CANVAS_HEIGHT - 40, CANVAS_WIDTH, CANVAS_HEIGHT - 50);
      ctx.lineTo(CANVAS_WIDTH, CANVAS_HEIGHT);
      ctx.fill();

    } else if (mapId === 2) {
      // Uzay İstasyonu (Space theme)
      // Deep space background
      ctx.fillStyle = '#020108';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Nebula glow
      const nebula = ctx.createRadialGradient(200, 200, 50, 200, 200, 350);
      nebula.addColorStop(0, 'rgba(88, 86, 214, 0.15)');
      nebula.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = nebula;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Stars
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 40; i++) {
        const sx = (i * 97) % CANVAS_WIDTH;
        const sy = (i * 59) % CANVAS_HEIGHT;
        const size = (i % 3 === 0) ? 2 : 1;
        ctx.fillRect(sx, sy, size, size);
      }

      // Draw large ringed planet (Saturn-like)
      ctx.save();
      ctx.translate(850, 130);
      // Saturn rings
      ctx.strokeStyle = 'rgba(255, 185, 96, 0.5)';
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.ellipse(0, 0, 80, 20, Math.PI / 6, 0, Math.PI * 2);
      ctx.stroke();

      // Planet body
      const planetGrad = ctx.createRadialGradient(-15, -15, 5, 0, 0, 45);
      planetGrad.addColorStop(0, '#ffd8a6');
      planetGrad.addColorStop(1, '#ff9f43');
      ctx.fillStyle = planetGrad;
      ctx.beginPath();
      ctx.arc(0, 0, 45, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // Draw Platforms
  drawPlatforms(ctx, mapId) {
    const MAP_PLATFORMS = [
      [
        { x: 50, y: 500, width: 924, height: 30, isGround: true },
        { x: 120, y: 380, width: 260, height: 20 },
        { x: 644, y: 380, width: 260, height: 20 },
        { x: 387, y: 270, width: 250, height: 20 },
        { x: 220, y: 160, width: 180, height: 15 },
        { x: 624, y: 160, width: 180, height: 15 }
      ],
      [
        { x: 100, y: 490, width: 824, height: 30, isGround: true },
        { x: 80, y: 360, width: 220, height: 20 },
        { x: 724, y: 360, width: 220, height: 20 },
        { x: 350, y: 270, width: 324, height: 20 },
        { x: 450, y: 160, width: 124, height: 15 }
      ],
      [
        { x: 120, y: 510, width: 784, height: 30, isGround: true },
        { x: 200, y: 390, width: 280, height: 20 },
        { x: 544, y: 390, width: 280, height: 20 },
        { x: 362, y: 250, width: 300, height: 15 },
        { x: 462, y: 130, width: 100, height: 15 }
      ]
    ];

    const platforms = MAP_PLATFORMS[mapId];

    platforms.forEach(plat => {
      ctx.save();
      
      if (mapId === 0) {
        // Neon City: Dark metal blocks with bright purple edges
        ctx.fillStyle = '#1c1926';
        ctx.strokeStyle = '#af52de';
        ctx.lineWidth = 2;
        ctx.fillRect(plat.x, plat.y, plat.width, plat.height);
        ctx.strokeRect(plat.x, plat.y, plat.width, plat.height);

        // Highlight line on top
        ctx.strokeStyle = '#d997ff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(plat.x, plat.y);
        ctx.lineTo(plat.x + plat.width, plat.y);
        ctx.stroke();

      } else if (mapId === 1) {
        // Forest Theme: Tree logs and moss tops
        ctx.fillStyle = '#654321'; // bark brown
        ctx.fillRect(plat.x, plat.y, plat.width, plat.height);

        // Moss top
        ctx.fillStyle = '#2e8b57'; // moss green
        ctx.fillRect(plat.x, plat.y, plat.width, Math.min(8, plat.height));

        // Leaf hanging decals
        ctx.fillStyle = '#228b22';
        ctx.fillRect(plat.x + 10, plat.y + plat.height, 10, 5);
        ctx.fillRect(plat.x + plat.width - 20, plat.y + plat.height, 12, 6);

      } else if (mapId === 2) {
        // Space Station: Futuristic grey and blue neon lines
        ctx.fillStyle = '#2c3e50';
        ctx.strokeStyle = '#007aff';
        ctx.lineWidth = 2;
        ctx.fillRect(plat.x, plat.y, plat.width, plat.height);
        ctx.strokeRect(plat.x, plat.y, plat.width, plat.height);

        // Cyan tech core dots on platforms
        ctx.fillStyle = '#00f0ff';
        ctx.beginPath();
        ctx.arc(plat.x + plat.width / 2, plat.y + plat.height / 2, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    });
  }

  // Draw 2D Character Details (colorful vector drawings)
  drawCharacterDirect(ctx, charId, x, y, width, height, facing, isCrouching, isInvincible, isFlashing, isWinnerDance, tick, powerUp, isDisarmed) {
    ctx.save();

    // Adjust for dance ticks on end screen
    let bounceY = 0;
    let swayX = 0;
    let headSway = 0;
    let armAngle = 0;

    if (isWinnerDance) {
      bounceY = Math.sin(tick * 0.15) * 8;
      swayX = Math.cos(tick * 0.1) * 4;
      headSway = Math.sin(tick * 0.08) * 0.08;
      armAngle = Math.sin(tick * 0.15) * 0.5 + 0.3; // waving arms
    }

    // Shield effect wrapper
    if (powerUp === 'shield' && !isFlashing) {
      ctx.shadowBlur = 15;
      ctx.shadowColor = '#5856d6';
    }

    // Handle Invincibility transparency
    if (isInvincible && Math.floor(tick / 5) % 2 === 0) {
      ctx.globalAlpha = 0.35;
    }

    // Color definitions
    const def = CHARACTERS.find(c => c.id === charId) || CHARACTERS[0];
    let primaryColor = def.color;
    let accentColor = def.accent;
    let bodyColor = def.color;

    if (isFlashing) {
      primaryColor = '#ffffff';
      accentColor = '#ffffff';
      bodyColor = '#ffffff';
    }

    // Center coordinates
    const midX = x + width / 2 + swayX;
    const midY = y + height / 2 + bounceY;
    const isRight = facing === 'right';

    // 1. Draw Feet (Small circles)
    let leftFootX = x + width * 0.25 + swayX;
    let rightFootX = x + width * 0.75 + swayX;
    let footY = y + height - 6;

    if (!isWinnerDance && (this.keyState && (this.keyState.A || this.keyState.D))) {
      // running animation oscillation
      const runOffset = Math.sin(tick * 0.2) * 6;
      leftFootX += runOffset;
      rightFootX -= runOffset;
    }

    ctx.fillStyle = isFlashing ? '#ffffff' : '#333333';
    ctx.beginPath();
    ctx.arc(leftFootX, footY, 6, 0, Math.PI * 2);
    ctx.arc(rightFootX, footY, 6, 0, Math.PI * 2);
    ctx.fill();

    // 2. Draw Body / Clothes (Rounded rect)
    const bodyHeight = height * 0.45;
    const bodyWidth = width * 0.8;
    const bodyX = midX - bodyWidth / 2;
    const bodyY = midY - bodyHeight / 2;

    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.roundRect(bodyX, bodyY, bodyWidth, bodyHeight, 8);
    ctx.fill();

    // Add unique outfit details per character
    if (!isFlashing) {
      ctx.fillStyle = accentColor;
      if (charId === 0) {
        // Red Warrior: Silver Cross on chest
        ctx.fillStyle = '#e8e8ed';
        ctx.fillRect(midX - 2, bodyY + 4, 4, bodyHeight - 8);
        ctx.fillRect(bodyX + 4, midY - 2, bodyWidth - 8, 4);
      } else if (charId === 1) {
        // Cyber Outlaw: Glowing neon lights
        ctx.fillStyle = '#00f0ff';
        ctx.fillRect(midX - 6, bodyY + 6, 12, 4);
        ctx.fillRect(midX - 6, bodyY + bodyHeight - 10, 12, 4);
      } else if (charId === 2) {
        // Nature Guard: Leaf design
        ctx.fillStyle = '#2e8b57';
        ctx.beginPath();
        ctx.moveTo(midX, bodyY + 3);
        ctx.lineTo(midX - 5, bodyY + 12);
        ctx.lineTo(midX + 5, bodyY + 12);
        ctx.closePath();
        ctx.fill();
      } else if (charId === 3) {
        // Star Pilot: Suit badge
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(midX - 4, bodyY + 8, 3, 0, Math.PI * 2);
        ctx.fill();
      } else if (charId === 4) {
        // Shadow Ninja: Purple belt band
        ctx.fillStyle = '#af52de';
        ctx.fillRect(bodyX, midY + 4, bodyWidth, 5);
      }
    }

    // 3. Draw Head (Circle)
    const headRadius = width * 0.35;
    const headX = midX;
    const headY = bodyY - headRadius + 4;

    ctx.save();
    ctx.translate(headX, headY);
    ctx.rotate(headSway);

    // Head base
    ctx.fillStyle = primaryColor;
    ctx.beginPath();
    ctx.arc(0, 0, headRadius, 0, Math.PI * 2);
    ctx.fill();

    // Face visor/eyes details
    if (!isFlashing) {
      if (charId === 0) {
        // Red Helmet visor
        ctx.fillStyle = '#1d1d1f';
        ctx.fillRect(isRight ? 0 : -headRadius, -4, headRadius, 8);
        ctx.fillStyle = '#ffcc00';
        ctx.fillRect(isRight ? 4 : -8, -2, 4, 4);
      } else if (charId === 1) {
        // Cyber Neon Visor
        ctx.fillStyle = '#00f0ff';
        ctx.beginPath();
        ctx.ellipse(isRight ? 3 : -3, -1, 10, 4, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (charId === 2) {
        // Leafy cap visor
        ctx.fillStyle = '#ffe0b2'; // skin tone
        ctx.beginPath();
        ctx.arc(0, 2, headRadius - 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1d1d1f'; // eyes
        ctx.fillRect(isRight ? 2 : -6, -1, 2, 3);
        ctx.fillRect(isRight ? 6 : -2, -1, 2, 3);
      } else if (charId === 3) {
        // Astronaut Bubble Helmet
        ctx.fillStyle = '#ffe0b2'; // face skin
        ctx.beginPath();
        ctx.arc(0, 0, headRadius - 3, 0, Math.PI * 2);
        ctx.fill();
        // Eyes
        ctx.fillStyle = '#1d1d1f';
        ctx.fillRect(isRight ? 1 : -4, -2, 2, 3);
        ctx.fillRect(isRight ? 5 : 0, -2, 2, 3);
        // Glass bubble visor
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.fillStyle = 'rgba(142, 197, 252, 0.35)'; // light glass blue
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(isRight ? 2 : -2, 0, headRadius - 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (charId === 4) {
        // Shadow Hood and Glowing Eyes
        ctx.fillStyle = '#ff2d55'; // neon red eyes
        ctx.fillRect(isRight ? 2 : -6, -2, 3, 2);
        ctx.fillRect(isRight ? 7 : -2, -2, 3, 2);
      }
    }
    ctx.restore();

    // 4. Draw Hands and Weapon
    let leftHandX = bodyX - 4;
    let rightHandX = bodyX + bodyWidth + 4;
    let handY = midY;

    // Draw weapon if equipped and not disarmed
    if (powerUp !== 'magnet' && !isDisarmed) {
      ctx.save();
      ctx.translate(midX, midY - 2);
      
      let weaponW = 20;
      let weaponH = 6;
      let wColor = '#333333';

      if (charId === 0) { wColor = '#c73c3c'; weaponW = 18; }
      else if (charId === 1) { wColor = '#00f0ff'; weaponW = 24; weaponH = 8; }
      else if (charId === 2) { wColor = '#8b5a2b'; weaponW = 16; weaponH = 10; }
      else if (charId === 3) { wColor = '#ffcc00'; weaponW = 20; weaponH = 7; }
      else if (charId === 4) { wColor = '#af52de'; weaponW = 16; weaponH = 5; }

      if (powerUp === 'minigun') {
        wColor = '#ffcc00'; // minigun yellow
        weaponW = 28;
        weaponH = 10;
      }

      ctx.fillStyle = isFlashing ? '#ffffff' : wColor;

      if (isRight) {
        ctx.fillRect(5, -4, weaponW, weaponH); // point right
        // Handle trigger handle
        ctx.fillRect(7, 0, 4, 6);
      } else {
        ctx.fillRect(-weaponW - 5, -4, weaponW, weaponH); // point left
        ctx.fillRect(-11, 0, 4, 6);
      }
      ctx.restore();
    }

    // Hands Waving animation if dancing
    if (isWinnerDance) {
      leftHandX = bodyX - 6;
      rightHandX = bodyX + bodyWidth + 6;
      const leftHandY = midY - 20 - Math.sin(tick * 0.15) * 15;
      const rightHandY = midY - 20 - Math.cos(tick * 0.15) * 15;

      ctx.fillStyle = isFlashing ? '#ffffff' : primaryColor;
      ctx.beginPath();
      ctx.arc(leftHandX, leftHandY, 5, 0, Math.PI * 2);
      ctx.arc(rightHandX, rightHandY, 5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Normal hands: front hand holds weapon, back hand relaxed
      const leftHandY = midY + 4;
      const rightHandY = midY + (isRight ? -2 : 4);
      
      ctx.fillStyle = isFlashing ? '#ffffff' : primaryColor;
      ctx.beginPath();
      ctx.arc(leftHandX, leftHandY, 5, 0, Math.PI * 2);
      ctx.arc(rightHandX, rightHandY, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 5. Draw Shield Overlay
    if (powerUp === 'shield' && !isFlashing) {
      ctx.strokeStyle = 'rgba(88, 86, 214, 0.85)';
      ctx.fillStyle = 'rgba(88, 86, 214, 0.12)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      // Draw circular shield bubble around the bounding box
      const radius = Math.max(width, height) * 0.65;
      ctx.arc(midX, midY, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Shield sparkles
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      for (let i = 0; i < 3; i++) {
        const angle = tick * 0.05 + (i * Math.PI * 2 / 3);
        const sx = midX + Math.cos(angle) * radius;
        const sy = midY + Math.sin(angle) * radius;
        ctx.fillRect(sx - 2, sy - 2, 4, 4);
      }
    }

    ctx.restore();
  }

  // Draw Bullet (laser beam look)
  drawBullet(ctx, x, y, vx) {
    ctx.save();
    ctx.strokeStyle = (vx > 0) ? '#ff3b30' : '#ff9500';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (vx > 0 ? 12 : -12), y);
    ctx.stroke();

    // Laser glow/particle trail
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + (vx > 0 ? 3 : -3), y);
    ctx.lineTo(x + (vx > 0 ? 9 : -9), y);
    ctx.stroke();
    ctx.restore();
  }

  // Draw Power-up Boxes (animated spinning boxes)
  drawBox(ctx, x, y, type, tick) {
    ctx.save();

    // Pulsing size animation
    const scale = 1 + Math.sin(tick * 0.15) * 0.08;
    const boxSize = 25;
    
    ctx.translate(x + boxSize / 2, y + boxSize / 2);
    ctx.scale(scale, scale);
    ctx.rotate(tick * 0.02);

    // Pick box glowing color based on powerup type
    let boxColor = '#ffcc00'; // Default gold
    if (type === 'double_jump') boxColor = '#34c759';
    if (type === 'shield') boxColor = '#5856d6';
    if (type === 'speed') boxColor = '#ff9500';
    if (type === 'shrink') boxColor = '#ff2d55';
    if (type === 'minigun') boxColor = '#ffcc00';
    if (type === 'health') boxColor = '#ff3b30';
    if (type === 'wind') boxColor = '#af52de';
    if (type === 'magnet') boxColor = '#5ac8fa';

    // Box outer glow shadow
    ctx.shadowBlur = 12;
    ctx.shadowColor = boxColor;

    // Draw box cube
    ctx.fillStyle = '#1c1c1e';
    ctx.strokeStyle = boxColor;
    ctx.lineWidth = 2.5;
    
    ctx.fillRect(-boxSize / 2, -boxSize / 2, boxSize, boxSize);
    ctx.strokeRect(-boxSize / 2, -boxSize / 2, boxSize, boxSize);

    // Inner question mark detail
    ctx.fillStyle = boxColor;
    ctx.font = 'bold 13px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowBlur = 0; // turn off glow for text
    ctx.fillText('?', 0, 0);

    ctx.restore();
  }

  showEndScreen(payload) {
    showScreen('screen-end');
    
    document.getElementById('winner-name-text').innerText = payload.winner.name;
    document.getElementById('winner-name-large').innerText = payload.winner.name;
    document.getElementById('loser-name-text').innerText = payload.loser.name;

    // Set up dance loop animations for the winner & loser
    this.danceTick = 0;
    this.startDanceLoops(payload.winner.characterId, payload.loser.characterId);
  }

  startDanceLoops(winnerCharId, loserCharId) {
    if (this.danceAnimationId) {
      cancelAnimationFrame(this.danceAnimationId);
    }

    const loop = () => {
      this.danceTick++;

      // Winner canvas update (larger, dancing)
      this.winnerDanceCtx.clearRect(0, 0, this.winnerDanceCanvas.width, this.winnerDanceCanvas.height);
      // Center character: x center = 110, y = 200, width = 60, height = 90
      // Draw dance version
      this.drawCharacterDirect(
        this.winnerDanceCtx,
        winnerCharId,
        80, // x
        80, // y
        60, // width
        90, // height
        'right',
        false, // crouching
        false, // invincible
        false, // flashing
        true,  // isWinnerDance (triggers waving arms and bounce)
        this.danceTick,
        null,
        false
      );

      // Loser canvas update (smaller, sad/static)
      this.loserDanceCtx.clearRect(0, 0, this.loserDanceCanvas.width, this.loserDanceCanvas.height);
      // Center character: x center = 60, y = 100, width = 40, height = 60
      // Sad look: head down, disarmed
      this.loserDanceCtx.save();
      // Apply sad slow breathing scale
      const breathe = Math.sin(this.danceTick * 0.05) * 2;
      this.drawCharacterDirect(
        this.loserDanceCtx,
        loserCharId,
        40,
        45 + breathe,
        40,
        60 - breathe,
        'left',
        true, // crouch slightly (slumped)
        false,
        false,
        false,
        this.danceTick,
        'magnet', // disarmed style (no weapon)
        true
      );
      this.loserDanceCtx.restore();

      this.danceAnimationId = requestAnimationFrame(loop);
    };

    loop();
  }

  stopDanceLoops() {
    if (this.danceAnimationId) {
      cancelAnimationFrame(this.danceAnimationId);
      this.danceAnimationId = null;
    }
  }
}

// Instantiate game controller on load
window.addEventListener('DOMContentLoaded', () => {
  window.game = new GameController();
});
