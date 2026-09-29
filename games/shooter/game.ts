// Pyxel Shooter, ported from pyxel/examples/09_shooter.py (Takashi Kitao, MIT).
// On the GBA, START stands in for ENTER.
import { system, screen, image, input, sound, music, math, text } from "retro";
import { f32, filter, len, push, type i32 } from "@pocketjs/framework/solid/std";

const SCENE_TITLE = 0;
const SCENE_PLAY = 1;
const SCENE_GAMEOVER = 2;

const NUM_STARS = 100;
const STAR_COLOR_HIGH = 12;
const STAR_COLOR_LOW = 5;

const PLAYER_WIDTH = 8;
const PLAYER_HEIGHT = 8;
const PLAYER_SPEED = 2;

const BULLET_WIDTH = 2;
const BULLET_HEIGHT = 8;
const BULLET_COLOR = 11;
const BULLET_SPEED = 4;

const ENEMY_WIDTH = 8;
const ENEMY_HEIGHT = 8;
// ENEMY_SPEED is 1.5; enemies and blasts keep positions in half pixels, which
// represent every value they reach exactly (see half()).
const ENEMY_SPEED_HALVES = 3;

const BLAST_START_RADIUS = 1;
const BLAST_END_RADIUS = 8;
const BLAST_COLOR_IN = 7;
const BLAST_COLOR_OUT = 10;

// Star positions and speeds are 16.16 fixed point: float math is emulated in
// software on the GBA and costs too much for a hundred stars a frame.
interface Star {
  x: i32;
  y: i32;
  speed: i32;
}
const ONE = 65536;
const STAR_FAST = 117965; // 1.8

// The player and bullets move by whole pixels, so their positions stay integers.
interface Bullet {
  x: i32;
  y: i32;
  isAlive: boolean;
}

interface Enemy {
  x: i32;
  y: i32;
  direction: i32;
  timerOffset: i32;
  isAlive: boolean;
}

interface Blast {
  x: i32;
  y: i32;
  radius: i32;
  isAlive: boolean;
}

let scene = SCENE_TITLE;
let score = 0;
let stars: Star[] = [];
let playerX = 0;
let playerY = 0;
let enemies: Enemy[] = [];
let bullets: Bullet[] = [];
let blasts: Blast[] = [];

export function setup(): void {
  system.init(120, 160);
  // ENTER starts and restarts; keep it off A, which fires.
  input.map(input.key.RETURN, input.gba.START);
  initImage();
  initSound();
  scene = SCENE_TITLE;
  score = 0;
  for (let i = 0; i < NUM_STARS; i++)
    push(stars, {
      x: math.rndi(0, system.width() - 1),
      y: math.rndi(0, system.height() - 1) * ONE,
      speed: math.int(math.rndf(1, 2.5) * f32(ONE)),
    });
  playerX = math.floordiv(system.width(), 2);
  playerY = system.height() - 20;
  music.play(0, true);
}

function initImage(): void {
  // Create the player sprite
  image.set(0, 0, 0, ["00c00c00", "0c7007c0", "0c7007c0", "c703b07c", "77033077", "785cc587", "85c77c58", "0c0880c0"]);
  // Create the enemy sprite
  image.set(0, 8, 0, ["00088000", "00ee1200", "08e2b180", "02882820", "00222200", "00012280", "08208008", "80008000"]);
}

function initSound(): void {
  // Define sound effects
  sound.set(0, "a3a2c1a1", "p", "7", "s", 5);
  sound.set(1, "a3a2c2c2", "n", "7742", "s", 10);

  // Define title music
  let a1 = "T128 Q96 @2 @ENV1{127,6,96} O4 L16 @VIB1{36,18,25} K-2";
  let a2 = "D8.C8.D4G8AB->CD C8.<F2R FFGA B-8.A8.B-4.GGAB-";
  const a3 = "RR>CC<B->C8 D8.D8CD8.<";

  let b1 = "T128 Q90 @0 V96 O3 L16";
  let b2 = "FFR4 FFR4 <F4> E-E-R4 E-E-R4 <E-4> D-D-R4 D-D-R4 <D-4> E-E-R4 E-E-R4 EEE8";

  let c1 = "T128 Q50 @3 L16 @ENV1{48,8,0} @ENV2{127,6,0}";
  let c2 = "[@ENV1 O7 FFR4 FFR4 @ENV2 O3 G4]3 @ENV1 O7 FFR4 FFR4 FF @ENV2 O3 G8";

  sound.mml(2, a1 + a2 + a3);
  sound.mml(3, b1 + b2);
  sound.mml(4, c1 + c2);
  music.set(0, [2], [3], [4]);

  // Define gameplay music
  a1 = "T150 Q96 @1 @ENV1{127,12,64} O4 L16";
  const a4 = "RR>CC<B->C8 D8.D8C<A8G&1";

  b1 = "T150 Q96 @1 @ENV1{112,12,56} @ENV2{64,8,0} O4 L16 @ENV1 ";
  b2 = "<B-8.A8.B-4>D8DDGB- A8.<A2R AA>CF G8.F8.G4.E-E-FG";
  const b3 = "RRAAGA8 A8.A8GA8.";
  const b4 = "RRAAGA8 A8.A8GD8 Q100 C&4.<B4. @3 O7 @ENV2 FFFF";

  c1 = "T150 Q100 @0 V96 O3 L16 @GLI1{400,4} @GLI0 ";
  c2 = "[<G.R32>DG]4 [<F.R32>CF]4 [<E-.R32B->E-]4";
  const c3 = "Q80 <F8FF>F<F8 F+8RF+8>F+<F+8.>";
  const c4 = "Q80 @GLI0 <F8FF>F<F8F+8RF+8>F+<F+8 Q100 G8R>DG<[G.R32>DG<]2 @GLI1 Q50 >>CC<F8>";

  sound.mml(5, a1 + a2 + a3 + a2 + a4);
  sound.mml(6, b1 + b2 + b3 + b2 + b4);
  sound.mml(7, c1 + c2 + c3 + c2 + c4);
  music.set(1, [5], [6], [7]);
}

// ---- Update ----------------------------------------------------------------

export function update(): void {
  updateBackground();
  if (scene === SCENE_TITLE) updateTitleScene();
  else if (scene === SCENE_PLAY) updatePlayScene();
  else if (scene === SCENE_GAMEOVER) updateGameoverScene();
}

function updateBackground(): void {
  for (let i = 0; i < len(stars); i++) {
    stars[i].y += stars[i].speed;
    if (stars[i].y >= system.height() * ONE) stars[i].y -= system.height() * ONE;
  }
}

function updateTitleScene(): void {
  if (input.btnp(input.key.RETURN) || input.btnp(input.pad.START)) {
    scene = SCENE_PLAY;
    music.play(1, true);
  }
}

/** Adds a blast at (x, y) in half pixels. */
function spawnBlast(x: i32, y: i32): void {
  push(blasts, { x: x, y: y, radius: BLAST_START_RADIUS, isAlive: true });
}

/** A half-pixel coordinate rounded to a pixel, halves away from zero as Pyxel rounds. */
function half(v: i32): i32 {
  return v >= 0 ? (v + 1) >> 1 : -((-v + 1) >> 1);
}

function updatePlayScene(): void {
  if (system.frameCount() % 6 === 0)
    push(enemies, {
      x: math.rndi(0, system.width() - ENEMY_WIDTH) * 2,
      y: 0,
      direction: 1,
      timerOffset: math.rndi(0, 59),
      isAlive: true,
    });

  // Resolve bullet-enemy collisions
  for (let e = 0; e < len(enemies); e++) {
    for (let b = 0; b < len(bullets); b++) {
      const bx = bullets[b].x * 2,
        by = bullets[b].y * 2;
      if (
        enemies[e].x + ENEMY_WIDTH * 2 > bx &&
        bx + BULLET_WIDTH * 2 > enemies[e].x &&
        enemies[e].y + ENEMY_HEIGHT * 2 > by &&
        by + BULLET_HEIGHT * 2 > enemies[e].y
      ) {
        enemies[e].isAlive = false;
        bullets[b].isAlive = false;
        spawnBlast(enemies[e].x + ENEMY_WIDTH, enemies[e].y + ENEMY_HEIGHT);
        sound.play(2, 1, false, true);
        score += 10;
      }
    }
  }

  // Resolve player-enemy collisions
  for (let e = 0; e < len(enemies); e++) {
    const px = playerX * 2,
      py = playerY * 2;
    if (
      px + PLAYER_WIDTH * 2 > enemies[e].x &&
      enemies[e].x + ENEMY_WIDTH * 2 > px &&
      py + PLAYER_HEIGHT * 2 > enemies[e].y &&
      enemies[e].y + ENEMY_HEIGHT * 2 > py
    ) {
      enemies[e].isAlive = false;
      spawnBlast(px + PLAYER_WIDTH, py + PLAYER_HEIGHT);
      sound.stop();
      sound.play(3, 1);
      scene = SCENE_GAMEOVER;
    }
  }

  updatePlayer();
  updateEntities();
}

function updatePlayer(): void {
  if (input.btn(input.key.LEFT) || input.btn(input.pad.DPAD_LEFT)) playerX -= PLAYER_SPEED;
  if (input.btn(input.key.RIGHT) || input.btn(input.pad.DPAD_RIGHT)) playerX += PLAYER_SPEED;
  if (input.btn(input.key.UP) || input.btn(input.pad.DPAD_UP)) playerY -= PLAYER_SPEED;
  if (input.btn(input.key.DOWN) || input.btn(input.pad.DPAD_DOWN)) playerY += PLAYER_SPEED;

  playerX = math.clamp(playerX, 0, system.width() - PLAYER_WIDTH);
  playerY = math.clamp(playerY, 0, system.height() - PLAYER_HEIGHT);

  if (input.btnp(input.key.SPACE) || input.btnp(input.pad.A)) {
    push(bullets, {
      x: playerX + math.floordiv(PLAYER_WIDTH - BULLET_WIDTH, 2),
      y: playerY - math.floordiv(BULLET_HEIGHT, 2),
      isAlive: true,
    });
    sound.play(3, 0);
  }
}

/** update_entities for bullets, enemies and blasts, then cleanup_entities. */
function updateEntities(): void {
  for (let i = 0; i < len(bullets); i++) {
    bullets[i].y -= BULLET_SPEED;
    if (bullets[i].y + BULLET_HEIGHT - 1 < 0) bullets[i].isAlive = false;
  }
  for (let i = 0; i < len(enemies); i++) {
    if ((system.frameCount() + enemies[i].timerOffset) % 60 < 30) {
      enemies[i].x += ENEMY_SPEED_HALVES;
      enemies[i].direction = 1;
    } else {
      enemies[i].x -= ENEMY_SPEED_HALVES;
      enemies[i].direction = -1;
    }
    enemies[i].y += ENEMY_SPEED_HALVES;
    if (enemies[i].y > (system.height() - 1) * 2) enemies[i].isAlive = false;
  }
  for (let i = 0; i < len(blasts); i++) {
    blasts[i].radius += 1;
    if (blasts[i].radius > BLAST_END_RADIUS) blasts[i].isAlive = false;
  }
  enemies = filter(enemies, (e) => e.isAlive);
  bullets = filter(bullets, (b) => b.isAlive);
  blasts = filter(blasts, (b) => b.isAlive);
}

function updateGameoverScene(): void {
  updateEntities();
  if (input.btnp(input.key.RETURN) || input.btnp(input.pad.START)) {
    scene = SCENE_PLAY;
    playerX = math.floordiv(system.width(), 2);
    playerY = system.height() - 20;
    score = 0;
    enemies = [];
    bullets = [];
    blasts = [];
    music.play(1, true);
  }
}

// ---- Draw ------------------------------------------------------------------

export function draw(): void {
  screen.cls(0);
  for (const star of stars)
    screen.pset(star.x, (star.y + (ONE >> 1)) >> 16, star.speed > STAR_FAST ? STAR_COLOR_HIGH : STAR_COLOR_LOW);

  if (scene === SCENE_TITLE) drawTitleScene();
  else if (scene === SCENE_PLAY) drawPlayScene();
  else if (scene === SCENE_GAMEOVER) drawGameoverScene();

  screen.text(39, 4, "SCORE " + text.rjust(text.str(score), 5), 7);
}

function drawTitleScene(): void {
  screen.text(35, 66, "Pyxel Shooter", system.frameCount() % 16);
  screen.text(31, 126, "- PRESS START -", 13);
}

function drawEntities(): void {
  for (const bullet of bullets) screen.rect(bullet.x, bullet.y, BULLET_WIDTH, BULLET_HEIGHT, BULLET_COLOR);
  for (const enemy of enemies)
    screen.blt(half(enemy.x), half(enemy.y), 0, 8, 0, ENEMY_WIDTH * enemy.direction, ENEMY_HEIGHT, 0);
  for (const blast of blasts) {
    screen.circ(half(blast.x), half(blast.y), blast.radius, BLAST_COLOR_IN);
    screen.circb(half(blast.x), half(blast.y), blast.radius, BLAST_COLOR_OUT);
  }
}

function drawPlayScene(): void {
  screen.blt(playerX, playerY, 0, 0, 0, PLAYER_WIDTH, PLAYER_HEIGHT, 0);
  drawEntities();
}

function drawGameoverScene(): void {
  drawEntities();
  screen.text(43, 66, "GAME OVER", 8);
  screen.text(31, 126, "- PRESS START -", 13);
}
