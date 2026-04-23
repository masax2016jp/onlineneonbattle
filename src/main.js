import './style.css';
import { insertCoin, onPlayerJoin, myPlayer, isHost, setState, getState, Joystick } from 'playroomkit';

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const startBtn = document.getElementById('start-btn');
const lobbyScreen = document.getElementById('lobby-screen');
const scoreBoard = document.getElementById('score-board');
const playerCountDisplay = document.getElementById('player-count');
const timerDisplay = document.getElementById('timer');
const resultsScreen = document.getElementById('results-screen');
const finalResults = document.getElementById('final-results');
const restartBtn = document.getElementById('restart-btn');

let players = [];
let particles = [];
let screenShake = 0;
const ARENA_SIZE = 2000;
const BULLET_SPEED = 10;
const ITEM_SPAWN_RATE = 10000; // 10 seconds
const OBSTACLE_COUNT = 30;

// Sound Manager using Web Audio API
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const sounds = {
  shoot: () => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(800, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
  },
  explosion: () => {
    const bufferSize = audioCtx.sampleRate * 0.5;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(400, audioCtx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.5);
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);
    noise.start();
  }
};

// Resize canvas
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// Inputs
const keys = {};
let mousePressed = false;
window.addEventListener('keydown', (e) => (keys[e.key] = true));
window.addEventListener('keyup', (e) => (keys[e.key] = false));
window.addEventListener('mousedown', () => (mousePressed = true));
window.addEventListener('mouseup', () => (mousePressed = false));

// Initialize Game
let gameLoopRunning = false;
let joystick;
async function setupGame() {
  if (gameLoopRunning) return; // Prevent multiple loops
  
  const btnText = startBtn.querySelector('.btn-text');
  
  try {
    btnText.innerText = 'CONNECTING...';
    startBtn.disabled = true;
    
    // Resume audio context on user gesture
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    await insertCoin({
      gameId: "neon-striker-demo",
      skipLobby: false,
    });

    joystick = new Joystick(myPlayer(), {
      type: "dpad",
      buttons: [
        { id: "shoot", label: "FIRE" }
      ]
    });

    if (isHost()) {
      spawnObstacles();
      setInterval(spawnItem, ITEM_SPAWN_RATE);
      // Initialize round
      if (!getState('gameState')) {
        startNewRound();
      }
    }

    onPlayerJoin((player) => {
      if (!players.find(p => p.id === player.id)) {
        players.push(player);
      }
      
      if (!player.getState('pos')) {
        respawnPlayer(player);
      }
      
      // Initialize power-ups state
      if (!player.getState('powerups')) {
        player.setState('powerups', { invisible: 0, damage: 0, shield: 0 });
      }
      
      updatePlayerCount();
      player.onQuit(() => {
        players = players.filter(p => p.id !== player.id);
        updatePlayerCount();
      });
    });

    lobbyScreen.classList.remove('active');
    document.getElementById('game-info').classList.remove('hidden');
    
    gameLoopRunning = true;
    requestAnimationFrame(gameLoop);
    
    // Handle tab focus return
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        if (audioCtx.state === 'suspended') audioCtx.resume();
      }
    });
    
    restartBtn.addEventListener('click', () => {
      if (isHost()) {
        startNewRound();
      }
    });

  } catch (err) {
    console.error("Failed to setup game:", err);
    btnText.innerText = 'ERROR: RETRY?';
    startBtn.disabled = false;
  }
}

function respawnPlayer(player) {
  player.setState('pos', { 
    x: Math.random() * (ARENA_SIZE - 200) + 100, 
    y: Math.random() * (ARENA_SIZE - 200) + 100 
  });
  player.setState('health', 100);
  player.setState('isDead', false);
  player.setState('bullets', []);
  player.setState('powerups', { invisible: 0, damage: 0, shield: 0 });
}

function spawnObstacles() {
  if (!isHost()) return;
  const obstacles = [];
  for (let i = 0; i < OBSTACLE_COUNT; i++) {
    obstacles.push({
      id: 'obs-' + i,
      x: Math.random() * (ARENA_SIZE - 200) + 100,
      y: Math.random() * (ARENA_SIZE - 200) + 100,
      size: 40 + Math.random() * 40,
      health: 50
    });
  }
  setState('obstacles', obstacles, true);
}

function spawnItem() {
  if (!isHost()) return;
  const items = getState('items') || [];
  const types = ['invisible', 'damage', 'shield'];
  const newItem = {
    id: 'item-' + Date.now(),
    x: Math.random() * (ARENA_SIZE - 200) + 100,
    y: Math.random() * (ARENA_SIZE - 200) + 100,
    type: types[Math.floor(Math.random() * types.length)]
  };
  setState('items', [...items, newItem], true);
}

function startNewRound() {
  setState('gameState', 'playing', true);
  setState('roundEndTime', Date.now() + 3 * 60 * 1000, true);
  
  // Reset players
  players.forEach(p => {
    p.setState('score', 0);
    respawnPlayer(p);
  });
  spawnObstacles();
  setState('items', [], true);
}

function updatePlayerCount() {
  const url = new URL(window.location.href);
  let roomId = url.searchParams.get('r');
  if (!roomId && url.hash.includes('r=')) {
    roomId = new URLSearchParams(url.hash.substring(1)).get('r');
  }
  const roomText = roomId ? `ROOM: <span style="color:var(--neon-blue)">${roomId}</span> | ` : '';
  playerCountDisplay.innerHTML = `${roomText}${players.length} PLAYER${players.length > 1 ? 'S' : ''} ONLINE`;
}

// Shooting logic
let lastShootTime = 0;
function shoot(me) {
  const now = Date.now();
  if (now - lastShootTime < 300) return;
  lastShootTime = now;

  const pos = me.getState('pos');
  const angle = me.getState('angle');
  const bullets = me.getState('bullets') || [];
  const powerups = me.getState('powerups') || {};
  
  const newBullet = {
    id: Math.random().toString(36).substr(2, 9),
    x: pos.x + Math.cos(angle) * 30,
    y: pos.y + Math.sin(angle) * 30,
    vx: Math.cos(angle) * BULLET_SPEED,
    vy: Math.sin(angle) * BULLET_SPEED,
    life: 100,
    damage: powerups.damage > Date.now() ? 25 : 10
  };

  me.setState('bullets', [...bullets, newBullet]);
  sounds.shoot();
}

function createExplosion(x, y, color, intensity = 1) {
  sounds.explosion();
  screenShake = 10 * intensity;
  for (let i = 0; i < 30 * intensity; i++) {
    particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 10,
      vy: (Math.random() - 0.5) * 10,
      life: 1.0,
      color
    });
  }
}

// Game Loop
function gameLoop() {
  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const me = myPlayer();
  if (!me) return requestAnimationFrame(gameLoop);

    const isDead = me.getState('isDead');
  const gameState = getState('gameState') || 'playing';

  // Timer Update
  const endTime = getState('roundEndTime') || 0;
  const timeLeft = Math.max(0, endTime - Date.now());
  if (gameState === 'playing') {
    timerDisplay.classList.remove('hidden');
    resultsScreen.classList.add('hidden');
    resultsScreen.classList.remove('active');
    const m = Math.floor(timeLeft / 60000).toString().padStart(2, '0');
    const s = Math.floor((timeLeft % 60000) / 1000).toString().padStart(2, '0');
    timerDisplay.innerText = `${m}:${s}`;

    if (timeLeft <= 0 && isHost()) {
      setState('gameState', 'results', true);
    }
  } else if (gameState === 'results') {
    timerDisplay.classList.add('hidden');
    if (!resultsScreen.classList.contains('active')) {
      showResults();
    }
  }

  // Update My Player & Powerups
  if (!isDead && gameState === 'playing') {
    const powerups = me.getState('powerups') || {};
    const myPos = me.getState('pos') || { x: 1000, y: 1000 };
    let myAngle = me.getState('angle') || 0;
    const speed = 5;

    let dx = 0;
    let dy = 0;
    if (keys['ArrowUp'] || keys['w']) dy -= speed;
    if (keys['ArrowDown'] || keys['s']) dy += speed;
    if (keys['ArrowLeft'] || keys['a']) dx -= speed;
    if (keys['ArrowRight'] || keys['d']) dx += speed;
    
    if (joystick) {
      try {
        const dpad = joystick.dpad();
        if (dpad.x === 'left') dx -= speed;
        if (dpad.x === 'right') dx += speed;
        if (dpad.y === 'up') dy -= speed;
        if (dpad.y === 'down') dy += speed;
      } catch(err) {
        // Joystick not ready yet
      }
    }

    const obstacles = getState('obstacles') || [];
    const playerRadius = 15;

    // Move X and check collision
    myPos.x += dx;
    for (const obs of obstacles) {
      if (
        myPos.x + playerRadius > obs.x &&
        myPos.x - playerRadius < obs.x + obs.size &&
        myPos.y + playerRadius > obs.y &&
        myPos.y - playerRadius < obs.y + obs.size
      ) {
        myPos.x -= dx; // Revert X
        break;
      }
    }

    // Move Y and check collision
    myPos.y += dy;
    for (const obs of obstacles) {
      if (
        myPos.x + playerRadius > obs.x &&
        myPos.x - playerRadius < obs.x + obs.size &&
        myPos.y + playerRadius > obs.y &&
        myPos.y - playerRadius < obs.y + obs.size
      ) {
        myPos.y -= dy; // Revert Y
        break;
      }
    }

    // Constrain to arena
    myPos.x = Math.max(0, Math.min(ARENA_SIZE, myPos.x));
    myPos.y = Math.max(0, Math.min(ARENA_SIZE, myPos.y));

    if (dx !== 0 || dy !== 0) {
      myAngle = Math.atan2(dy, dx);
    }

    me.setState('pos', myPos);
    me.setState('angle', myAngle);

    // Item Pickup
    const items = getState('items') || [];
    const remainingItems = items.filter(item => {
      const dist = Math.hypot(item.x - myPos.x, item.y - myPos.y);
      if (dist < 40) {
        const newPowerups = { ...powerups };
        newPowerups[item.type] = Date.now() + 10000; // 10s duration
        if (item.type === 'shield') newPowerups.shield = 1; // Shield is one-time
        me.setState('powerups', newPowerups);
        return false;
      }
      return true;
    });
    if (items.length !== remainingItems.length) {
      setState('items', remainingItems, true);
    }

    let isShooting = keys[' '] || mousePressed;
    if (joystick) {
      try {
        if (joystick.isPressed('shoot')) isShooting = true;
      } catch(e) {}
    }

    if (isShooting) {
      shoot(me);
    }
  }

  // Update Bullets & Collisions
  const obstacles = getState('obstacles') || [];
  let obstaclesChanged = false;

  players.forEach(p => {
    let pBullets = p.getState('bullets') || [];
    let updatedBullets = [];
    
    pBullets.forEach(b => {
      b.x += b.vx;
      b.y += b.vy;
      b.life--;

      // Add bullet trail
      if (Math.random() < 0.3) {
        particles.push({
          x: b.x, y: b.y,
          vx: (Math.random() - 0.5) * 2,
          vy: (Math.random() - 0.5) * 2,
          life: 0.5,
          color: p.getProfile().color.hex || '#00f2ff'
        });
      }

      if (b.life > 0) {
        let hit = false;
        
        // Obstacle collision
        obstacles.forEach(obs => {
          if (hit) return;
          if (b.x > obs.x && b.x < obs.x + obs.size && b.y > obs.y && b.y < obs.y + obs.size) {
            obs.health -= b.damage;
            hit = true;
            b.life = 0;
            obstaclesChanged = true;
            createExplosion(b.x, b.y, '#fff', 0.3);
          }
        });

        // Player collision
        if (!hit && p === me) {
          players.forEach(other => {
            if (other === me || other.getState('isDead')) return;
            const otherPos = other.getState('pos');
            if (!otherPos) return; // Safety check for newly joined players
            const dist = Math.hypot(b.x - otherPos.x, b.y - otherPos.y);
            if (dist < 30) {
              hit = true;
              b.life = 0;
              const otherPowerups = other.getState('powerups') || {};
              if (otherPowerups.shield > 0) {
                other.setState('powerups', { ...otherPowerups, shield: 0 });
                createExplosion(b.x, b.y, '#fff', 0.8);
              } else {
                const currentHealth = other.getState('health');
                other.setState('health', currentHealth - b.damage);
                const otherProfile = other.getProfile();
                createExplosion(b.x, b.y, otherProfile.color.hex, 0.5);
                if (currentHealth <= b.damage) {
                  other.setState('isDead', true);
                  createExplosion(otherPos.x, otherPos.y, otherProfile.color.hex, 2);
                  me.setState('score', (me.getState('score') || 0) + 1);
                  setTimeout(() => respawnPlayer(other), 3000);
                }
              }
            }
          });
        }
        if (b.life > 0) updatedBullets.push(b);
      }
    });
    if (p === me) me.setState('bullets', updatedBullets);
  });

  if (obstaclesChanged) {
    setState('obstacles', obstacles.filter(o => o.health > 0), true);
  }

  const myPos = me.getState('pos') || { x: 1000, y: 1000 };
  const camX = canvas.width / 2 - myPos.x + (Math.random() - 0.5) * screenShake;
  const camY = canvas.height / 2 - myPos.y + (Math.random() - 0.5) * screenShake;
  screenShake *= 0.9; // Decay shake

  drawGrid(camX, camY);

  // Draw Items
  const items = getState('items') || [];
  items.forEach(item => {
    ctx.save();
    ctx.translate(item.x + camX, item.y + camY);
    ctx.rotate(Date.now() * 0.005);
    ctx.shadowBlur = 15;
    ctx.shadowColor = item.type === 'invisible' ? '#fff' : (item.type === 'damage' ? '#f00' : '#0f0');
    ctx.fillStyle = ctx.shadowColor;
    ctx.beginPath();
    ctx.arc(0, 0, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  // Draw Obstacles
  obstacles.forEach(obs => {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 2;
    ctx.strokeRect(obs.x + camX, obs.y + camY, obs.size, obs.size);
    ctx.fillRect(obs.x + camX, obs.y + camY, (obs.health / 50) * obs.size, obs.size);
  });

  // Particles
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  particles = particles.filter(p => {
    p.x += p.vx;
    p.y += p.vy;
    p.life -= 0.02;
    if (p.life > 0) {
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.shadowBlur = 10;
      ctx.shadowColor = p.color;
      ctx.beginPath();
      ctx.arc(p.x + camX, p.y + camY, 2, 0, Math.PI * 2);
      ctx.fill();
      return true;
    }
    return false;
  });
  ctx.restore();

  // Draw Players & Bullets
  players.forEach(player => {
    const pos = player.getState('pos');
    const angle = player.getState('angle');
    const health = player.getState('health');
    const dead = player.getState('isDead');
    const profile = player.getProfile();
    const color = profile.color.hex || '#00f2ff';
    const pBullets = player.getState('bullets') || [];

    pBullets.forEach(b => {
      ctx.save();
      ctx.shadowBlur = 15;
      ctx.shadowColor = color;
      
      // Outer glow
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(b.x + camX, b.y + camY, 6, 0, Math.PI * 2);
      ctx.fill();
      
      // Inner core
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(b.x + camX, b.y + camY, 3, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.restore();
    });

    if (pos && !dead) {
      const powerups = player.getState('powerups') || {};
      const isInvisible = powerups.invisible > Date.now();
      
      if (isInvisible) {
        if (player === me) {
          ctx.globalAlpha = 0.3;
          drawPlayer(pos.x + camX, pos.y + camY, angle, color, profile.name, player === me, health, powerups);
          ctx.globalAlpha = 1.0;
        }
      } else {
        drawPlayer(pos.x + camX, pos.y + camY, angle, color, profile.name, player === me, health, powerups);
      }
    } else if (dead && Math.random() < 0.1) {
      createExplosion(pos.x, pos.y, color);
    }
  });

  drawMinimap(me);
  updateScoreBoard();
  requestAnimationFrame(gameLoop);
}

function drawGrid(ox, oy) {
  ctx.strokeStyle = 'rgba(0, 242, 255, 0.05)';
  ctx.lineWidth = 1;
  const step = 100;
  
  ctx.beginPath();
  for (let x = (ox % step + step) % step; x < canvas.width; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
  }
  for (let y = (oy % step + step) % step; y < canvas.height; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
  }
  ctx.stroke();

  // Arena Boundary
  ctx.strokeStyle = 'rgba(255, 0, 234, 0.5)';
  ctx.lineWidth = 4;
  ctx.shadowBlur = 20;
  ctx.shadowColor = 'rgba(255, 0, 234, 0.8)';
  ctx.strokeRect(ox, oy, ARENA_SIZE, ARENA_SIZE);
  ctx.shadowBlur = 0;
}

function drawPlayer(x, y, angle, color, name, isMe, health, powerups) {
  ctx.save();
  ctx.translate(x, y);
  
  // Powerup indicators
  if (powerups.damage > Date.now()) {
    ctx.strokeStyle = '#f00';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 35, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (powerups.shield > 0) {
    ctx.strokeStyle = '#0f0';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 40, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(-22, -42, 44, 8);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(-22, -42, 44, 8);
  
  ctx.fillStyle = health > 30 ? '#39ff14' : '#ff00ea';
  ctx.fillRect(-20, -40, (health / 100) * 40, 4);

  ctx.rotate(angle);
  ctx.shadowBlur = 15;
  ctx.shadowColor = color;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(20, 0);
  ctx.lineTo(-15, -15);
  ctx.lineTo(-15, 15);
  ctx.closePath();
  ctx.fill();

  if (isMe) {
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();

  ctx.fillStyle = 'white';
  ctx.font = '12px Outfit';
  ctx.textAlign = 'center';
  ctx.fillText(name, x, y + 35);
}

function drawMinimap(me) {
  const size = 150;
  const padding = 20;
  const x = canvas.width - size - padding;
  const y = padding + 80; // Move to top right (below header)

  // Background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, 10);
  ctx.fill();
  ctx.stroke();

  const scale = size / ARENA_SIZE;

  players.forEach(p => {
    const pos = p.getState('pos');
    const dead = p.getState('isDead');
    if (!pos || dead) return;

    const px = x + pos.x * scale;
    const py = y + pos.y * scale;
    
    ctx.fillStyle = p === me ? '#fff' : (p.getProfile().color.hex || '#00f2ff');
    
    // Hide invisible players on minimap unless it's me
    const powerups = p.getState('powerups') || {};
    if (powerups.invisible > Date.now() && p !== me) return;

    ctx.beginPath();
    ctx.arc(px, py, p === me ? 3 : 2, 0, Math.PI * 2);
    ctx.fill();
  });

  // Draw obstacles on minimap
  const obstacles = getState('obstacles') || [];
  ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
  obstacles.forEach(obs => {
    ctx.fillRect(x + obs.x * scale, y + obs.y * scale, obs.size * scale, obs.size * scale);
  });
}

function updateScoreBoard() {
  const sorted = [...players].sort((a,b) => (b.getState('score') || 0) - (a.getState('score') || 0));
  scoreBoard.innerHTML = sorted.map(p => `
    <div class="score-item">
      <span>${p.getProfile().name}</span>
      <span>${p.getState('score') || 0}</span>
    </div>
  `).join('');
}

function showResults() {
  resultsScreen.classList.remove('hidden');
  resultsScreen.classList.add('active');
  restartBtn.style.display = isHost() ? 'inline-block' : 'none';
  
  const sorted = [...players].sort((a,b) => (b.getState('score') || 0) - (a.getState('score') || 0));
  finalResults.innerHTML = sorted.map((p, index) => `
    <div style="display:flex; justify-content:space-between; margin-bottom:10px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:5px;">
      <span><strong style="color:var(--neon-pink)">#${index+1}</strong> ${p.getProfile().name}</span>
      <span style="color:var(--neon-blue); font-weight:bold;">${p.getState('score') || 0} PTS</span>
    </div>
  `).join('');
}

startBtn.addEventListener('click', () => {
  setupGame();
});
