// Cursed Caverns, ported from pyxel/examples/apps/cursed_caverns.pyxapp
// (main.py, game.py, constants.py, collision.py, scenes/*.py, entities/*.py;
// Takashi Kitao, MIT), the sample game of the book
// https://gihyo.jp/book/2025/978-4-297-14657-3: a platformer to avoid traps
// and collect gems.
//
// Each module of the original is a section of this file, in the same order
// as its imports. The Game class and its scenes became module state and
// functions (changeScene() dispatches on the scene name); the player is a set
// of module-level variables, and the enemies (Slime, Mummy, Flower, Pollen)
// share one Enemy record told apart by `kind`.
import { system, screen, tilemap, input, sound, music, math, text } from "retro";
import {
  abs,
  f32,
  fill,
  filter,
  idiv,
  len,
  max,
  min,
  push,
  type f64 as F64,
  type i32,
} from "@pocketjs/framework/solid/std";

// ---- constants.py: 定数モジュール ----------------------------------------

const SCROLL_BORDER_X = 80; // スクロール境界X座標
// プレイヤーがこの座標を超えたらスクロールさせる

// タイル種別
const TILE_NONE = 0; // 何もない
const TILE_GEM = 1; // 宝石
const TILE_EXIT = 2; // 出口
const TILE_MUSHROOM = 3; // キノコ
const TILE_SPIKE = 4; // トゲ
const TILE_LAVA = 5; // 溶岩
const TILE_WALL = 6; // 壁
const TILE_SLIME1_POINT = 7; // グリーンスライム出現位置
const TILE_SLIME2_POINT = 8; // レッドスライム出現位置
const TILE_MUMMY_POINT = 9; // マミー出現位置
const TILE_FLOWER_POINT = 10; // フラワー出現位置

// タイル→タイル種別変換テーブル
// (the dict's entries as tile x, tile y, tile type triples)
const TILE_TO_TILETYPE: i32[] = [
  1,
  0,
  TILE_GEM,
  2,
  0,
  TILE_EXIT,
  3,
  0,
  TILE_MUSHROOM,
  4,
  0,
  TILE_SPIKE,
  5,
  0,
  TILE_LAVA,
  1,
  2,
  TILE_WALL,
  2,
  2,
  TILE_WALL,
  3,
  2,
  TILE_WALL,
  4,
  2,
  TILE_WALL,
  5,
  2,
  TILE_WALL,
  6,
  2,
  TILE_WALL,
  7,
  2,
  TILE_WALL,
  1,
  3,
  TILE_WALL,
  2,
  3,
  TILE_WALL,
  1,
  4,
  TILE_WALL,
  1,
  5,
  TILE_WALL,
  0,
  9,
  TILE_SLIME1_POINT,
  0,
  10,
  TILE_SLIME2_POINT,
  0,
  11,
  TILE_MUMMY_POINT,
  0,
  12,
  TILE_FLOWER_POINT,
];
// このテーブルにないタイルはTILE_NONEとして判定する

/** TILE_TO_TILETYPE over the 32 x 32 tiles of an image bank, at tile y * 32 + tile x; made in setup(). */
let tileTypes: i32[] = [];

// ---- collision.py: 衝突処理モジュール ------------------------------------

// 指定した座標のタイル種別を取得する
function getTileType(x: i32, y: i32): i32 {
  const tile = tilemap.pget(0, x >> 3, y >> 3); // x // 8, y // 8
  const tx = tilemap.tileX(tile);
  const ty = tilemap.tileY(tile);
  return tx < 32 && ty < 32 ? tileTypes[ty * 32 + tx] : TILE_NONE;
}

// 指定した座標が壁と重なっているか判定する
function inCollision(x: i32, y: i32): boolean {
  return getTileType(x, y) === TILE_WALL;
}

// キャラクターが壁と重なっているか判定する
function isCharacterColliding(x: i32, y: i32): boolean {
  // キャラクターと重なっているタイル座標の領域を計算する
  // (positions are integers, which pyxel.floor and pyxel.ceil keep)
  const x1 = x >> 3;
  const y1 = y >> 3;
  const x2 = (x + 7) >> 3;
  const y2 = (y + 7) >> 3;

  // タイル座標の領域が壁と重なっているかどうかを判定する
  for (let yi = y1; yi <= y2; yi++) {
    for (let xi = x1; xi <= x2; xi++) {
      if (inCollision(xi * 8, yi * 8)) {
        return true; // 壁と衝突している
      }
    }
  }

  return false; // 壁と衝突していない
}

interface Position {
  x: i32;
  y: i32;
}

// 押し戻した座標を返す
function pushBack(startX: i32, startY: i32, startDx: i32, startDy: i32): Position {
  let x = startX;
  let y = startY;
  let dx = startDx;
  let dy = startDy;

  // 壁と衝突するまで垂直方向に移動する
  const stepsY = abs(dy);
  for (let n = 0; n < stepsY; n++) {
    const step = math.clamp(dy, -1, 1);
    if (isCharacterColliding(x, y + step)) {
      break;
    }
    y += step;
    dy -= step;
  }

  // 壁と衝突するまで水平方向に移動する
  const stepsX = abs(dx);
  for (let n = 0; n < stepsX; n++) {
    const step = math.clamp(dx, -1, 1);
    if (isCharacterColliding(x + step, y)) {
      break;
    }
    x += step;
    dx -= step;
  }

  return { x: x, y: y };
}

// ---- entities/player.py: プレイヤークラス --------------------------------

// The player (game.player), which is None while hasPlayer is false.
let hasPlayer: boolean = false;
let playerX: i32 = 0; // X座標
let playerY: i32 = 0; // Y座標
let playerDx: i32 = 0; // X軸方向の移動距離
let playerDy: i32 = 0; // Y軸方向の移動距離
let playerDirection: i32 = 1; // 左右の移動方向
let playerJumpCounter: i32 = 0; // ジャンプ時間

// プレイヤーを初期化する
function newPlayer(x: i32, y: i32): void {
  hasPlayer = true;
  playerX = x;
  playerY = y;
  playerDx = 0;
  playerDy = 0;
  playerDirection = 1;
  playerJumpCounter = 0;
}

// プレイヤーを更新する
function updatePlayer(): void {
  // キー入力に応じて左右に移動する
  if (input.btn(input.key.LEFT) || input.btn(input.pad.DPAD_LEFT)) {
    // 左キーまたはゲームパッド左ボタンが押されている時
    playerDx = -2;
    playerDirection = -1;
  }

  if (input.btn(input.key.RIGHT) || input.btn(input.pad.DPAD_RIGHT)) {
    // 右キーまたはゲームパッド右ボタンが押されている時
    playerDx = 2;
    playerDirection = 1;
  }

  // 下方向に加速する
  if (playerJumpCounter > 0) {
    // ジャンプ中
    playerJumpCounter -= 1; // ジャンプ時間を減らす
  } else {
    // ジャンプしていない時
    playerDy = min(playerDy + 1, 4); // 下方向に加速する
  }

  // タイルとの接触処理 (i and j take 1, then 6)
  for (let i = 1; i <= 6; i += 5) {
    for (let j = 1; j <= 6; j += 5) {
      const x = playerX + j;
      const y = playerY + i;
      const tileType = getTileType(x, y);

      if (tileType === TILE_GEM) {
        // 宝石に触れた時
        // スコアを加算する
        score += 10;

        // 宝石タイルを消す
        tilemap.pset(0, x >> 3, y >> 3, tilemap.tile(0, 0));

        // 効果音を再生する
        sound.play(3, 1);
      }

      if (playerDy >= 0 && tileType === TILE_MUSHROOM) {
        // キノコに触れた時
        // ジャンプの距離を設定する
        playerDy = -6;
        playerJumpCounter = 6;

        // 効果音を再生する
        sound.play(3, 2);
      }

      if (tileType === TILE_EXIT) {
        // 出口に到達した時
        changeScene(SCENE_CLEAR);
        return;
      }

      if (tileType === TILE_SPIKE || tileType === TILE_LAVA) {
        // トゲ又は溶岩に触れた時
        changeScene(SCENE_GAMEOVER);
        return;
      }
    }
  }

  // ジャンプする
  if (
    playerDy >= 0 &&
    (inCollision(playerX, playerY + 8) || inCollision(playerX + 7, playerY + 8)) &&
    (input.btnp(input.key.SPACE) || input.btnp(input.pad.A))
  ) {
    // 上昇中ではなく、プレイヤーの左下又は右下が床に接している状態で
    // スペースキーまたはゲームパッドのAボタンが押された時
    playerDy = -6;
    playerJumpCounter = 2;
    sound.play(3, 0);
  }

  // 押し戻し処理
  const moved = pushBack(playerX, playerY, playerDx, playerDy);
  playerX = moved.x;
  playerY = moved.y;

  // 横方向の移動を減速する
  playerDx = idiv(playerDx * 4, 5); // int(self.dx * 0.8): truncated toward zero
}

// プレイヤーを描画する
function drawPlayerSprite(): void {
  // 画像の参照X座標を決める
  const u = math.mod(math.floordiv(system.frameCount(), 4), 2) * 8 + 8;
  // 4フレーム周期で0と8を交互に繰り返す

  // 画像の幅を決める
  const w = playerDirection > 0 ? 8 : -8;
  // 移動方向が正の場合は8にしてそのまま描画、負の場合は-8にして左右反転させる

  // 画像を描画する
  screen.blt(playerX, playerY, 0, u, 64, w, 8, 15);
}

// ---- entities: the enemies ------------------------------------------------

// The enemy classes.
const SLIME = 0;
const MUMMY = 1;
const FLOWER = 2;
const POLLEN = 3;

/**
 * An enemy of any class; each uses the fields its class has. Pollen moves by
 * fractions of a pixel, which the original keeps in floats: its position
 * and speed are 16.16 fixed point (FIXED_ONE is 1.0).
 */
interface Enemy {
  kind: i32;
  x: i32; // X座標
  y: i32; // Y座標
  dx: i32; // X軸方向の移動距離
  dy: i32; // Y軸方向の移動距離
  direction: i32; // 左右の移動方向
  isElite: boolean; // レッドスライムかどうか
  isWaiting: boolean; // 待ち伏せ中かどうか
  fireTimer: i32; // 花粉の発射タイマー
  isAlive: boolean; // false once removed from the enemy list
}

const FIXED_ONE = 65536;

/** Rounds a 16.16 value half away from zero, as Pyxel rounds float coordinates. */
function roundFixed(value: i32): i32 {
  return value >= 0 ? (value + 32768) >> 16 : -((32768 - value) >> 16);
}

/** Enemy i's X coordinate in 16.16 fixed point. */
function fixedX(i: i32): i32 {
  return enemies[i].kind === POLLEN ? enemies[i].x : enemies[i].x * FIXED_ONE;
}

/** Enemy i's Y coordinate in 16.16 fixed point. */
function fixedY(i: i32): i32 {
  return enemies[i].kind === POLLEN ? enemies[i].y : enemies[i].y * FIXED_ONE;
}

function newEnemy(kind: i32, x: i32, y: i32, direction: i32): Enemy {
  return {
    kind: kind,
    x: x,
    y: y,
    dx: 0,
    dy: 0,
    direction: direction,
    isElite: false,
    isWaiting: false,
    fireTimer: 0,
    isAlive: true,
  };
}

function updateEnemy(i: i32): void {
  const kind = enemies[i].kind;
  if (kind === SLIME) {
    updateSlime(i);
  } else if (kind === MUMMY) {
    updateMummy(i);
  } else if (kind === FLOWER) {
    updateFlower(i);
  } else {
    updatePollen(i);
  }
}

function drawEnemy(i: i32): void {
  const kind = enemies[i].kind;
  if (kind === SLIME) {
    drawSlime(i);
  } else if (kind === MUMMY) {
    drawMummy(i);
  } else if (kind === FLOWER) {
    drawFlower(i);
  } else {
    drawPollen(i);
  }
}

// ---- entities/slime.py: スライムクラス -----------------------------------

// スライムを初期化する
function newSlime(x: i32, y: i32, isElite: boolean): Enemy {
  const slime = newEnemy(SLIME, x, y, -1);
  slime.isElite = isElite; // レッドスライムかどうか
  slime.isWaiting = isElite; // 待ち伏せ中かどうか
  return slime;
}

// スライムを更新する
function updateSlime(i: i32): void {
  if (enemies[i].isWaiting) {
    // 待ち伏せ中の時
    if (abs(playerX - enemies[i].x) >= 32 || abs(playerY - enemies[i].y) >= 16) {
      // プレイヤーと一定距離離れている時
      return;
    }

    // プレイヤーと接近した時
    enemies[i].isWaiting = false;
    enemies[i].direction = playerX > enemies[i].x ? 1 : -1;
    return;
  }

  // 移動距離を決める
  enemies[i].dx = enemies[i].direction;
  enemies[i].dy = min(enemies[i].dy + 1, 3);

  // 移動方向を反転させる
  const x = enemies[i].x;
  const y = enemies[i].y;
  if (enemies[i].direction < 0 && inCollision(x - 1, y + 4)) {
    // 左に進むと壁の時
    enemies[i].direction = 1; // 右に移動する
  } else if (enemies[i].direction > 0 && inCollision(x + 8, y + 4)) {
    // 右に進むと壁の時
    enemies[i].direction = -1; // 左に移動する
  }

  // 押し戻し処理
  const moved = pushBack(x, y, enemies[i].dx, enemies[i].dy);
  enemies[i].x = moved.x;
  enemies[i].y = moved.y;
}

// スライムを描画する
function drawSlime(i: i32): void {
  // 画像の参照X座標を決める
  const u = math.mod(math.floordiv(system.frameCount(), 4), 2) * 8 + 8; // イメージバンクの参照X座標
  // 4フレーム周期で0と8を繰り返す

  // 画像を描画する
  if (enemies[i].isElite) {
    // レッドスライム
    screen.blt(enemies[i].x, enemies[i].y, 0, u, 80, 8, 8, 15);
  } else {
    // グリーンスライム
    screen.blt(enemies[i].x, enemies[i].y, 0, u, 72, 8, 8, 15);
  }
}

// ---- entities/mummy.py: マミークラス -------------------------------------

// マミーを初期化する
function newMummy(x: i32, y: i32): Enemy {
  return newEnemy(MUMMY, x, y, 1);
}

// マミーを更新する
function updateMummy(i: i32): void {
  // 移動距離を決める
  enemies[i].dx = enemies[i].direction; // X軸方向の移動距離
  enemies[i].dy = min(enemies[i].dy + 1, 3); // Y軸方向の移動距離

  // 移動方向を反転させる
  const x = enemies[i].x;
  const y = enemies[i].y;
  if (inCollision(x, y + 8) || inCollision(x + 7, y + 8)) {
    // 床の上にいる時
    if (enemies[i].direction < 0 && (inCollision(x - 1, y + 4) || !inCollision(x - 1, y + 8))) {
      // 移動先に壁があるまたは床がない時
      enemies[i].direction = 1; // 右に移動する
    } else if (enemies[i].direction > 0 && (inCollision(x + 8, y + 4) || !inCollision(x + 8, y + 8))) {
      // 移動先に壁があるまたは床がない時
      enemies[i].direction = -1; // 左に移動する
    }
  }

  // 押し戻し処理
  const moved = pushBack(x, y, enemies[i].dx, enemies[i].dy);
  enemies[i].x = moved.x;
  enemies[i].y = moved.y;
}

// マミーを描画する
function drawMummy(i: i32): void {
  // 画像の参照X座標を決める
  const u = math.mod(math.floordiv(system.frameCount(), 4), 2) * 8 + 8; // 4フレーム周期で16と24を繰り返す

  // 画像の幅を決める
  const w = enemies[i].direction > 0 ? 8 : -8;
  // 移動方向が正の場合は8にしてそのまま描画、負の場合は-8にして左右反転させる

  // 画像を描画する
  screen.blt(enemies[i].x, enemies[i].y, 0, u, 88, w, 8, 15);
}

// ---- entities/flower.py: フラワークラス ----------------------------------

// フラワーを初期化する
function newFlower(x: i32, y: i32): Enemy {
  return newEnemy(FLOWER, x, y, 1);
}

// フラワーを更新する
function updateFlower(i: i32): void {
  // 花粉の発射タイマーが0になったら花粉を発射する
  if (enemies[i].fireTimer > 0) {
    enemies[i].fireTimer -= 1;
  } else {
    // 花粉を発射する
    const dx = playerX - enemies[i].x;
    const dy = playerY - enemies[i].y;
    const sqDist = dx * dx + dy * dy;
    if (sqDist < 60 * 60) {
      // プレイヤーとの距離が60未満の時
      // プレイヤーの方向に向けて速度1で花粉を発射する
      const dist = math.sqrt(f32(sqDist));
      push(
        enemies,
        newPollen(
          enemies[i].x,
          enemies[i].y,
          math.round(f32(dx * FIXED_ONE) / dist),
          math.round(f32(dy * FIXED_ONE) / dist),
        ),
      ); // 花粉を敵リストに追加

      // 効果音を再生する
      sound.play(2, 4, false, true);

      // 花粉の発射タイマーをリセットする
      enemies[i].fireTimer = 90;
    }
  }
}

// フラワーを描画する
function drawFlower(i: i32): void {
  // 画像の参照X座標を決める
  const u = math.mod(math.floordiv(system.frameCount(), 8), 2) * 8 + 8;
  // 8フレーム周期で0と8を繰り返す

  // 画像を描画する
  screen.blt(enemies[i].x, enemies[i].y, 0, u, 96, 8, 8, 15);
}

// ---- entities/pollen.py: 花粉クラス --------------------------------------

// 花粉を初期化する (x and y in pixels, dx and dy in 16.16 fixed point)
function newPollen(x: i32, y: i32, dx: i32, dy: i32): Enemy {
  const pollen = newEnemy(POLLEN, x * FIXED_ONE, y * FIXED_ONE, 1);
  pollen.dx = dx; // X軸方向の移動距離
  pollen.dy = dy; // Y軸方向の移動距離
  return pollen;
}

// 花粉を更新する
function updatePollen(i: i32): void {
  // 位置を更新する
  enemies[i].x += enemies[i].dx;
  enemies[i].y += enemies[i].dy;
}

// 花粉を描画する
function drawPollen(i: i32): void {
  // 画像の参照X座標を決める
  const u = math.mod(system.frameCount(), 2) * 8 + 8; // 1フレーム周期で16と24を繰り返す

  // 画像を描画する
  screen.blt(roundFixed(enemies[i].x), roundFixed(enemies[i].y), 0, u, 104, 8, 8, 15);
}

// ---- scenes/title_scene.py: タイトル画面クラス ---------------------------

let titleAlpha: F64 = 0.0; // 画面の透明度(0.0:透明, 1.0:不透明)

// タイトル画面を開始する
function startTitle(): void {
  // 画面の透明度を初期化する
  titleAlpha = 0.0;

  // プレイヤーを削除する
  hasPlayer = false;

  // 全ての敵を削除する
  enemies = [];

  // BGMを再生する
  music.play(0, true);
}

function updateTitle(): void {
  // 画面の透明度を変更する
  if (titleAlpha < 1.0) {
    titleAlpha += 0.015;
  }

  // キー入力をチェックする
  if (input.btnp(input.key.RETURN) || input.btnp(input.pad.START)) {
    // EnterキーまたはゲームパッドのSTARTボタンが押された時
    // 画面の透明度を不透明にする
    screen.dither(1.0);

    // プレイ画面に切り替える
    changeScene(SCENE_PLAY);
  }
}

function drawTitle(): void {
  // 画面をクリアする
  screen.cls(0);

  // タイトル画像を描画する
  screen.dither(f32(titleAlpha)); // 描画の透明度を設定
  screen.bltm(0, 0, 1, 0, 0, 128, 128);
  screen.blt(0, 0, 1, 0, 0, 128, 128, 0);

  // テキストを描画する
  screen.rect(30, 97, 67, 11, 0);
  screen.text(34, 100, "  PRESS START  ", 7);
}

// ---- scenes/play_scene.py: プレイ画面クラス ------------------------------

// プレイ画面を開始する
function startPlay(): void {
  // 変更前のマップに戻す
  tilemap.blt(0, 0, 0, 2, 0, 0, 256, 16);

  // プレイ画面の状態を初期化する
  newPlayer(0, 0); // プレイヤー
  screenX = 0; // フィールド表示範囲の左端のX座標
  score = 0; // スコア

  // 敵を出現させる
  spawnEnemy(0, 127);

  // BGMを再生する
  sound.stop();
  music.play(1, true);
}

// 敵を出現させる
function spawnEnemy(leftX: i32, rightX: i32): void {
  // 判定範囲のタイルを計算する
  const left = (leftX + 7) >> 3; // pyxel.ceil(left_x / 8)
  const right = rightX >> 3; // pyxel.floor(right_x / 8)

  // 判定範囲のタイルに応じて敵を出現させる
  for (let tx = left; tx <= right; tx++) {
    for (let ty = 0; ty < 16; ty++) {
      const x = tx * 8;
      const y = ty * 8;
      const tileType = getTileType(x, y);

      if (tileType === TILE_SLIME1_POINT) {
        // グリーンスライムの出現位置の時
        push(enemies, newSlime(x, y, false));
      } else if (tileType === TILE_SLIME2_POINT) {
        // レッドスライムの出現位置の時
        push(enemies, newSlime(x, y, true));
      } else if (tileType === TILE_MUMMY_POINT) {
        // マミーの出現位置の時
        push(enemies, newMummy(x, y));
      } else if (tileType === TILE_FLOWER_POINT) {
        // フラワーの出現位置の時
        push(enemies, newFlower(x, y));
      } else {
        continue;
      }

      // 出現位置タイルを消す
      tilemap.pset(0, tx, ty, tilemap.tile(0, 0));
    }
  }
}

/** Drops the enemies marked as removed. */
function removeEnemies(): void {
  enemies = filter(enemies, (enemy) => enemy.isAlive);
}

// プレイ画面を更新する
function updatePlay(): void {
  // プレイヤーを更新する
  if (hasPlayer) {
    updatePlayer();
  }

  // プレイヤーの移動範囲を制限する
  playerX = min(max(playerX, screenX), 2040);
  playerY = max(playerY, 0);

  // プレイヤーがスクロール境界を越えたら画面をスクロールする
  if (playerX > screenX + SCROLL_BORDER_X) {
    const lastScreenX = screenX;
    screenX = min(playerX - SCROLL_BORDER_X, 240 * 8);
    // 240タイル分以上は右にスクロールさせない

    // スクロールした幅に応じて敵を出現させる
    spawnEnemy(lastScreenX + 128, screenX + 127);
  }

  // プレイヤーが画面の下に落ちたらゲームオーバーにする
  if (playerY >= system.height()) {
    sound.play(3, 4);
    changeScene(SCENE_GAMEOVER);
  }

  // 敵を更新する (those in the list now: pollen fired during the loop waits for the next frame)
  const count = len(enemies);
  let removed = false;
  for (let i = 0; i < count; i++) {
    updateEnemy(i);

    // プレイヤーと敵が接触したらゲームオーバーにする
    if (abs(playerX * FIXED_ONE - fixedX(i)) < 6 * FIXED_ONE && abs(playerY * FIXED_ONE - fixedY(i)) < 6 * FIXED_ONE) {
      changeScene(SCENE_GAMEOVER);
      if (removed) {
        removeEnemies();
      }
      return;
    }

    // 敵が画面の左端または下端から外に出たら削除する
    if (
      fixedX(i) < (screenX - 8) * FIXED_ONE ||
      fixedX(i) > (screenX + 160) * FIXED_ONE ||
      fixedY(i) > 160 * FIXED_ONE
    ) {
      enemies[i].isAlive = false;
      removed = true;
    }
  }
  if (removed) {
    removeEnemies();
  }
}

// プレイ画面を描画する
function drawPlay(): void {
  // 画面をクリアする
  screen.cls(0);

  // フィールドを描画する
  drawField();

  // プレイヤーを描画する
  drawPlayer();

  // 敵を描画する
  drawEnemies();
}

// ---- scenes/gameover_scene.py: ゲームオーバー画面クラス ------------------

let gameOverPlayerX: i32 = 0; // プレイヤーのX座標
let gameOverPlayerY: i32 = 0; // プレイヤーのY座標
let displayTimer: i32 = 0; // ゲームオーバー画面の表示時間

// ゲームオーバー画面を開始する
function startGameOver(): void {
  // 現在のプレイヤーの位置を保存する
  gameOverPlayerX = playerX; // プレイヤーのX座標
  gameOverPlayerY = playerY; // プレイヤーのY座標

  // ゲームオーバー画面の表示時間を設定する
  displayTimer = 110;

  // ゲームオーバー音を再生する
  sound.stop();
  sound.play(0, 3);
}

// ゲームオーバー画面を更新する
function updateGameOver(): void {
  // 表示時間が0になったらタイトル画面に戻る
  if (displayTimer > 0) {
    displayTimer -= 1;
  } else {
    changeScene(SCENE_TITLE);
  }
}

// ゲームオーバー画面を描画する
function drawGameOver(): void {
  // 画面をクリアする
  screen.cls(0);

  // カメラ位置を戻す
  screen.camera();

  // フィールドを描画する
  drawField();

  // 敵を描画する
  drawEnemies();

  // ジタバタするプレイヤーを描画する
  screen.camera(screenX, 0); // カメラ位置(描画の原点)を変更する
  const w = math.mod(math.floordiv(system.frameCount(), 2), 2) === 0 ? 8 : -8;
  // 2フレーム周期で8と-8を繰り返す
  screen.blt(gameOverPlayerX, gameOverPlayerY, 0, 8, 64, w, 8, 15);
  screen.camera(); // カメラ位置を戻す

  // テキストを描画する
  screen.rect(6, 49, 116, 30, 0);
  screen.rectb(6, 49, 116, 30, 7);
  screen.text(47, 62, "GAME OVER", 7);
}

// ---- scenes/clear_scene.py: クリア画面クラス -----------------------------

// ゲームクリア画面を開始する
function startClear(): void {
  // BGMを再生する
  sound.stop();
  music.play(0, true);
}

// ゲームクリア画面を更新する
function updateClear(): void {
  // 何も動かさない
}

// ゲームクリア画面を描画する
function drawClear(): void {
  // 画面をクリアする
  screen.cls(0);

  // フィールドを描画する
  drawField();
  drawPlayer();
  drawEnemies();

  // テキストを描画する
  screen.rect(6, 49, 116, 30, 0);
  screen.rectb(6, 49, 116, 30, 7);
  screen.text(19, 57, "YOU ESCAPED THE CAVERN!", 7);
  screen.text(17, 66, "BUT YOUR QUEST CONTINUES", 7);
}

// ---- game.py: ゲームクラス -----------------------------------------------

// The scenes (シーンの辞書's keys).
const SCENE_TITLE = 0;
const SCENE_PLAY = 1;
const SCENE_GAMEOVER = 2;
const SCENE_CLEAR = 3;

let enemies: Enemy[] = []; // 敵のリスト
let sceneName: i32 = SCENE_TITLE; // 現在のシーン名
let screenX: i32 = 0; // フィールド表示範囲の左端のX座標
let score: i32 = 0; // 得点
// The score text drawn each frame, made again only when the score changes.
let scoreText: string = "";
let scoreShown: i32 = -1;

// ゲームを初期化する
export function setup(): void {
  // Pyxelを初期化する (the title is in retro.json)
  system.init(128, 128);

  // リソースファイルを読み込む (retro.json bakes assets/cursed_caverns.pyxres)
  tilemap.blt(2, 0, 0, 0, 0, 0, 256, 16); // 変更前のマップをコピーする

  // TILE_TO_TILETYPE as a lookup table
  tileTypes = fill(32 * 32, TILE_NONE);
  for (let i = 0; i < len(TILE_TO_TILETYPE); i += 3) {
    tileTypes[TILE_TO_TILETYPE[i + 1] * 32 + TILE_TO_TILETYPE[i]] = TILE_TO_TILETYPE[i + 2];
  }

  // ゲームの状態を初期化する
  hasPlayer = false; // プレイヤー
  enemies = []; // 敵のリスト
  screenX = 0; // フィールド表示範囲の左端のX座標
  score = 0; // 得点

  // シーンをタイトル画面に変更する
  changeScene(SCENE_TITLE);

  // ゲームの実行を開始する (the host calls update() and draw() every frame)
}

// シーンを変更する
function changeScene(name: i32): void {
  sceneName = name;
  if (name === SCENE_TITLE) {
    startTitle();
  } else if (name === SCENE_PLAY) {
    startPlay();
  } else if (name === SCENE_GAMEOVER) {
    startGameOver();
  } else {
    startClear();
  }
}

// フィールドを描画する
function drawField(): void {
  screen.bltm(0, 0, 0, screenX, 0, 128, 128);
}

// プレイヤーを描画する
function drawPlayer(): void {
  // カメラ位置(描画の原点)を変更する
  screen.camera(screenX, 0);

  // プレイヤーを描画する
  if (hasPlayer) {
    // プレイヤーが存在する時
    drawPlayerSprite();
  }

  // カメラ位置を戻す
  screen.camera();
}

// 敵を描画する
function drawEnemies(): void {
  // カメラ位置(描画の原点)を変更する
  screen.camera(screenX, 0);

  // 敵を描画する
  for (let i = 0; i < len(enemies); i++) {
    drawEnemy(i);
  }

  // カメラ位置を戻す
  screen.camera();
}

// ゲームを更新する
export function update(): void {
  // 現在のシーンを更新する
  if (sceneName === SCENE_TITLE) {
    updateTitle();
  } else if (sceneName === SCENE_PLAY) {
    updatePlay();
  } else if (sceneName === SCENE_GAMEOVER) {
    updateGameOver();
  } else {
    updateClear();
  }
}

// ゲームを描画する
export function draw(): void {
  // 現在のシーンを描画する
  if (sceneName === SCENE_TITLE) {
    drawTitle();
  } else if (sceneName === SCENE_PLAY) {
    drawPlay();
  } else if (sceneName === SCENE_GAMEOVER) {
    drawGameOver();
  } else {
    drawClear();
  }

  // スコアを描画する
  if (score !== scoreShown) {
    scoreShown = score;
    scoreText = `SCORE ${text.rjust(text.str(score), 4)}`;
  }
  screen.text(45, 4, scoreText, 7);
}
