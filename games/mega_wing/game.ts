// Mega Wing, ported from mega_wing.py in pyxel/examples/apps/mega_wing.pyxapp
// (Takashi Kitao, MIT; from https://gihyo.jp/book/2025/978-4-297-14657-3).
// A shoot'em up game with lots of bullets. The original's comments are
// translated from Japanese. On the GBA, START stands in for ENTER.
import { system, screen, input, sound, music, math, text } from "retro";
import { f32, len, max, min, push, truncate, type i32 } from "@pocketjs/framework/solid/std";

// Positions and speeds that the original keeps as floats (enemies, bullets,
// blasts and stars) are 16.16 fixed point here: float math is emulated in
// software on the GBA and costs too much for this many objects a frame.
const ONE = 65536;
const HALF = 32768;

/** A 16.16 coordinate rounded to a pixel, halves away from zero as Pyxel rounds floats. */
function pixel(v: i32): i32 {
  return v >= 0 ? (v + HALF) >> 16 : -((-v + HALF) >> 16);
}

/** The hit area (x1, y1, x2, y2) of a character, relative to its position. */
interface HitArea {
  x1: i32;
  y1: i32;
  x2: i32;
  y2: i32;
}

// ---- Background ------------------------------------------------------------

const NUM_STARS = 100; // Number of stars
const STAR_FAST = 117964; // 1.8 in 16.16: faster stars are drawn in color 12

// Star position and speed (a tuple in the original)
interface Star {
  x: i32;
  y: i32;
  vy: i32;
}

// ---- Player ----------------------------------------------------------------

const PLAYER_MOVE_SPEED = 2; // Movement speed
const PLAYER_SHOT_INTERVAL = 6; // Interval between shots
const PLAYER_HIT_AREA: HitArea = { x1: 1, y1: 1, x2: 6, y2: 6 }; // Hit area (x1,y1,x2,y2)

// The player moves by whole pixels, so its position stays an integer.
interface Player {
  x: i32; // X coordinate
  y: i32; // Y coordinate
  shotTimer: i32; // Time left until the next shot
  soundTimer: i32; // Set when a shot hits; the original never reads it
}

// ---- Enemy -----------------------------------------------------------------

const ENEMY_KIND_A = 0; // Enemy A
const ENEMY_KIND_B = 1; // Enemy B
const ENEMY_KIND_C = 2; // Enemy C
const ENEMY_HIT_AREA: HitArea = { x1: 0, y1: 0, x2: 7, y2: 7 };
const SPEED_0_8 = 52429; // 0.8 in 16.16
const SPEED_1_2 = 78643; // 1.2 in 16.16

interface Enemy {
  kind: i32; // Kind of enemy
  level: i32; // Strength
  x: i32;
  y: i32;
  armor: i32; // Armor
  lifeTime: i32; // Time alive
  isDamaged: boolean; // Whether it took damage
  isAlive: boolean; // False once removed from the enemy list
}

// ---- Bullet ----------------------------------------------------------------

const BULLET_SIDE_PLAYER = 0; // Player's bullet
const BULLET_SIDE_ENEMY = 1; // Enemy's bullet
const PLAYER_BULLET_HIT_AREA: HitArea = { x1: 2, y1: 1, x2: 5, y2: 6 };
const ENEMY_BULLET_HIT_AREA: HitArea = { x1: 2, y1: 2, x2: 5, y2: 5 };

interface Bullet {
  side: i32;
  x: i32;
  y: i32;
  vx: i32;
  vy: i32;
  isAlive: boolean; // False once removed from its bullet list
}

// ---- Blast -----------------------------------------------------------------

const BLAST_START_RADIUS = 1; // Radius at the start
const BLAST_END_RADIUS = 8; // Radius at the end

interface Blast {
  x: i32;
  y: i32;
  radius: i32; // Radius of the blast
  isAlive: boolean; // False once removed from the blast list
}

// ---- Game ------------------------------------------------------------------

const SCENE_TITLE = 0; // Title screen
const SCENE_PLAY = 1; // Play screen
const SCENE_GAMEOVER = 2; // Game over screen

// Game state. Removed enemies, bullets and blasts are marked and dropped from
// their lists at the end of update(): the original loops over copies of the
// lists, so an entity removed during a loop is still visited by that loop.
let score = 0; // Score
let scene = SCENE_TITLE; // Current scene
let playTime = 0; // Play time
let level = 0; // Difficulty level
let displayTimer = 0; // Time the game over screen stays
let stars: Star[] = []; // Background: star coordinates and speeds
let hasPlayer = false; // Whether the player exists (self.player is not None)
let player: Player = { x: 0, y: 0, shotTimer: 0, soundTimer: 0 }; // Player
let enemies: Enemy[] = []; // List of enemies
let playerBullets: Bullet[] = []; // List of the player's bullets
let enemyBullets: Bullet[] = []; // List of the enemies' bullets
let blasts: Blast[] = []; // List of blast effects
// Velocities (vx, vy) of enemy C's bullets at i * 45 + 22 degrees and speed 2,
// computed once: soft float makes cos and sin cost thousands of cycles.
let fanVelocities: i32[] = [];
// f"SCORE {score:5}", built again only when the score changes.
let scoreText = "";
let scoreTextValue = -1;

export function setup(): void {
  // Initialize Pyxel
  system.init(120, 160);
  // ENTER (START) starts the game; keep it off A, which fires.
  input.map(input.key.RETURN, input.gba.START);

  // The resource file is loaded from retro.json.

  // Initialize the game state
  score = 0;
  playTime = 0;
  level = 0;
  hasPlayer = false;
  enemies = [];
  playerBullets = [];
  enemyBullets = [];
  blasts = [];
  for (let i = 0; i < 4; i++) {
    push(fanVelocities, bulletVx(f32(i * 45 + 22), 2));
    push(fanVelocities, bulletVy(f32(i * 45 + 22), 2));
  }

  // Create the background (it always exists, whatever the scene)
  createBackground();

  // Change the scene to the title screen
  changeScene(SCENE_TITLE);
}

// ---- Background ------------------------------------------------------------

/** Background.__init__: initializes the stars' coordinates and speeds. */
function createBackground(): void {
  for (let i = 0; i < NUM_STARS; i++) {
    const x = math.rndi(0, system.width() - 1); // X coordinate
    const y = math.rndi(0, system.height() - 1); // Y coordinate
    const vy = math.rndf(1, 2.5); // Speed in Y
    push(stars, { x: x, y: y * ONE, vy: math.int(vy * f32(ONE)) });
  }
}

/** Background.update */
function updateBackground(): void {
  for (let i = 0; i < len(stars); i++) {
    stars[i].y += stars[i].vy;
    if (stars[i].y >= system.height() * ONE) {
      // Out at the bottom of the screen: back to the top
      stars[i].y -= system.height() * ONE;
    }
  }
}

/** Background.draw */
function drawBackground(): void {
  // Draw the galaxy except on the title screen
  if (scene !== SCENE_TITLE) screen.blt(0, 0, 1, 0, 0, 120, 160);

  // Draw the stars
  for (let i = 0; i < len(stars); i++) {
    const color = stars[i].vy > STAR_FAST ? 12 : 5; // Color by speed
    screen.pset(stars[i].x, pixel(stars[i].y), color);
  }
}

// ---- Player ----------------------------------------------------------------

/** Player.__init__: creates the player and registers it with the game. */
function createPlayer(x: i32, y: i32): void {
  player = { x: x, y: y, shotTimer: 0, soundTimer: 0 };
  hasPlayer = true;
}

/** Player.add_damage */
function addPlayerDamage(): void {
  // Create a blast effect
  addBlast((player.x + 4) * ONE, (player.y + 4) * ONE);

  // Stop the music and play the explosion sound
  sound.stop();
  sound.play(0, 2);

  // Remove the player
  hasPlayer = false;

  // Change the scene to the game over screen
  changeScene(SCENE_GAMEOVER);
}

/** Player.update */
function updatePlayer(): void {
  // Move the player with the keys
  if (input.btn(input.key.LEFT) || input.btn(input.pad.DPAD_LEFT)) player.x -= PLAYER_MOVE_SPEED;
  if (input.btn(input.key.RIGHT) || input.btn(input.pad.DPAD_RIGHT)) player.x += PLAYER_MOVE_SPEED;
  if (input.btn(input.key.UP) || input.btn(input.pad.DPAD_UP)) player.y -= PLAYER_MOVE_SPEED;
  if (input.btn(input.key.DOWN) || input.btn(input.pad.DPAD_DOWN)) player.y += PLAYER_MOVE_SPEED;

  // Keep the player inside the screen
  player.x = max(player.x, 0);
  player.x = min(player.x, system.width() - 8);
  player.y = max(player.y, 0);
  player.y = min(player.y, system.height() - 8);

  // Fire bullets
  if (player.shotTimer > 0) {
    // Count down the time until the next shot
    player.shotTimer -= 1;
  }

  if ((input.btn(input.key.SPACE) || input.btn(input.pad.A)) && player.shotTimer === 0) {
    // Create a player bullet
    addBullet(BULLET_SIDE_PLAYER, player.x * ONE, (player.y - 3) * ONE, f32(-90), 5);

    // Play the shot sound
    sound.play(3, 0);

    // Set the time until the next shot
    player.shotTimer = PLAYER_SHOT_INTERVAL;
  }
}

// ---- Enemy -----------------------------------------------------------------

/** Enemy.__init__: creates an enemy at (x, y) in pixels and adds it to the enemy list. */
function addEnemy(kind: i32, level: i32, x: i32, y: i32): void {
  push(enemies, {
    kind: kind,
    level: level,
    x: x * ONE,
    y: y * ONE,
    armor: level - 1,
    lifeTime: 0,
    isDamaged: false,
    isAlive: true,
  });
}

/** Enemy.add_damage for enemy i. */
function addEnemyDamage(i: i32): void {
  if (enemies[i].armor > 0) {
    // While armor remains
    enemies[i].armor -= 1;
    enemies[i].isDamaged = true;

    // Play the damage sound
    sound.play(2, 1, false, true); // Interrupts channel 2
    return;
  }

  // Create a blast effect
  addBlast(enemies[i].x + 4 * ONE, enemies[i].y + 4 * ONE);

  // Play the explosion sound
  sound.play(2, 2, false, true); // Interrupts channel 2

  // Remove the enemy from the list
  enemies[i].isAlive = false;

  // Add to the score
  score += enemies[i].level * 10;
}

/** Enemy.calc_player_angle: the angle from enemy i to the player. */
function calcPlayerAngle(i: i32): f32 {
  if (!hasPlayer) {
    // When there is no player
    return f32(90);
  }
  // When there is a player (the 16.16 scale of both differences cancels out)
  return math.atan2(f32(player.y * ONE - enemies[i].y), f32(player.x * ONE - enemies[i].x));
}

/** Enemy.update for enemy i. */
function updateEnemy(i: i32): void {
  // Count the time alive
  enemies[i].lifeTime += 1;

  if (enemies[i].kind === ENEMY_KIND_A) {
    // Update enemy A
    // Move forward
    enemies[i].y += SPEED_1_2;

    // Fire a bullet toward the player at regular intervals
    if (enemies[i].lifeTime % 50 === 0) {
      const playerAngle = calcPlayerAngle(i);
      addBullet(BULLET_SIDE_ENEMY, enemies[i].x, enemies[i].y, playerAngle, 2);
    }
  } else if (enemies[i].kind === ENEMY_KIND_B) {
    // Update enemy B
    // Move forward
    enemies[i].y += ONE;

    // Move left and right with the elapsed time
    if (math.floordiv(enemies[i].lifeTime, 30) % 2 === 0) {
      enemies[i].x += SPEED_1_2;
    } else {
      enemies[i].x -= SPEED_1_2;
    }
  } else if (enemies[i].kind === ENEMY_KIND_C) {
    // Update enemy C
    // Move forward
    enemies[i].y += SPEED_0_8;

    // Fire bullets in 4 directions at regular intervals (j * 45 + 22 degrees, speed 2)
    if (enemies[i].lifeTime % 40 === 0) {
      for (let j = 0; j < 4; j++)
        pushBullet(BULLET_SIDE_ENEMY, enemies[i].x, enemies[i].y, fanVelocities[j * 2], fanVelocities[j * 2 + 1]);
    }
  }

  // Remove the enemy from the list once it leaves the bottom of the screen
  if (enemies[i].y >= system.height() * ONE) enemies[i].isAlive = false;
}

/** Enemy.draw for enemy i. */
function drawEnemy(i: i32): void {
  if (enemies[i].isDamaged) {
    enemies[i].isDamaged = false;
    for (let c = 1; c < 15; c++) screen.pal(c, 15);
    screen.blt(pixel(enemies[i].x), pixel(enemies[i].y), 0, enemies[i].kind * 8 + 8, 0, 8, 8, 0);
    screen.pal();
  } else {
    screen.blt(pixel(enemies[i].x), pixel(enemies[i].y), 0, enemies[i].kind * 8 + 8, 0, 8, 8, 0);
  }
}

// ---- Bullet ----------------------------------------------------------------

/** Bullet.__init__: a bullet at (x, y) in 16.16 moving at `angle` degrees, added to its side's list. */
function addBullet(side: i32, x: i32, y: i32, angle: f32, speed: i32): void {
  pushBullet(side, x, y, bulletVx(angle, speed), bulletVy(angle, speed));
}

/** A bullet's speed in X in 16.16: pyxel.cos(angle) * speed. */
function bulletVx(angle: f32, speed: i32): i32 {
  return math.round(math.cos(angle) * f32(speed * ONE));
}

/** A bullet's speed in Y in 16.16: pyxel.sin(angle) * speed. */
function bulletVy(angle: f32, speed: i32): i32 {
  return math.round(math.sin(angle) * f32(speed * ONE));
}

/** Bullet.__init__ given the bullet's speed in 16.16. */
function pushBullet(side: i32, x: i32, y: i32, vx: i32, vy: i32): void {
  const bullet: Bullet = { side: side, x: x, y: y, vx: vx, vy: vy, isAlive: true };

  // Register the bullet in the list of its side
  if (side === BULLET_SIDE_PLAYER) push(playerBullets, bullet);
  else push(enemyBullets, bullet);
}

/** Whether a bullet at (x, y) has left the screen. */
function isOffScreen(x: i32, y: i32): boolean {
  return x <= -8 * ONE || x >= system.width() * ONE || y <= -8 * ONE || y >= system.height() * ONE;
}

/** Bullet.update for player bullet i. */
function updatePlayerBullet(i: i32): void {
  // Move the bullet
  playerBullets[i].x += playerBullets[i].vx;
  playerBullets[i].y += playerBullets[i].vy;

  // Remove the bullet from its list once it leaves the screen
  if (isOffScreen(playerBullets[i].x, playerBullets[i].y)) playerBullets[i].isAlive = false;
}

/** Bullet.update for enemy bullet i. */
function updateEnemyBullet(i: i32): void {
  // Move the bullet
  enemyBullets[i].x += enemyBullets[i].vx;
  enemyBullets[i].y += enemyBullets[i].vy;

  // Remove the bullet from its list once it leaves the screen
  if (isOffScreen(enemyBullets[i].x, enemyBullets[i].y)) enemyBullets[i].isAlive = false;
}

/** Bullet.draw */
function drawBullet(side: i32, x: i32, y: i32): void {
  const srcX = side === BULLET_SIDE_PLAYER ? 0 : 8;
  screen.blt(pixel(x), pixel(y), 0, srcX, 8, 8, 8, 0);
}

// ---- Blast -----------------------------------------------------------------

/** Blast.__init__: a blast centered on (x, y) in 16.16, added to the blast list. */
function addBlast(x: i32, y: i32): void {
  push(blasts, { x: x, y: y, radius: BLAST_START_RADIUS, isAlive: true });
}

/** Blast.update for blast i. */
function updateBlast(i: i32): void {
  // Grow the radius
  blasts[i].radius += 1;

  // Remove the blast once its radius reaches the maximum
  if (blasts[i].radius > BLAST_END_RADIUS) blasts[i].isAlive = false;
}

/** Blast.draw for blast i. */
function drawBlast(i: i32): void {
  screen.circ(pixel(blasts[i].x), pixel(blasts[i].y), blasts[i].radius, 7);
  screen.circb(pixel(blasts[i].x), pixel(blasts[i].y), blasts[i].radius, 10);
}

// ---- Collision -------------------------------------------------------------

/**
 * check_collision: whether the hit areas of two characters overlap. Each
 * character is its position in 16.16 and its hit area.
 */
function checkCollision(x1: i32, y1: i32, area1: HitArea, x2: i32, y2: i32, area2: HitArea): boolean {
  const entity1X1 = x1 + area1.x1 * ONE;
  const entity1Y1 = y1 + area1.y1 * ONE;
  const entity1X2 = x1 + area1.x2 * ONE;
  const entity1Y2 = y1 + area1.y2 * ONE;

  const entity2X1 = x2 + area2.x1 * ONE;
  const entity2Y1 = y2 + area2.y1 * ONE;
  const entity2X2 = x2 + area2.x2 * ONE;
  const entity2Y2 = y2 + area2.y2 * ONE;

  // Character 1's left edge is right of character 2's right edge
  if (entity1X1 > entity2X2) return false;

  // Character 1's right edge is left of character 2's left edge
  if (entity1X2 < entity2X1) return false;

  // Character 1's top edge is below character 2's bottom edge
  if (entity1Y1 > entity2Y2) return false;

  // Character 1's bottom edge is above character 2's top edge
  if (entity1Y2 < entity2Y1) return false;

  // None of the above: they overlap
  return true;
}

// ---- Game ------------------------------------------------------------------

/** Game.change_scene */
function changeScene(newScene: i32): void {
  scene = newScene;

  if (scene === SCENE_TITLE) {
    // Title screen
    // Remove the player
    hasPlayer = false;

    // Remove all bullets and enemies
    enemies = [];
    playerBullets = [];
    enemyBullets = [];

    // Play the music
    music.play(0, true);
  } else if (scene === SCENE_PLAY) {
    // Play screen
    // Initialize the play state
    score = 0; // Reset the score to 0
    playTime = 0; // Reset the play time to 0
    level = 1; // Reset the difficulty level to 1

    // Play the music
    music.play(1, true);

    // Create the player
    createPlayer(56, 140);
  } else if (scene === SCENE_GAMEOVER) {
    // Game over screen
    // Set how long the screen stays
    displayTimer = 60;

    // Remove the player
    hasPlayer = false;
  }
}

/** Game.update: updates the whole game. */
export function update(): void {
  // Update the background
  updateBackground();

  // Update the player
  if (hasPlayer) updatePlayer();

  // Update the enemies
  for (let i = 0; i < len(enemies); i++) {
    updateEnemy(i);

    // Check the player against the enemy
    if (
      hasPlayer &&
      checkCollision(player.x * ONE, player.y * ONE, PLAYER_HIT_AREA, enemies[i].x, enemies[i].y, ENEMY_HIT_AREA)
    )
      addPlayerDamage(); // Damage the player
  }

  // Update the player's bullets
  for (let i = 0; i < len(playerBullets); i++) {
    updatePlayerBullet(i);

    // Check the player's bullet against the enemies still in the list
    for (let j = 0; j < len(enemies); j++) {
      if (
        enemies[j].isAlive &&
        checkCollision(
          enemies[j].x,
          enemies[j].y,
          ENEMY_HIT_AREA,
          playerBullets[i].x,
          playerBullets[i].y,
          PLAYER_BULLET_HIT_AREA,
        )
      ) {
        playerBullets[i].isAlive = false; // Damage the player's bullet
        addEnemyDamage(j); // Damage the enemy

        if (hasPlayer) {
          // When the player exists
          player.soundTimer = 5; // Set the time to stop the shot sound
        }
      }
    }
  }

  // Update the enemies' bullets
  for (let i = 0; i < len(enemyBullets); i++) {
    updateEnemyBullet(i);

    // Check the player against the enemy's bullet
    if (
      hasPlayer &&
      checkCollision(
        player.x * ONE,
        player.y * ONE,
        PLAYER_HIT_AREA,
        enemyBullets[i].x,
        enemyBullets[i].y,
        ENEMY_BULLET_HIT_AREA,
      )
    ) {
      enemyBullets[i].isAlive = false; // Damage the enemy's bullet
      addPlayerDamage(); // Damage the player
    }
  }

  // Update the blast effects
  for (let i = 0; i < len(blasts); i++) updateBlast(i);

  // Update the scene
  if (scene === SCENE_TITLE) {
    // Title screen
    if (input.btnp(input.key.RETURN) || input.btnp(input.pad.START)) {
      sound.stop(); // Stop the music
      changeScene(SCENE_PLAY);
    }
  } else if (scene === SCENE_PLAY) {
    // Play screen
    playTime += 1; // Count the play time
    level = math.floordiv(playTime, 450) + 1;
    // Raise the difficulty by 1 every 15 seconds (30 frames a second x 15)

    // Spawn enemies
    const spawnInterval = max(60 - level * 10, 10);
    if (playTime % spawnInterval === 0) {
      const kind = math.rndi(ENEMY_KIND_A, ENEMY_KIND_C);
      addEnemy(kind, level, math.rndi(0, 112), -8);
    }
  } else if (scene === SCENE_GAMEOVER) {
    // Game over screen
    if (displayTimer > 0) {
      // While the screen still has time to stay
      displayTimer -= 1;
    } else {
      // When its time is up
      changeScene(SCENE_TITLE);
    }
  }

  // Drop the entities removed this frame from their lists
  compactEnemies();
  compactPlayerBullets();
  compactEnemyBullets();
  compactBlasts();
}

// In-place filters of the entity lists, keeping their order: filter() would
// allocate a new list every frame.

function compactEnemies(): void {
  let n = 0;
  for (let i = 0; i < len(enemies); i++)
    if (enemies[i].isAlive) {
      if (n < i) enemies[n] = enemies[i];
      n++;
    }
  truncate(enemies, n);
}

function compactPlayerBullets(): void {
  let n = 0;
  for (let i = 0; i < len(playerBullets); i++)
    if (playerBullets[i].isAlive) {
      if (n < i) playerBullets[n] = playerBullets[i];
      n++;
    }
  truncate(playerBullets, n);
}

function compactEnemyBullets(): void {
  let n = 0;
  for (let i = 0; i < len(enemyBullets); i++)
    if (enemyBullets[i].isAlive) {
      if (n < i) enemyBullets[n] = enemyBullets[i];
      n++;
    }
  truncate(enemyBullets, n);
}

function compactBlasts(): void {
  let n = 0;
  for (let i = 0; i < len(blasts); i++)
    if (blasts[i].isAlive) {
      if (n < i) blasts[n] = blasts[i];
      n++;
    }
  truncate(blasts, n);
}

/** Game.draw: draws the whole game. */
export function draw(): void {
  // Clear the screen
  screen.cls(0);

  // Draw the background
  drawBackground();

  // Draw the player
  if (hasPlayer) screen.blt(player.x, player.y, 0, 0, 0, 8, 8, 0);

  // Draw the enemies
  for (let i = 0; i < len(enemies); i++) drawEnemy(i);

  // Draw the player's bullets
  for (let i = 0; i < len(playerBullets); i++)
    drawBullet(playerBullets[i].side, playerBullets[i].x, playerBullets[i].y);

  // Draw the enemies' bullets
  for (let i = 0; i < len(enemyBullets); i++) drawBullet(enemyBullets[i].side, enemyBullets[i].x, enemyBullets[i].y);

  // Draw the blast effects
  for (let i = 0; i < len(blasts); i++) drawBlast(i);

  // Draw the score
  if (score !== scoreTextValue) {
    scoreText = `SCORE ${text.rjust(text.str(score), 5)}`;
    scoreTextValue = score;
  }
  screen.text(39, 4, scoreText, 7);

  // Draw the scene
  if (scene === SCENE_TITLE) {
    // Title screen
    screen.blt(0, 18, 2, 0, 0, 120, 120, 15);
    screen.text(31, 148, "- PRESS START -", 6);
  } else if (scene === SCENE_GAMEOVER) {
    // Game over screen
    screen.text(43, 78, "GAME OVER", 8);
  }
}
