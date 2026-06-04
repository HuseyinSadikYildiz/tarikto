const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

// PORT Configuration
const PORT = 8080;

const server = http.createServer((req, res) => {
  // Strip query parameters
  const pathname = req.url.split('?')[0];
  let filePath = pathname === '/' ? './index.html' : '.' + pathname;
  
  // Prevent directory traversal securely
  const resolvedPath = path.resolve(filePath);
  const resolvedDir = path.resolve('.');
  
  if (!resolvedPath.startsWith(resolvedDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const extname = path.extname(filePath);
  let contentType = 'text/html';
  switch (extname) {
    case '.js':
      contentType = 'application/javascript';
      break;
    case '.css':
      contentType = 'text/css';
      break;
    case '.json':
      contentType = 'application/json';
      break;
    case '.png':
      contentType = 'image/png';
      break;
    case '.jpg':
      contentType = 'image/jpg';
      break;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('500 Internal Server Error: ' + error.code);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

// Create WebSocket server attached to HTTP server
const wss = new WebSocketServer({ server });

// Game constants
const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = 576;

const MAPS = [
  {
    id: 0,
    name: 'Şehir Çatıları',
    platforms: [
      { x: 50, y: 500, width: 924, height: 30, isGround: true },
      { x: 120, y: 380, width: 260, height: 20 },
      { x: 644, y: 380, width: 260, height: 20 },
      { x: 387, y: 270, width: 250, height: 20 },
      { x: 220, y: 160, width: 180, height: 15 },
      { x: 624, y: 160, width: 180, height: 15 }
    ]
  },
  {
    id: 1,
    name: 'Orman',
    platforms: [
      { x: 100, y: 490, width: 824, height: 30, isGround: true },
      { x: 80, y: 360, width: 220, height: 20 },
      { x: 724, y: 360, width: 220, height: 20 },
      { x: 350, y: 270, width: 324, height: 20 },
      { x: 450, y: 160, width: 124, height: 15 }
    ]
  },
  {
    id: 2,
    name: 'Uzay İstasyonu',
    platforms: [
      { x: 120, y: 510, width: 784, height: 30, isGround: true },
      { x: 200, y: 390, width: 280, height: 20 },
      { x: 544, y: 390, width: 280, height: 20 },
      { x: 362, y: 250, width: 300, height: 15 },
      { x: 462, y: 130, width: 100, height: 15 }
    ]
  }
];

const POWERUPS = [
  'double_jump', // 10s
  'shield',      // 5s
  'speed',       // 8s
  'shrink',      // 8s
  'minigun',     // 6s
  'health',      // instant (+50hp)
  'wind',        // active
  'magnet'       // active
];

// Room states storage
const rooms = new Map();

function generateRoomCode() {
  let code = '';
  do {
    code = Math.floor(100000 + Math.random() * 900000).toString();
  } while (rooms.has(code));
  return code;
}

function broadcastToRoom(room, messageObj) {
  const data = JSON.stringify(messageObj);
  room.players.forEach(p => {
    if (p.ws && p.ws.readyState === 1) {
      p.ws.send(data);
    }
  });
}

function getOpponent(room, player) {
  return room.players.find(p => p.id !== player.id);
}

// Tick loop (60 FPS) for all rooms in playing state
setInterval(() => {
  rooms.forEach((room, code) => {
    if (room.status === 'playing') {
      updateGamePhysics(room);
    }
  });
}, 1000 / 60);

function initGameState(room) {
  const map = MAPS[room.settings.mapId];
  const startX1 = 200;
  const startX2 = 824;
  const startY = 300;

  room.gameState = {
    players: [
      {
        id: room.players[0].id,
        name: room.players[0].name,
        characterId: room.players[0].characterId,
        x: startX1,
        y: startY,
        vx: 0,
        vy: 0,
        width: 40,
        height: 60,
        facing: 'right', // 'left' | 'right'
        lives: 5,
        hp: 100,
        hasWeapon: room.settings.weaponMode === 'auto',
        ammo: 20,
        reloadTimer: 0, // in frames
        powerUp: null,  // string name
        powerUpTimer: 0,
        invincibleTimer: 120, // 2 seconds flash
        flashTimer: 0,
        fadeOutTimer: 0,
        dropPlatformTimer: 0,
        isCrouching: false,
        hasDoubleJumped: false,
        lastFiredFrame: 0,
        disarmedTimer: 0,
        inputs: { A: false, D: false, W: false, S: false, fire: false, special: false },
        prevInputs: { A: false, D: false, W: false, S: false, fire: false, special: false }
      },
      {
        id: room.players[1].id,
        name: room.players[1].name,
        characterId: room.players[1].characterId,
        x: startX2,
        y: startY,
        vx: 0,
        vy: 0,
        width: 40,
        height: 60,
        facing: 'left',
        lives: 5,
        hp: 100,
        hasWeapon: room.settings.weaponMode === 'auto',
        ammo: 20,
        reloadTimer: 0,
        powerUp: null,
        powerUpTimer: 0,
        invincibleTimer: 120,
        flashTimer: 0,
        fadeOutTimer: 0,
        dropPlatformTimer: 0,
        isCrouching: false,
        hasDoubleJumped: false,
        lastFiredFrame: 0,
        disarmedTimer: 0,
        inputs: { A: false, D: false, W: false, S: false, fire: false, special: false },
        prevInputs: { A: false, D: false, W: false, S: false, fire: false, special: false }
      }
    ],
    bullets: [],
    box: {
      active: false,
      x: 0,
      y: 0,
      width: 25,
      height: 25,
      type: null,
      spawnTimer: Math.floor(15 * 60 + Math.random() * 5 * 60) // 15-20 seconds
    },
    tick: 0
  };
}

function updateGamePhysics(room) {
  const state = room.gameState;
  const map = MAPS[room.settings.mapId];
  state.tick++;

  // 1. Update each player
  state.players.forEach((p, idx) => {
    // Timers
    if (p.reloadTimer > 0) p.reloadTimer--;
    if (p.powerUpTimer > 0) p.powerUpTimer--;
    if (p.invincibleTimer > 0) p.invincibleTimer--;
    if (p.flashTimer > 0) p.flashTimer--;
    if (p.dropPlatformTimer > 0) p.dropPlatformTimer--;
    if (p.disarmedTimer > 0) p.disarmedTimer--;

    // If powerUpTimer expired, clear power-up
    if (p.powerUp && p.powerUpTimer === 0) {
      p.powerUp = null;
    }

    // Fade out handling
    if (p.fadeOutTimer > 0) {
      p.fadeOutTimer--;
      if (p.fadeOutTimer === 0) {
        // Respawn
        p.x = CANVAS_WIDTH / 2;
        p.y = 50;
        p.vx = 0;
        p.vy = 0;
        p.hp = 100;
        p.ammo = 20;
        p.reloadTimer = 0;
        p.invincibleTimer = 120;
        p.hasDoubleJumped = false;
        p.powerUp = null;
        p.powerUpTimer = 0;
        p.disarmedTimer = 0;
      }
      // Save current input as prev for next frame
      p.prevInputs = { ...p.inputs };
      return;
    }

    // Determine scale/dimensions
    const sizeMultiplier = (p.powerUp === 'shrink') ? 0.6 : 1.0;
    const normalHeight = 60 * sizeMultiplier;
    const normalWidth = 40 * sizeMultiplier;

    // Crouch handling
    if (p.inputs.S) {
      p.isCrouching = true;
      p.height = normalHeight * 0.6;
    } else {
      p.isCrouching = false;
      p.height = normalHeight;
    }
    p.width = normalWidth;

    // Movement speeds
    const speedMultiplier = (p.powerUp === 'speed') ? 1.5 : 1.0;
    const maxSpeed = 5 * speedMultiplier;
    const accel = 0.8;
    const friction = 0.15;

    // Horizontal acceleration
    if (p.inputs.A) {
      p.vx -= accel;
      p.facing = 'left';
    } else if (p.inputs.D) {
      p.vx += accel;
      p.facing = 'right';
    } else {
      p.vx *= (1 - friction);
      if (Math.abs(p.vx) < 0.1) p.vx = 0;
    }
    // Clamp horizontal speed
    if (p.vx > maxSpeed) p.vx = maxSpeed;
    if (p.vx < -maxSpeed) p.vx = -maxSpeed;

    // Gravity
    p.vy += 0.5; // gravity force
    if (p.vy > 15) p.vy = 15; // terminal velocity

    // Jump logic (detect W keydown edge: W is true now, but was false)
    const wPressed = p.inputs.W && !p.prevInputs.W;
    let onPlatform = false;

    // Check if player is standing on any platform before resolving movement
    // To check if they are standing, we look at their bottom alignment with platform top
    map.platforms.forEach(plat => {
      if (p.vy >= 0 &&
          p.x + p.width > plat.x &&
          p.x < plat.x + plat.width &&
          Math.abs((p.y + p.height) - plat.y) <= 1.0) {
        onPlatform = true;
      }
    });

    if (wPressed) {
      if (onPlatform) {
        if (p.inputs.S && !map.platforms.find(plat => p.x + p.width > plat.x && p.x < plat.x + plat.width && Math.abs((p.y + p.height) - plat.y) <= 1.0)?.isGround) {
          // Drop through platform: crouch + jump
          p.dropPlatformTimer = 20; // ignore platform collision for 20 frames
          p.y += 5; // force down
        } else {
          // Normal jump
          p.vy = -12;
          p.hasDoubleJumped = false;
        }
      } else if (p.powerUp === 'double_jump' && !p.hasDoubleJumped) {
        // Double jump
        p.vy = -11;
        p.hasDoubleJumped = true;
      }
    }

    // Apply movement
    p.x += p.vx;
    p.y += p.vy;

    // Bound check: Fall off map
    if (p.y > CANVAS_HEIGHT || p.x + p.width < 0 || p.x > CANVAS_WIDTH) {
      p.lives--;
      p.hp = 0;
      if (p.lives > 0) {
        p.fadeOutTimer = 30; // 0.5 seconds
        p.vx = 0;
        p.vy = 0;
      } else {
        // Game Over trigger
        triggerGameOver(room, getOpponent(room, p));
        return;
      }
    }

    // Collision with platforms
    map.platforms.forEach(plat => {
      // One-way platform logic:
      // Must be falling, was above the platform top, within horizontal bounds, and not dropping through
      const wasAbove = (p.y + p.height - p.vy) <= plat.y + 0.1;
      const isWithinX = p.x + p.width > plat.x && p.x < plat.x + plat.width;
      const isFalling = p.vy >= 0;
      const isDropping = p.dropPlatformTimer > 0 && !plat.isGround;

      if (isFalling && wasAbove && isWithinX && !isDropping) {
        if (p.y + p.height >= plat.y && p.y + p.height - p.vy <= plat.y + p.vy + 2) {
          p.y = plat.y - p.height;
          p.vy = 0;
          p.hasDoubleJumped = false;
        }
      }
    });

    // Handle Fire (I key)
    const firePressed = p.inputs.fire && !p.prevInputs.fire;
    const isMinigun = p.powerUp === 'minigun';
    const fireInterval = isMinigun ? 6 : 20; // minigun rapid fire
    const canFireRate = (state.tick - p.lastFiredFrame) >= fireInterval;

    if (p.hasWeapon && p.disarmedTimer === 0 && ((firePressed && !isMinigun) || (p.inputs.fire && isMinigun && canFireRate))) {
      if (isMinigun || p.ammo > 0) {
        if (!isMinigun) p.ammo--;
        p.lastFiredFrame = state.tick;

        // Spawn bullet
        const bX = p.facing === 'right' ? p.x + p.width + 5 : p.x - 15;
        const bY = p.y + p.height * 0.4;
        const bVx = p.facing === 'right' ? 14 : -14;
        
        state.bullets.push({
          x: bX,
          y: bY,
          vx: bVx,
          vy: 0.1, // very low gravity
          ownerId: p.id,
          distance: 0,
          maxDistance: 600
        });

        // Trigger reload if ammo runs out
        if (!isMinigun && p.ammo <= 0) {
          p.reloadTimer = 120; // 2 seconds
        }
      }
    }

    // Handle Special / Melee (Ş key)
    const specialPressed = p.inputs.special && !p.prevInputs.special;
    if (specialPressed) {
      if (p.powerUp === 'wind') {
        // Trigger Wind
        p.powerUp = null;
        p.powerUpTimer = 0;
        // Find opponent
        const opp = state.players[idx === 0 ? 1 : 0];
        if (opp.fadeOutTimer === 0 && opp.invincibleTimer === 0 && opp.powerUp !== 'shield') {
          // Push away strongly
          const dir = p.facing === 'right' ? 1 : -1;
          opp.vx = dir * 16;
          opp.vy = -6;
        }
      } else if (p.powerUp === 'magnet') {
        // Trigger Magnet
        p.powerUp = null;
        p.powerUpTimer = 0;
        const opp = state.players[idx === 0 ? 1 : 0];
        if (opp.fadeOutTimer === 0 && opp.invincibleTimer === 0 && opp.powerUp !== 'shield') {
          // Disarm opponent for 3 seconds
          opp.disarmedTimer = 180; // 3 seconds at 60fps
        }
      } else {
        // Melee punch (no power-up active or passive power only)
        const punchWidth = 45;
        const punchHeight = 30;
        const punchX = p.facing === 'right' ? p.x + p.width : p.x - punchWidth;
        const punchY = p.y + p.height * 0.2;

        const opp = state.players[idx === 0 ? 1 : 0];
        if (opp.fadeOutTimer === 0 && opp.invincibleTimer === 0) {
          // Check collision with punch rect
          const hit = punchX + punchWidth > opp.x &&
                      punchX < opp.x + opp.width &&
                      punchY + punchHeight > opp.y &&
                      punchY < opp.y + opp.height;

          if (hit) {
            if (opp.powerUp !== 'shield') {
              const damage = Math.floor(15 + Math.random() * 11); // 15-25 damage
              opp.hp -= damage;
              opp.flashTimer = 5;
              
              // Push back slightly on punch
              const dir = p.facing === 'right' ? 1 : -1;
              opp.vx += dir * 4;
              opp.vy -= 2;

              if (opp.hp <= 0) {
                opp.lives--;
                opp.hp = 0;
                if (opp.lives > 0) {
                  opp.fadeOutTimer = 30;
                  opp.vx = 0;
                  opp.vy = 0;
                } else {
                  triggerGameOver(room, p);
                  return;
                }
              }
            }
          }
        }
      }
    }

    // Save inputs
    p.prevInputs = { ...p.inputs };
  });

  // Check if reloading timer completes
  state.players.forEach(p => {
    if (p.reloadTimer === 0 && p.ammo === 0 && p.powerUp !== 'minigun') {
      p.ammo = 20;
    }
  });

  // Resolve player-player horizontal collision (no overlap)
  const p1 = state.players[0];
  const p2 = state.players[1];
  if (p1.fadeOutTimer === 0 && p2.fadeOutTimer === 0) {
    const isOverlap = p1.x + p1.width > p2.x &&
                      p1.x < p2.x + p2.width &&
                      p1.y + p1.height > p2.y &&
                      p1.y < p2.y + p2.height;

    if (isOverlap) {
      // Determine overlap amount
      const overlapX = Math.min(p1.x + p1.width, p2.x + p2.width) - Math.max(p1.x, p2.x);
      // Resolve horizontally
      if (p1.x + p1.width / 2 < p2.x + p2.width / 2) {
        // P1 is to the left
        p1.x -= overlapX / 2;
        p2.x += overlapX / 2;
        // Damp velocities
        if (p1.vx > 0) p1.vx = 0;
        if (p2.vx < 0) p2.vx = 0;
      } else {
        // P1 is to the right
        p1.x += overlapX / 2;
        p2.x -= overlapX / 2;
        // Damp velocities
        if (p1.vx < 0) p1.vx = 0;
        if (p2.vx > 0) p2.vx = 0;
      }
      // Clamping inside Canvas boundaries
      if (p1.x < 0) p1.x = 0;
      if (p1.x + p1.width > CANVAS_WIDTH) p1.x = CANVAS_WIDTH - p1.width;
      if (p2.x < 0) p2.x = 0;
      if (p2.x + p2.width > CANVAS_WIDTH) p2.x = CANVAS_WIDTH - p2.width;
    }
  }

  // 2. Update Bullets
  for (let i = state.bullets.length - 1; i >= 0; i--) {
    const b = state.bullets[i];
    b.x += b.vx;
    b.y += b.vy;
    b.vy += 0.05; // bullet gravity
    b.distance += Math.abs(b.vx);

    let destroyed = false;

    // Check hit boundaries
    if (b.x < 0 || b.x > CANVAS_WIDTH || b.y > CANVAS_HEIGHT || b.distance >= b.maxDistance) {
      destroyed = true;
    } else {
      // Check hit opponent
      const opp = state.players.find(p => p.id !== b.ownerId);
      if (opp && opp.fadeOutTimer === 0) {
        const hit = b.x >= opp.x && b.x <= opp.x + opp.width &&
                    b.y >= opp.y && b.y <= opp.y + opp.height;

        if (hit) {
          destroyed = true;
          if (opp.invincibleTimer === 0) {
            if (opp.powerUp !== 'shield') {
              const damage = Math.floor(10 + Math.random() * 11); // 10-20 damage
              opp.hp -= damage;
              opp.flashTimer = 5; // flash white

              if (opp.hp <= 0) {
                opp.lives--;
                opp.hp = 0;
                if (opp.lives > 0) {
                  opp.fadeOutTimer = 30; // 0.5s fade out
                  opp.vx = 0;
                  opp.vy = 0;
                } else {
                  triggerGameOver(room, state.players.find(p => p.id === b.ownerId));
                  return;
                }
              }
            }
          }
        }
      }
    }

    if (destroyed) {
      state.bullets.splice(i, 1);
    }
  }

  // 3. Update Boxes
  if (!state.box.active) {
    state.box.spawnTimer--;
    if (state.box.spawnTimer <= 0) {
      // Pick random platform (including ground)
      const plat = map.platforms[Math.floor(Math.random() * map.platforms.length)];
      state.box.x = plat.x + plat.width / 2 - state.box.width / 2;
      state.box.y = plat.y - state.box.height;
      state.box.active = true;
      state.box.type = POWERUPS[Math.floor(Math.random() * POWERUPS.length)];
    }
  } else {
    // Check overlap with players
    state.players.forEach(p => {
      if (p.fadeOutTimer === 0) {
        const boxOverlap = p.x + p.width > state.box.x &&
                            p.x < state.box.x + state.box.width &&
                            p.y + p.height > state.box.y &&
                            p.y < state.box.y + state.box.height;

        if (boxOverlap) {
          // Collect powerup
          const type = state.box.type;
          
          if (type === 'health') {
            p.hp = Math.min(100, p.hp + 50);
          } else if (type === 'wind') {
            p.powerUp = 'wind';
            p.powerUpTimer = 999999; // active until used
          } else if (type === 'magnet') {
            p.powerUp = 'magnet';
            p.powerUpTimer = 999999; // active until used
          } else {
            p.powerUp = type;
            let duration = 0;
            if (type === 'double_jump') duration = 10 * 60; // 10s
            if (type === 'shield') duration = 5 * 60;       // 5s
            if (type === 'speed') duration = 8 * 60;        // 8s
            if (type === 'shrink') duration = 8 * 60;       // 8s
            if (type === 'minigun') duration = 6 * 60;      // 6s
            p.powerUpTimer = duration;
          }

          // Equip base weapon if box-weapon mode and unarmed
          if (room.settings.weaponMode === 'box' && !p.hasWeapon) {
            p.hasWeapon = true;
          }

          // Deactivate box and schedule next spawn
          state.box.active = false;
          state.box.spawnTimer = Math.floor(15 * 60 + Math.random() * 5 * 60); // 15-20s
        }
      }
    });
  }

  // 4. Send state to clients
  broadcastToRoom(room, {
    type: 'game_state',
    payload: {
      players: state.players.map(p => ({
        id: p.id,
        name: p.name,
        characterId: p.characterId,
        x: p.x,
        y: p.y,
        width: p.width,
        height: p.height,
        facing: p.facing,
        lives: p.lives,
        hp: p.hp,
        hasWeapon: p.hasWeapon,
        ammo: p.ammo,
        reloadTimer: p.reloadTimer,
        powerUp: p.powerUp,
        powerUpTimer: p.powerUpTimer,
        invincibleTimer: p.invincibleTimer,
        flashTimer: p.flashTimer,
        fadeOutTimer: p.fadeOutTimer,
        isCrouching: p.isCrouching,
        disarmedTimer: p.disarmedTimer
      })),
      bullets: state.bullets.map(b => ({
        x: b.x,
        y: b.y,
        vx: b.vx
      })),
      box: state.box.active ? {
        x: state.box.x,
        y: state.box.y,
        type: state.box.type
      } : null
    }
  });
}

function triggerGameOver(room, winnerPlayer) {
  room.status = 'game_over';
  const winner = room.players.find(p => p.id === winnerPlayer.id);
  const loser = room.players.find(p => p.id !== winnerPlayer.id);

  room.gameOverState = {
    winner: { name: winner.name, characterId: winner.characterId },
    loser: { name: loser.name, characterId: loser.characterId }
  };

  broadcastToRoom(room, {
    type: 'game_over',
    payload: room.gameOverState
  });
}

// WebSocket connection handling
wss.on('connection', (ws) => {
  let playerRef = null;
  let roomRef = null;

  ws.on('message', (messageStr) => {
    try {
      const message = JSON.parse(messageStr);
      const { type, payload } = message;

      switch (type) {
        case 'create_room': {
          const roomCode = generateRoomCode();
          playerRef = {
            id: Math.random().toString(36).substring(2, 9),
            name: payload.name || 'Oyuncu 1',
            characterId: 0,
            ready: false,
            isOwner: true,
            ws
          };

          roomRef = {
            code: roomCode,
            players: [playerRef],
            status: 'lobby',
            settings: {
              weaponMode: 'auto', // 'auto' | 'box'
              mapId: 0
            },
            countdown: 0
          };

          rooms.set(roomCode, roomRef);
          ws.send(JSON.stringify({ type: 'room_created', payload: { code: roomCode } }));
          ws.send(JSON.stringify({ type: 'room_state', payload: getRoomStatePayload(roomRef) }));
          break;
        }

        case 'join_room': {
          const code = payload.code ? payload.code.trim() : '';
          const room = rooms.get(code);

          if (!room) {
            ws.send(JSON.stringify({ type: 'error', payload: { message: 'Geçersiz kod' } }));
            return;
          }

          if (room.players.length >= 2) {
            ws.send(JSON.stringify({ type: 'error', payload: { message: 'Oda dolu' } }));
            return;
          }

          playerRef = {
            id: Math.random().toString(36).substring(2, 9),
            name: payload.name || 'Oyuncu 2',
            characterId: 1,
            ready: false,
            isOwner: false,
            ws
          };

          room.players.push(playerRef);
          roomRef = room;
          roomRef.status = 'selection'; // move to character selection directly when second joins

          ws.send(JSON.stringify({ type: 'joined_room', payload: { code } }));
          broadcastToRoom(roomRef, { type: 'room_state', payload: getRoomStatePayload(roomRef) });
          break;
        }

        case 'select_character': {
          if (!roomRef || !playerRef) return;
          playerRef.characterId = payload.characterId;
          broadcastToRoom(roomRef, { type: 'room_state', payload: getRoomStatePayload(roomRef) });
          break;
        }

        case 'set_settings': {
          if (!roomRef || !playerRef || !playerRef.isOwner) return;
          roomRef.settings.weaponMode = payload.weaponMode;
          roomRef.settings.mapId = payload.mapId;
          broadcastToRoom(roomRef, { type: 'room_state', payload: getRoomStatePayload(roomRef) });
          break;
        }

        case 'set_ready': {
          if (!roomRef || !playerRef) return;
          playerRef.ready = payload.ready;

          // If room status is selection and both ready, start countdown
          const allReady = roomRef.players.length === 2 && roomRef.players.every(p => p.ready);
          if (allReady && roomRef.status === 'selection') {
            startCountdown(roomRef);
          } else {
            broadcastToRoom(roomRef, { type: 'room_state', payload: getRoomStatePayload(roomRef) });
          }
          break;
        }

        case 'player_input': {
          if (!roomRef || roomRef.status !== 'playing' || !playerRef) return;
          // Apply inputs to current state
          const statePlayer = roomRef.gameState.players.find(p => p.id === playerRef.id);
          if (statePlayer) {
            statePlayer.inputs = payload;
          }
          break;
        }

        case 'play_again': {
          if (!roomRef || !playerRef) return;
          playerRef.ready = false;
          // If both clicked play_again, reset room to selection
          const allReadyToReset = roomRef.players.every(p => p.ws); // check connections
          if (roomRef.status === 'game_over') {
            roomRef.status = 'selection';
            roomRef.players.forEach(p => p.ready = false);
            roomRef.countdown = 0;
            roomRef.gameState = null;
            roomRef.gameOverState = null;
          }
          broadcastToRoom(roomRef, { type: 'room_state', payload: getRoomStatePayload(roomRef) });
          break;
        }

        case 'leave_room': {
          handleDisconnect();
          break;
        }
      }
    } catch (err) {
      console.error('Error handling WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    handleDisconnect();
  });

  function handleDisconnect() {
    if (!roomRef || !playerRef) return;

    // Remove player from room
    roomRef.players = roomRef.players.filter(p => p.id !== playerRef.id);

    if (roomRef.players.length === 0) {
      // Destroy room
      rooms.delete(roomRef.code);
    } else {
      // Notify remaining player that opponent left
      const remainingPlayer = roomRef.players[0];
      remainingPlayer.isOwner = true; // remaining becomes owner
      remainingPlayer.ready = false;
      
      roomRef.status = 'lobby';
      roomRef.countdown = 0;
      roomRef.gameState = null;
      roomRef.gameOverState = null;

      if (remainingPlayer.ws && remainingPlayer.ws.readyState === 1) {
        remainingPlayer.ws.send(JSON.stringify({ type: 'toast', payload: { message: 'Rakip ayrıldı' } }));
        remainingPlayer.ws.send(JSON.stringify({ type: 'room_state', payload: getRoomStatePayload(roomRef) }));
      }
    }

    roomRef = null;
    playerRef = null;
  }
});

function getRoomStatePayload(room) {
  return {
    code: room.code,
    status: room.status,
    settings: room.settings,
    countdown: room.countdown,
    players: room.players.map(p => ({
      name: p.name,
      characterId: p.characterId,
      ready: p.ready,
      isOwner: p.isOwner
    }))
  };
}

function startCountdown(room) {
  room.status = 'countdown';
  room.countdown = 3;
  broadcastToRoom(room, { type: 'room_state', payload: getRoomStatePayload(room) });

  const intervalId = setInterval(() => {
    if (!rooms.has(room.code) || room.status !== 'countdown') {
      clearInterval(intervalId);
      return;
    }

    room.countdown--;
    if (room.countdown <= 0) {
      clearInterval(intervalId);
      room.status = 'playing';
      initGameState(room);
      broadcastToRoom(room, { type: 'game_start', payload: { mapId: room.settings.mapId } });
    } else {
      broadcastToRoom(room, { type: 'room_state', payload: getRoomStatePayload(room) });
    }
  }, 1000);
}

// Start Server
server.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
