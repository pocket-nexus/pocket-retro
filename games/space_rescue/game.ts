// Space Rescue, ported from pyxel/examples/apps/space_rescue.pyxapp
// (space_rescue.py, Takashi Kitao, MIT): a one-key game to rescue astronauts,
// from the book at https://gihyo.jp/book/2025/978-4-297-14657-3.
// On the GBA, A stands in for SPACE and START for ENTER.
import { system, screen, input, sound, math } from "retro";
import { abs, f32, len, max, min, push, type i32 } from "@pocketjs/framework/solid/std";

const GAME_TITLE = "Space Rescue"; // ゲームタイトル

// The ship's position and speed are 16.16 fixed point (ONE is 1.0): float
// math is emulated in software on the GBA, and the collision checks compare
// the ship with every object each frame.
const ONE = 65536;
const HALF = 32768; // 0.5
const SHIP_ACCEL_X = 3932; // 0.06: 宇宙船の左右方向の加速度
const SHIP_ACCEL_UP = 2621; // 0.04: 宇宙船の上方向の加速度
const SHIP_ACCEL_DOWN = 1311; // 0.02: 宇宙船の下方向の加速度
const MAX_SHIP_SPEED = 52429; // 0.8: 宇宙船の最大速度

const OBJECT_SPAWN_INTERVAL = 150; // オブジェクトの出現間隔(150フレーム＝5秒)

// A position (x, y) of an astronaut or a meteor.
interface Pos {
  x: i32;
  y: i32;
}

let isTitle = true;
let score = 0;
let timer = 0;
let shipX = 0; // 16.16
let shipY = 0; // 16.16
let shipVx = 0; // 16.16
let shipVy = 0; // 16.16
let shipDir = 1;
let isJetting = false;
let isExploding = false;
let survivors: Pos[] = [];
let meteors: Pos[] = [];

export function setup(): void {
  // Pyxelを初期化する
  system.init(160, 120);

  // ENTER starts the game; keep it off A, the jet key, as in the original.
  input.map(input.key.RETURN, input.gba.START);

  // リソースファイルを読み込む (space_rescue.pyxres is baked from retro.json)

  // ゲームをリセットする
  isTitle = true;
  resetGame();
}

// ゲームをリセットする
function resetGame(): void {
  // 得点を初期化する
  score = 0;

  // 出現タイマーを初期化する
  timer = 0;

  // 宇宙船を初期化する
  shipX = math.floordiv((system.width() - 8) * ONE, 2); // X座標
  shipY = math.floordiv(system.height() * ONE, 4); // Y座標
  shipVx = 0; // X方向の速度
  shipVy = 0; // Y方向の速度
  shipDir = 1; // 宇宙船の左右の向き(-1:左,1:右)
  isJetting = false; // ジェット噴射中かどうか
  isExploding = false; // 爆発中かどうか

  // マップの配置を初期化する
  survivors = []; // 宇宙飛行士の配置
  meteors = []; // 隕石の配置
}

// 宇宙船から一定距離離れた位置をランダムに生成する (離す距離)
function generateDistancedPos(dist: i32): Pos {
  while (true) {
    const x = math.rndi(0, system.width() - 8);
    const y = math.rndi(0, system.height() - 8);
    const diffX = f32(x) - f32(shipX) / f32(ONE);
    const diffY = f32(y) - f32(shipY) / f32(ONE);
    if (diffX * diffX + diffY * diffY > f32(dist * dist)) return { x, y };
  }
}

// 宇宙飛行士を追加する
function addSurvivor(): void {
  const survivorPos = generateDistancedPos(30); // 宇宙船から距離を30以上離す
  push(survivors, survivorPos); // 宇宙飛行士のリストに要素を追加
}

// 隕石を追加する
function addMeteor(): void {
  const meteorPos = generateDistancedPos(60); // 宇宙船から距離を60以上離す
  push(meteors, meteorPos); // 隕石のリストに要素を追加
}

// 宇宙船を更新する
function updateShip(): void {
  // 宇宙船の速度を更新する
  if (input.btn(input.key.SPACE) || input.btn(input.pad.A)) {
    // スペースキーが押されている時
    isJetting = true;
    shipVy = max(shipVy - SHIP_ACCEL_UP, -MAX_SHIP_SPEED);
    shipVx = max(min(shipVx + shipDir * SHIP_ACCEL_X, ONE), -MAX_SHIP_SPEED);
    sound.play(0, 0); // チャンネル0で効果音0(ジェット音)を再生する
  } else {
    // スペースキーが押されていない時
    isJetting = false;
    shipVy = min(shipVy + SHIP_ACCEL_DOWN, MAX_SHIP_SPEED);
  }

  // スペースキーが離された時に次に進む方向を逆にする
  if (input.btnr(input.key.SPACE) || input.btnr(input.pad.A)) shipDir = -shipDir;

  // 宇宙船の位置を更新する
  shipX += shipVx;
  shipY += shipVy;

  // 画面端に到達したら跳ね返す
  if (shipX < 0) {
    // 画面左端を越えた時
    shipX = 0;
    shipVx = abs(shipVx);
    sound.play(0, 1); // チャンネル0で効果音1(跳ね返り音)を再生する
  }

  const maxShipX = (system.width() - 8) * ONE;
  if (shipX > maxShipX) {
    // 画面右端を越えた時
    shipX = maxShipX;
    shipVx = -abs(shipVx);
    sound.play(0, 1);
  }

  if (shipY < 0) {
    // 画面上端を越えた時
    shipY = 0;
    shipVy = abs(shipVy);
    sound.play(0, 1);
  }

  const maxShipY = (system.height() - 8) * ONE;
  if (shipY > maxShipY) {
    // 画面下端を越えた時
    shipY = maxShipY;
    shipVy = -abs(shipVy);
    sound.play(0, 1);
  }
}

// オブジェクト(宇宙飛行士/隕石)を追加する
function addObjects(): void {
  // 一定時間ごとにオブジェクトを追加する
  if (timer === 0) {
    addSurvivor();
    addMeteor();
    timer = OBJECT_SPAWN_INTERVAL;
  } else {
    timer -= 1;
  }
}

// 宇宙船とオブジェクトの衝突判定を行う (対象のX座標,対象のY座標)
function checkShipCollision(x: i32, y: i32): boolean {
  return abs(shipX - x * ONE) <= 5 * ONE && abs(shipY - y * ONE) <= 5 * ONE;
}

// 宇宙船と宇宙飛行士の衝突判定を行う
function handleSurvivorCollisions(): void {
  const newSurvivors: Pos[] = [];
  for (let i = 0; i < len(survivors); i++) {
    const survivorX = survivors[i].x,
      survivorY = survivors[i].y;
    if (checkShipCollision(survivorX, survivorY)) {
      score += 1;
      sound.play(1, 2); // チャンネル1で効果音2(救助音)を再生する
    } else {
      push(newSurvivors, { x: survivorX, y: survivorY });
    }
  }
  survivors = newSurvivors;
}

// 宇宙船と隕石の衝突判定を行う
function handleMeteorCollisions(): void {
  for (let i = 0; i < len(meteors); i++) {
    if (checkShipCollision(meteors[i].x, meteors[i].y)) {
      isExploding = true;
      isTitle = true;
      sound.play(1, 3); // チャンネル1で効果音3(爆発音)を再生する
    }
  }
}

// アプリを更新する
export function update(): void {
  // タイトル画面の時はRETURNキー(ENTERキー)の入力を待つ
  if (isTitle) {
    if (input.btnp(input.key.RETURN) || input.btnp(input.pad.START)) {
      isTitle = false;
      resetGame();
    }
    return; // タイトル画面では他の更新処理は行わない
  }

  // ゲームを更新する
  updateShip();
  addObjects();
  handleSurvivorCollisions();
  handleMeteorCollisions();
}

// Pyxel rounds float coordinates half away from zero; this rounds a 16.16 value.
function px(v: i32): i32 {
  return v >= 0 ? (v + HALF) >> 16 : -((HALF - v) >> 16);
}

// 空を描画する
function drawSky(): void {
  const numGrads = 4; // グラデーションの数
  const gradHeight = 6; // グラデーションの高さ
  const gradStartY = system.height() - gradHeight * numGrads; // 描画開始位置

  screen.cls(0);
  for (let i = 0; i < numGrads; i++) {
    screen.dither(f32(i + 1) / f32(numGrads)); // ディザリングを有効にする
    screen.rect(0, gradStartY + i * gradHeight, system.width(), gradHeight, 1);
  }
  screen.dither(f32(1)); // ディザリングを無効にする
}

// 宇宙船を描画する
function drawShip(): void {
  // ジェット噴射の表示位置をずらす量を計算する
  const offsetY = isJetting ? (system.frameCount() % 3) + 2 : 0;
  const offsetX = offsetY * -shipDir;

  // 左右方向のジェット噴射を描画する
  screen.blt(
    px(shipX + (-shipDir * 3 + offsetX) * ONE), // 描画位置のX座標
    px(shipY), // 描画位置のY座標
    0, // 参照するイメージバンク番号
    0, // 参照イメージの左上のX座標
    0, // 参照イメージの左上のY座標
    8 * shipDir, // 参照イメージの幅(負の値だと左右反転される)
    8, // 参照イメージの高さ
    0, // 色番号0を透明色として扱う
  );

  // 下方向のジェット噴射を描画する
  screen.blt(px(shipX), px(shipY + (3 + offsetY) * ONE), 0, 8, 8, 8, 8, 0);

  // 宇宙船を描画する
  screen.blt(px(shipX), px(shipY), 0, 8, 0, 8, 8, 0);

  // 爆発を描画する
  if (isExploding) {
    const blastX = shipX + math.rndi(1, 6) * ONE;
    const blastY = shipY + math.rndi(1, 6) * ONE;
    const blastRadius = math.rndi(2, 4);
    const blastColor = math.rndi(7, 10);
    screen.circ(px(blastX), px(blastY), blastRadius, blastColor);
  }
}

// 宇宙飛行士を描画する
function drawSurvivors(): void {
  for (let i = 0; i < len(survivors); i++) screen.blt(survivors[i].x, survivors[i].y, 0, 16, 0, 8, 8, 0);
}

// 隕石を描画する
function drawMeteors(): void {
  for (let i = 0; i < len(meteors); i++) screen.blt(meteors[i].x, meteors[i].y, 0, 24, 0, 8, 8, 0);
}

// スコアを描画する
function drawScore(): void {
  const scoreText = `SCORE:${score}`;
  for (let i = 1; i > -1; i--) {
    const color = i === 0 ? 7 : 0;
    screen.text(3 + i, 3, scoreText, color);
  }
}

// タイトルを描画する
function drawTitle(): void {
  for (let i = 1; i > -1; i--) {
    const color = i === 0 ? 10 : 8;
    screen.text(57, 50 + i, GAME_TITLE, color);
  }
  screen.text(42, 70, "- Press Start Key -", 3);
}

// アプリを描画する
export function draw(): void {
  // 画面を描画する
  drawSky();
  drawShip();
  drawSurvivors();
  drawMeteors();
  drawScore();

  // タイトル画面の時はタイトルを描画する
  if (isTitle) drawTitle();
}
