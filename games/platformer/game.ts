// Pyxel Platformer, ported from pyxel/examples/10_platformer.py (Takashi Kitao, MIT).
import { system, screen, image, tilemap, input, sound, music, math } from "retro";
import { abs, f32, filter, len, push, type f32 as F32, type i32 } from "@pocketjs/framework/solid/std";

const TRANSPARENT_COLOR = 2;
const SCROLL_BORDER_X = 80;
const WALL_TILE_X = 4;

// Enemy kinds; a bullet is Enemy3's projectile.
const ENEMY1 = 1;
const ENEMY2 = 2;
const ENEMY3 = 3;
const BULLET = 4;

interface Enemy {
  kind: i32;
  x: i32;
  y: i32;
  dx: i32;
  dy: i32;
  direction: i32;
  timeToFire: i32;
  // Enemy3Bullet moves in floats.
  fx: F32;
  fy: F32;
  fdx: F32;
  fdy: F32;
  isAlive: boolean;
}

let scrollX: i32 = 0;
let playerX: i32 = 0;
let playerY: i32 = 0;
let playerDx: i32 = 0;
let playerDy: i32 = 0;
let playerDirection: i32 = 1;
let playerFalling: boolean = false;
let enemies: Enemy[] = [];
let wallTiles: i32 = 0;
let wallTilesWithFloor: i32 = 0;

function tileFloor(): i32 {
  return tilemap.tile(1, 0);
}

function getTile(tileX: i32, tileY: i32): i32 {
  return tilemap.pget(0, tileX, tileY);
}

function isWall(x: i32, y: i32): boolean {
  const t = getTile(math.floordiv(x, 8), math.floordiv(y, 8));
  return t === tileFloor() || tilemap.tileX(t) >= WALL_TILE_X;
}

function pushBack(x: i32, y: i32, dx: i32, dy: i32): { x: i32; y: i32 } {
  const d = tilemap.collide(0, x, y, 8, 8, dx, dy, dy > 0 ? wallTilesWithFloor : wallTiles);
  return { x: x + d.dx, y: y + d.dy };
}

function enemy(kind: i32, x: i32, y: i32, direction: i32): Enemy {
  return {
    kind: kind,
    x: x,
    y: y,
    dx: 0,
    dy: 0,
    direction: direction,
    timeToFire: 0,
    fx: f32(x),
    fy: f32(y),
    fdx: f32(0),
    fdy: f32(0),
    isAlive: true,
  };
}

export function setup(): void {
  system.init(128, 128);

  // Wall tiles: every tile with u >= 4; the floor tile only blocks falls.
  const wallList: i32[] = [];
  for (let u = WALL_TILE_X; u < 32; u++) for (let v = 0; v < 32; v++) push(wallList, tilemap.tile(u, v));
  wallTiles = tilemap.walls(wallList);
  push(wallList, tileFloor());
  wallTilesWithFloor = tilemap.walls(wallList);

  // Make enemy spawn tiles invisible
  image.rect(0, 0, 8, 24, 8, TRANSPARENT_COLOR);

  spawnEnemy(0, 127);
  music.play(0, true);
}

export function update(): void {
  updatePlayer();
  for (let i = 0; i < len(enemies); i++) {
    if (abs(playerX - enemies[i].x) < 6 && abs(playerY - enemies[i].y) < 6) {
      gameOver();
      return;
    }
    updateEnemy(i);
    if (enemies[i].x < scrollX - 8 || enemies[i].x > scrollX + 160 || enemies[i].y > 160) enemies[i].isAlive = false;
  }
  enemies = filter(enemies, (e) => e.isAlive);
}

function updatePlayer(): void {
  const lastY = playerY;
  if (input.btn(input.key.left) || input.btn(input.pad.left)) {
    playerDx = -2;
    playerDirection = -1;
  }
  if (input.btn(input.key.right) || input.btn(input.pad.right)) {
    playerDx = 2;
    playerDirection = 1;
  }
  playerDy = playerDy + 1 < 3 ? playerDy + 1 : 3;
  if (input.btnp(input.key.space) || input.btnp(input.pad.a)) {
    playerDy = -6;
    sound.play(3, 8);
  }
  const moved = pushBack(playerX, playerY, playerDx, playerDy);
  playerX = moved.x > scrollX ? moved.x : scrollX;
  playerY = moved.y > 0 ? moved.y : 0;
  playerDx = math.int(f32(playerDx) * f32(0.8));
  playerFalling = playerY > lastY;

  if (playerX > scrollX + SCROLL_BORDER_X) {
    const lastScrollX = scrollX;
    scrollX = playerX - SCROLL_BORDER_X < 240 * 8 ? playerX - SCROLL_BORDER_X : 240 * 8;
    spawnEnemy(lastScrollX + 128, scrollX + 127);
  }
  if (playerY >= system.height()) gameOver();
}

function updateEnemy(i: i32): void {
  const kind = enemies[i].kind,
    x = enemies[i].x,
    y = enemies[i].y;
  if (kind === ENEMY1) {
    enemies[i].dx = enemies[i].direction;
    enemies[i].dy = enemies[i].dy + 1 < 3 ? enemies[i].dy + 1 : 3;
    if (enemies[i].direction < 0 && isWall(x - 1, y + 4)) enemies[i].direction = 1;
    else if (enemies[i].direction > 0 && isWall(x + 8, y + 4)) enemies[i].direction = -1;
    moveEnemy(i);
  } else if (kind === ENEMY2) {
    enemies[i].dx = enemies[i].direction;
    enemies[i].dy = enemies[i].dy + 1 < 3 ? enemies[i].dy + 1 : 3;
    if (isWall(x, y + 8) || isWall(x + 7, y + 8)) {
      if (enemies[i].direction < 0 && (isWall(x - 1, y + 4) || !isWall(x - 1, y + 8))) enemies[i].direction = 1;
      else if (enemies[i].direction > 0 && (isWall(x + 8, y + 4) || !isWall(x + 7, y + 8))) enemies[i].direction = -1;
    }
    moveEnemy(i);
  } else if (kind === ENEMY3) {
    enemies[i].timeToFire -= 1;
    if (enemies[i].timeToFire <= 0) {
      const dx = playerX - x,
        dy = playerY - y;
      const sqDist = dx * dx + dy * dy;
      if (sqDist < 60 * 60) {
        const dist = math.sqrt(f32(sqDist));
        const bullet = enemy(BULLET, x, y, 0);
        bullet.fdx = f32(dx) / dist;
        bullet.fdy = f32(dy) / dist;
        push(enemies, bullet);
        enemies[i].timeToFire = 60;
      }
    }
  } else {
    enemies[i].fx += enemies[i].fdx;
    enemies[i].fy += enemies[i].fdy;
    enemies[i].x = math.round(enemies[i].fx);
    enemies[i].y = math.round(enemies[i].fy);
  }
}

function moveEnemy(i: i32): void {
  const moved = pushBack(enemies[i].x, enemies[i].y, enemies[i].dx, enemies[i].dy);
  enemies[i].x = moved.x;
  enemies[i].y = moved.y;
}

function spawnEnemy(leftX: i32, rightX: i32): void {
  const left = math.ceil(f32(leftX) / f32(8)),
    right = math.floor(f32(rightX) / f32(8));
  for (let x = left; x <= right; x++) {
    for (let y = 0; y < 16; y++) {
      const t = getTile(x, y);
      if (t === tilemap.tile(0, 1)) push(enemies, enemy(ENEMY1, x * 8, y * 8, -1));
      else if (t === tilemap.tile(1, 1)) push(enemies, enemy(ENEMY2, x * 8, y * 8, 1));
      else if (t === tilemap.tile(2, 1)) push(enemies, enemy(ENEMY3, x * 8, y * 8, 0));
    }
  }
}

function gameOver(): void {
  scrollX = 0;
  playerX = 0;
  playerY = 0;
  playerDx = 0;
  playerDy = 0;
  enemies = [];
  spawnEnemy(0, 127);
  sound.play(3, 9);
}

export function draw(): void {
  screen.cls(0);

  // Draw level
  screen.camera();
  screen.bltm(0, 0, 0, math.mod(math.floordiv(scrollX, 4), 128), 128, 128, 128);
  screen.bltm(0, 0, 0, scrollX, 0, 128, 128, TRANSPARENT_COLOR);

  // Draw characters
  screen.camera(scrollX, 0);
  const u = (playerFalling ? 2 : math.mod(math.floordiv(system.frameCount(), 3), 2)) * 8;
  screen.blt(playerX, playerY, 0, u, 16, playerDirection > 0 ? 8 : -8, 8, TRANSPARENT_COLOR);
  for (const e of enemies) {
    if (e.kind === ENEMY1) {
      screen.blt(
        e.x,
        e.y,
        0,
        math.mod(math.floordiv(system.frameCount(), 4), 2) * 8,
        24,
        e.direction > 0 ? 8 : -8,
        8,
        TRANSPARENT_COLOR,
      );
    } else if (e.kind === ENEMY2) {
      screen.blt(
        e.x,
        e.y,
        0,
        math.mod(math.floordiv(system.frameCount(), 4), 2) * 8 + 16,
        24,
        e.direction > 0 ? 8 : -8,
        8,
        TRANSPARENT_COLOR,
      );
    } else if (e.kind === ENEMY3) {
      screen.blt(e.x, e.y, 0, math.mod(math.floordiv(system.frameCount(), 8), 2) * 8, 32, 8, 8, TRANSPARENT_COLOR);
    } else {
      screen.blt(e.x, e.y, 0, math.mod(math.floordiv(system.frameCount(), 2), 2) * 8 + 16, 32, 8, 8, TRANSPARENT_COLOR);
    }
  }
}
