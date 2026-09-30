// 30 Seconds of Daylight, the 1st Pyxel Jam winner, ported from
// pyxel/examples/apps/30sec_of_daylight.pyxapp (https://github.com/kitao/30SecondsOfDaylight)
// by Adam (MIT). Each section below is one module of the original's src/:
// main.py, input.py, game.py, main_menu.py, world.py, daylight_control.py,
// map_loader.py, map.py, entity.py, player.py, enemy.py, combat.py,
// weapon.py, shield.py, potion.py, teleporter.py, trigger.py, journal.py and
// hud.py (utils.py's distance() is inlined in map.py).
//
// Classes become structs and functions. Every entity but the player is an
// Entity record in its map's list and is passed around as (map, index); the
// player, the world and the game are module state. Names of maps, enemies
// and items are indices into name tables.
import { system, screen, tilemap, input, sound, music, math } from "retro";
import { clear, copy, f32, len, max, min, push, removeAt, type i32 } from "@pocketjs/framework/solid/std";

// ---- main.py ------------------------------------------------------------

const FPS = 10;

export function setup(): void {
  system.init(160, 120, FPS);
  // pyxel.load("../res/rpg01.pyxres") is "resources" in retro.json.

  // The menu starts on Enter (btn) or gamepad A (btnp). Enter also presses A
  // by default, so holding A, the attack button, through a game over would
  // start the next game at once: keep Enter on START alone.
  input.map(input.key.RETURN, input.gba.START);

  initTiles();
  initXpLevels();
  gameInit();
  // pyxel.mouse(visible=True)
}

export function update(): void {
  // Q quits in Pyxel (pyxel.quit()); a cartridge keeps running.
  inputUpdate();
  gameUpdate();
}

export function draw(): void {
  screen.cls(0);

  gameDraw();
}

// ---- input.py -----------------------------------------------------------

const UP = 0;
const DOWN = 1;
const LEFT = 2;
const RIGHT = 3;
const CONFIRM = 4;
const CANCEL = 5;

/** Input.inputs, read once a frame by inputUpdate() for the game. */
let inputs: i32[] = [];

function inputUpdate(): void {
  clear(inputs);

  if (input.btn(input.key.UP) || input.btn(input.key.W) || input.btn(input.pad.DPAD_UP)) {
    push(inputs, UP);
  } else if (input.btn(input.key.DOWN) || input.btn(input.key.S) || input.btn(input.pad.DPAD_DOWN)) {
    push(inputs, DOWN);
  } else if (input.btn(input.key.LEFT) || input.btn(input.key.A) || input.btn(input.pad.DPAD_LEFT)) {
    push(inputs, LEFT);
  } else if (input.btn(input.key.RIGHT) || input.btn(input.key.D) || input.btn(input.pad.DPAD_RIGHT)) {
    push(inputs, RIGHT);
  }

  // Z and gamepad A are the GBA's A button, X and gamepad B its B button; N and M are not mapped.
  if (input.btn(input.key.Z) || input.btn(input.key.N) || input.btn(input.pad.A)) {
    push(inputs, CONFIRM);
  } else if (input.btn(input.key.X) || input.btn(input.key.M) || input.btn(input.pad.B)) {
    push(inputs, CANCEL);
  }
}

/** `value in inputs`. */
function hasInput(value: i32): boolean {
  for (let i = 0; i < len(inputs); i++) if (inputs[i] === value) return true;
  return false;
}

// ---- game.py ------------------------------------------------------------

const STATE_MAIN_MENU = 0;
const STATE_MAP = 1;

let state: i32 = STATE_MAIN_MENU;

function gameInit(): void {
  state = STATE_MAIN_MENU;
  mainMenuInit();

  // self.new_game()
}

function newGame(): void {
  sound.stop();
  music.play(1, false);
  state = STATE_MAP;
  // Python's random module is seeded afresh on every run; seeding from the
  // frame the game starts on gives each game its own maps here too.
  math.rseed(system.frameCount());
  worldInit();
  // Hud(world) holds nothing but the world.
}

function gameOver(): void {
  state = STATE_MAIN_MENU;
  mainMenuInit();
}

function gameUpdate(): void {
  if (state === STATE_MAP) {
    worldUpdate();
    // self.hud.update() does nothing.
  } else if (state === STATE_MAIN_MENU) {
    mainMenuUpdate();
  }
}

function gameDraw(): void {
  if (state === STATE_MAP) {
    worldDraw();
    hudDraw();
  } else if (state === STATE_MAIN_MENU) {
    mainMenuDraw();
  }
}

// ---- main_menu.py -------------------------------------------------------

function mainMenuInit(): void {
  // self.select_y = 50 is never read.
  sound.stop();
  music.play(0, true);
}

function mainMenuUpdate(): void {
  if (input.btn(input.key.RETURN) || input.btnp(input.pad.A)) newGame();
}

function mainMenuDraw(): void {
  screen.text(40, 20, "30 Seconds of Daylight", 10);
  // The controls and the prompt name GBA buttons instead of keys.
  screen.text(30, 45, "Movement: D-Pad", 13);
  screen.text(30, 55, "Attack  : Hold A button", 13);
  screen.text(30, 65, "Pickup  : B button", 13);
  screen.text(52, 88, "START to Start", 12);
  // "Escape to Exit" (52, 100, color 9) is left out: a cartridge has no exit.
}

// ---- world.py -----------------------------------------------------------

const MAX_GAME_OVER_WAIT_TICKS = 30; // 3 secs

/** World.current_map, an index into maps (World.map_dict). */
let currentMap: i32 = 0;
/** World.game_over. */
let worldGameOver: boolean = false;
let gameOverTicks: i32 = 0;

function worldInit(): void {
  loadAll();

  daylightControlInit();

  playerInit();

  enterMap(COURTYARD, 7, 1);

  journalInit();

  worldGameOver = false;
  gameOverTicks = 0;
}

function setGameOver(): void {
  worldGameOver = true;
}

function worldUpdate(): void {
  if (worldGameOver) {
    gameOverTicks += 1;
    if (gameOverTicks === MAX_GAME_OVER_WAIT_TICKS) gameOver();
  } else {
    daylightControlUpdate();
    mapUpdate(currentMap);
  }
}

function worldDraw(): void {
  mapDraw(currentMap, true, false, false);
  if (isNight()) {
    screen.pal();
    mapDraw(currentMap, true, true, true);
  } else {
    mapDraw(currentMap, false, true, false);
  }

  journalDraw();
}

// ---- daylight_control.py ------------------------------------------------

const DAYLIGHT_SECS = 30;
const MAX_SECS = DAYLIGHT_SECS * 2;

let frameCnt: i32 = 0;
let secCnt: i32 = 0;

function daylightControlInit(): void {
  frameCnt = 0;
  secCnt = 0;
}

function daylightControlUpdate(): void {
  // 0-27 = day = all normal tile colours
  // 28 = early dusk = all orange except nearest
  // 29 = late dusk = all dark red except nearest
  // 30-57 = night = all dark blue except nearest
  // 58 = early dawn = all dark red except nearest
  // 59 = late dawn = all orange except nearest

  frameCnt += 1;
  if (frameCnt === 10) {
    frameCnt = 0;
    secCnt += 1;
    if (secCnt === MAX_SECS) secCnt = 0;
  }

  if (frameCnt === 0) {
    if (secCnt === 29) {
      // night time spooky music
      music.play(2, false);
    } else if (secCnt === 58) {
      // happy end of night
      music.play(3, false);
    } else if (secCnt === 0) {
      music.play(1, false);
    }
  }

  if (secCnt > 29 && secCnt < 58) {
    for (let i = 2; i < 16; i++) screen.pal(i, 1);
  } else if (secCnt === 28 || secCnt === 59) {
    for (let i = 2; i < 16; i++) screen.pal(i, 9);
  } else if (secCnt === 29 || secCnt === 58) {
    for (let i = 2; i < 16; i++) screen.pal(i, 2);
  }
}

function isNight(): boolean {
  if (secCnt >= 0 && secCnt <= 27) return false;
  else return true;
}

// ---- map_loader.py ------------------------------------------------------

// The maps' names, the keys of World.map_dict, in the order load_all() loads them.
const COURTYARD = 0;
const OUTER_GATE = 1;
const EAST_WALL = 2;
const WEST_WALL = 3;
const REAR_WARD = 4;
const SECRET_GARDENS = 5;
const MAP_NAMES: string[] = ["Courtyard", "Outer Gate", "East Wall", "West Wall", "Rear Ward", "Secret Gardens"];

function loadAll(): void {
  maps = [];
  load(COURTYARD);
  load(OUTER_GATE);
  load(EAST_WALL);
  load(WEST_WALL);
  load(REAR_WARD);
  load(SECRET_GARDENS);
}

function load(mapName: i32): void {
  if (mapName === COURTYARD) push(maps, newMap(mapName, 0, 0, 0, 16, 16));
  else if (mapName === OUTER_GATE) push(maps, newMap(mapName, 0, 48, 16, 16, 16));
  else if (mapName === EAST_WALL) push(maps, newMap(mapName, 0, 0, 16, 24, 16));
  else if (mapName === WEST_WALL) push(maps, newMap(mapName, 0, 24, 16, 24, 16));
  else if (mapName === REAR_WARD) push(maps, newMap(mapName, 0, 16, 0, 48, 16));
  else if (mapName === SECRET_GARDENS) push(maps, newMap(mapName, 0, 64, 0, 24, 16));
}

function enterMap(mapName: i32, enterTileX: i32, enterTileY: i32): void {
  currentMap = mapName;
  mapEnter(mapName, enterTileX, enterTileY);
  if (mapName === COURTYARD) {
    addEntity(mapName, teleporter(7, 15, 55, 17, OUTER_GATE));
    addEntity(mapName, teleporter(8, 15, 56, 17, OUTER_GATE));
    addEntity(mapName, trigger(7, 1, TYPE_CASTLE_DOOR));
    addEntity(mapName, trigger(8, 1, TYPE_CASTLE_DOOR));
  } else if (mapName === OUTER_GATE) {
    addEntity(mapName, teleporter(55, 16, 7, 14, COURTYARD));
    addEntity(mapName, teleporter(56, 16, 8, 14, COURTYARD));
    addEntity(mapName, teleporter(48, 27, 22, 27, EAST_WALL));
    addEntity(mapName, teleporter(48, 28, 22, 28, EAST_WALL));
    addEntity(mapName, teleporter(63, 27, 25, 27, WEST_WALL));
    addEntity(mapName, teleporter(63, 28, 25, 28, WEST_WALL));
  } else if (mapName === EAST_WALL) {
    addEntity(mapName, teleporter(23, 27, 49, 27, OUTER_GATE));
    addEntity(mapName, teleporter(23, 28, 49, 28, OUTER_GATE));
    addEntity(mapName, teleporter(8, 16, 24, 14, REAR_WARD));
  } else if (mapName === WEST_WALL) {
    addEntity(mapName, teleporter(24, 27, 62, 27, OUTER_GATE));
    addEntity(mapName, teleporter(24, 28, 62, 28, OUTER_GATE));
    addEntity(mapName, teleporter(45, 16, 61, 14, REAR_WARD));
  } else if (mapName === REAR_WARD) {
    addEntity(mapName, teleporter(24, 15, 8, 17, EAST_WALL));
    addEntity(mapName, teleporter(61, 15, 45, 17, WEST_WALL));
    addEntity(mapName, teleporter(39, 0, 76, 14, SECRET_GARDENS));
    addEntity(mapName, teleporter(40, 0, 77, 14, SECRET_GARDENS));
  } else if (mapName === SECRET_GARDENS) {
    addEntity(mapName, teleporter(76, 15, 39, 1, REAR_WARD));
    addEntity(mapName, teleporter(77, 15, 40, 1, REAR_WARD));
    addEntity(mapName, trigger(74, 1, TYPE_CASTLE_KEY));
  }
}

// ---- map.py -------------------------------------------------------------

/** utils.Rect. */
interface Rect {
  x: i32;
  y: i32;
  w: i32;
  h: i32;
}

interface GameMap {
  name: i32;
  tm: i32;
  tmX: i32;
  tmY: i32;
  tmW: i32;
  tmH: i32;
  cam: Rect;
  updateCam: boolean;
  // self.player is the one player.
  entities: Entity[];
}

/** A tile position, as the [x, y] lists of open_tiles. */
interface Point {
  x: i32;
  y: i32;
}

/** World.map_dict, indexed by map name. */
let maps: GameMap[] = [];

/** Map.LADDER_TILE and Map.WALKABLE_TILES, made in setup(). */
let ladderTile: i32 = 0;
let walkableTiles: i32[] = [];

function initTiles(): void {
  ladderTile = tilemap.tile(6, 2);
  walkableTiles = [tilemap.tile(1, 1), tilemap.tile(4, 4), tilemap.tile(5, 4), tilemap.tile(4, 8), ladderTile];
}

/** `tile in self.WALKABLE_TILES`. */
function isWalkable(tile: i32): boolean {
  for (let i = 0; i < len(walkableTiles); i++) if (walkableTiles[i] === tile) return true;
  return false;
}

function newMap(name: i32, tm: i32, tmX: i32, tmY: i32, tmW: i32, tmH: i32): GameMap {
  return {
    name: name,
    tm: tm,
    tmX: tmX,
    tmY: tmY,
    tmW: tmW,
    tmH: tmH,
    cam: { x: 0, y: 0, w: 80, h: 72 },
    updateCam: true,
    entities: [],
  };
}

function mapEnter(m: i32, pTileX: i32, pTileY: i32): void {
  maps[m].updateCam = true;
  player.tileX = pTileX;
  player.tileY = pTileY;

  clear(maps[m].entities);
  // Both spawn functions start from the same open_tiles list, which depends
  // only on the map and the player's tile: it is found once, here.
  const openTiles = findOpenTiles(m);
  spawnEnemies(m, openTiles);
  spawnItems(m, openTiles);

  maps[m].cam.x = max(0, min(maps[m].tmW * 8 - maps[m].cam.w, player.tileX * 8 - 40));
  maps[m].cam.y = max(0, min(maps[m].tmH * 8 - maps[m].cam.h, player.tileY * 8 - 32));
}

/**
 * The open_tiles list both spawn functions make: walkable tiles other than
 * the player's, at least 4 tiles from it, in tilemap coordinates.
 */
function findOpenTiles(m: i32): Point[] {
  const openTiles: Point[] = [];
  const tm = maps[m].tm,
    tmX = maps[m].tmX,
    tmY = maps[m].tmY,
    pTileX = player.tileX,
    pTileY = player.tileY;
  for (let y = 0; y < maps[m].tmH; y++) {
    for (let x = 0; x < maps[m].tmW; x++) {
      const tile = tilemap.pget(tm, tmX + x, tmY + y);
      // distance((x, y), (player.tile_x, player.tile_y)) >= 4, squared.
      const dx = x - pTileX,
        dy = y - pTileY;
      if ((x !== pTileX || y !== pTileY) && isWalkable(tile) && dx * dx + dy * dy >= 16) {
        push(openTiles, { x: tmX + x, y: tmY + y });
      }
    }
  }
  return openTiles;
}

function spawnEnemies(m: i32, found: Point[]): void {
  const openTiles = copy(found);

  // enemy chances
  const lvl = player.level + 1;
  // Rat, Scorpion, Guard, Strongman, Ghost, Skeleton, Zombie, Serpent
  const chances: i32[] = [0, 0, 0, 0, 0, 0, 0, 0];

  if (lvl >= 15) {
    chances[RAT] = 10;
    chances[SCORPION] = 10;
    chances[GUARD] = 10;
    chances[STRONGMAN] = 20;

    chances[GHOST] = 10;
    chances[SKELETON] = 10;
    chances[ZOMBIE] = 10;
    chances[SERPENT] = 20;
  } else if (lvl >= 10) {
    chances[RAT] = 20;
    chances[SCORPION] = 20;
    chances[GUARD] = 10;

    chances[GHOST] = 20;
    chances[SKELETON] = 20;
    chances[ZOMBIE] = 10;
  } else if (lvl >= 5) {
    chances[RAT] = 50;
    chances[SCORPION] = 20;

    chances[GHOST] = 15;
    chances[SKELETON] = 15;
  } else {
    chances[RAT] = 80;

    chances[GHOST] = 20;
  }

  const enList: i32[] = [];
  for (let key = 0; key < len(chances); key++) {
    const num = chances[key];
    for (let i = 0; i < num; i++) push(enList, key);
  }

  // math.floor(len(open_tiles) * 0.15), exactly
  const numToGen = math.floordiv(len(openTiles) * 15, 100);

  // random.sample(open_tiles, num_to_gen): the first tiles of a partial shuffle.
  for (let i = 0; i < numToGen; i++) {
    const j = math.rndi(i, len(openTiles) - 1);
    const t = openTiles[i];
    openTiles[i] = openTiles[j];
    openTiles[j] = t;
  }
  for (let i = 0; i < numToGen; i++) {
    // choice(en_list); the index is drawn first, as enList[rndi(...)] would copy the list.
    const k = math.rndi(0, len(enList) - 1);
    addEntity(m, create(enList[k], openTiles[i].x, openTiles[i].y));
  }
}

function spawnItems(m: i32, found: Point[]): void {
  const openTiles = copy(found);

  // math.floor(self.player.max_hp * 0.75)
  if (player.hp < math.floordiv(player.maxHp * 3, 4)) {
    const k = math.rndi(0, len(openTiles) - 1); // choice(open_tiles)
    addEntity(m, red(openTiles[k].x, openTiles[k].y));
    removeAt(openTiles, k);
  }

  if (math.rndi(0, 1) === 0) {
    if (player.weapon !== AXE) {
      const k = math.rndi(0, len(openTiles) - 1);
      if (player.weapon === NONE) addEntity(m, club(openTiles[k].x, openTiles[k].y));
      else if (player.weapon === CLUB) addEntity(m, sword(openTiles[k].x, openTiles[k].y));
      else if (player.weapon === SWORD) addEntity(m, axe(openTiles[k].x, openTiles[k].y));
      removeAt(openTiles, k);
    }
  } else {
    if (player.shield !== STEEL) {
      const k = math.rndi(0, len(openTiles) - 1);
      if (player.shield === NONE) addEntity(m, wood(openTiles[k].x, openTiles[k].y));
      else if (player.shield === WOOD) addEntity(m, bronze(openTiles[k].x, openTiles[k].y));
      else if (player.shield === BRONZE) addEntity(m, steel(openTiles[k].x, openTiles[k].y));
      removeAt(openTiles, k);
    }
  }
}

function mapUpdate(m: i32): void {
  // A teleport in here makes another map current, but this one finishes its update.
  playerUpdate(m);

  if (maps[m].updateCam) {
    maps[m].cam.x = max(0, min(maps[m].tmW * 8 - maps[m].cam.w, player.tileX * 8 - 40));
    maps[m].cam.y = max(0, min(maps[m].tmH * 8 - maps[m].cam.h, player.tileY * 8 - 32));
  }

  for (let i = 0; i < len(maps[m].entities); i++) entityUpdate(m, i);

  // self.entities.sort(key=lambda x: x.type, reverse=True), which is stable:
  // entities keep their order within a type. Only a map's first frame finds
  // the list out of order; it is then rebuilt one type after the other.
  if (!isSortedByType(m)) {
    const sorted: Entity[] = [];
    for (let type = TYPE_TRIGGER; type >= TYPE_NONE; type--) {
      for (let i = 0; i < len(maps[m].entities); i++) {
        if (maps[m].entities[i].type === type) push(sorted, maps[m].entities[i]);
      }
    }
    maps[m].entities = sorted;
  }

  maps[m].updateCam = false;
}

/** Whether the entities of map m are in the order entities.sort() leaves them. */
function isSortedByType(m: i32): boolean {
  for (let i = 1; i < len(maps[m].entities); i++) {
    if (maps[m].entities[i - 1].type < maps[m].entities[i].type) return false;
  }
  return true;
}

function isTileSolid(m: i32, tileX: i32, tileY: i32): boolean {
  const tile = tilemap.pget(maps[m].tm, maps[m].tmX + tileX, maps[m].tmY + tileY);
  if (isWalkable(tile)) return false;
  else return true;
}

function isTileOccupied(m: i32, tileX: i32, tileY: i32): boolean {
  for (let i = 0; i < len(maps[m].entities); i++) {
    if (maps[m].entities[i].tileX === tileX && maps[m].entities[i].tileY === tileY) {
      if (maps[m].entities[i].type === TYPE_PLAYER || maps[m].entities[i].type === TYPE_ENEMY) return true;
    }
  }
  if (tileX === player.tileX && tileY === player.tileY) return true;
  return false;
}

function isTileFreeForEnemy(m: i32, tileX: i32, tileY: i32): boolean {
  if (isTileFree(m, tileX, tileY)) {
    const tile = tilemap.pget(maps[m].tm, maps[m].tmX + tileX, maps[m].tmY + tileY);
    if (tile === ladderTile) return false;
    else return true;
  } else {
    return false;
  }
}

function isTileFree(m: i32, tileX: i32, tileY: i32): boolean {
  if (tileX < 0 || tileX >= maps[m].tmW || tileY < 0 || tileY >= maps[m].tmH) return false;

  if (isTileSolid(m, tileX, tileY) || isTileOccupied(m, tileX, tileY)) return false;
  else return true;
}

/** The index of the first enemy on a tile, or -1 for None. */
function tileGetAnyEnemy(m: i32, tileX: i32, tileY: i32): i32 {
  for (let i = 0; i < len(maps[m].entities); i++) {
    if (
      maps[m].entities[i].tileX === tileX &&
      maps[m].entities[i].tileY === tileY &&
      maps[m].entities[i].type === TYPE_ENEMY
    ) {
      return i;
    }
  }
  return -1;
}

/** The index of the first item on a tile, or -1 for None. */
function tileGetAnyItem(m: i32, tileX: i32, tileY: i32): i32 {
  for (let i = 0; i < len(maps[m].entities); i++) {
    const type = maps[m].entities[i].type;
    if (
      maps[m].entities[i].tileX === tileX &&
      maps[m].entities[i].tileY === tileY &&
      (type === TYPE_WEAPON ||
        type === TYPE_SHIELD ||
        type === TYPE_POTION ||
        type === TYPE_TELEPORTER ||
        type === TYPE_TRIGGER)
    ) {
      return i;
    }
  }
  return -1;
}

// note: e tile values are from the texture, so need to be resized.
function addEntity(m: i32, e: Entity): void {
  push(maps[m].entities, e);
  const i = len(maps[m].entities) - 1;
  maps[m].entities[i].tileX -= maps[m].tmX;
  maps[m].entities[i].tileY -= maps[m].tmY;
  if (maps[m].entities[i].type === TYPE_TELEPORTER) {
    const toMap = maps[m].entities[i].toMapName;
    maps[m].entities[i].toTileX -= maps[toMap].tmX;
    maps[m].entities[i].toTileY -= maps[toMap].tmY;
  }
}

function mapDraw(m: i32, drawTilemap: boolean, drawEntities: boolean, night: boolean): void {
  if (drawTilemap) {
    // bltm(x, y, tm, u, v, w, h, [colkey])
    if (night) {
      // clip close around player
      const clipX = 40 + player.tileX * 8 - maps[m].cam.x - 8;
      const clipY = 8 + player.tileY * 8 - maps[m].cam.y - 8;

      screen.clip(clipX, clipY, 24, 24);
    } else {
      // clip normally to camera window
      screen.clip(40, 8, 80, 72);
    }

    screen.bltm(
      40 - maps[m].cam.x,
      8 - maps[m].cam.y,
      maps[m].tm,
      maps[m].tmX * 8,
      maps[m].tmY * 8,
      maps[m].tmW * 8,
      maps[m].tmH * 8,
    );
  }

  if (drawEntities) {
    if (night) {
      for (let i = 0; i < len(maps[m].entities); i++) {
        const xDist = maps[m].entities[i].tileX - player.tileX;
        const yDist = maps[m].entities[i].tileY - player.tileY;
        if (xDist >= -1 && xDist <= 2 && yDist >= -1 && yDist <= 2) entityDrawAt(m, i);
      }
    } else {
      for (let i = 0; i < len(maps[m].entities); i++) entityDrawAt(m, i);
    }
  }

  playerDraw(m);

  screen.clip();
}

// ---- entity.py ----------------------------------------------------------

const TYPE_NONE = -1;
const TYPE_PLAYER = 0;
const TYPE_ENEMY = 1;
const TYPE_WEAPON = 2;
const TYPE_SHIELD = 3;
const TYPE_POTION = 4;
const TYPE_TELEPORTER = 5;
const TYPE_TRIGGER = 6;

/** Entity and the fields its subclasses add. */
interface Entity {
  /** The entity's name, as an index into the name table of its type. */
  name: i32;
  img: i32;
  imgX: i32;
  imgY: i32;
  tileX: i32;
  tileY: i32;
  type: i32;
  // Enemy
  hp: i32;
  maxHp: i32;
  attack: i32;
  defence: i32;
  xp: i32;
  maxMoveDelay: i32;
  moveDelay: i32;
  // Teleporter
  toTileX: i32;
  toTileY: i32;
  toMapName: i32;
  // Trigger
  triggerType: i32;
}

function entity(name: i32, img: i32, imgX: i32, imgY: i32, tileX: i32, tileY: i32): Entity {
  return {
    name: name,
    img: img,
    imgX: imgX,
    imgY: imgY,
    tileX: tileX,
    tileY: tileY,
    type: TYPE_NONE,
    hp: 0,
    maxHp: 0,
    attack: 0,
    defence: 0,
    xp: 0,
    maxMoveDelay: 0,
    moveDelay: 0,
    toTileX: 0,
    toTileY: 0,
    toMapName: 0,
    triggerType: 0,
  };
}

/** e.update(map): only enemies do anything. */
function entityUpdate(m: i32, i: i32): void {
  if (maps[m].entities[i].type === TYPE_ENEMY) enemyUpdate(m, i);
}

/** Entity.draw(cam) for an entity at tile_x, tile_y of map m. */
function entityDraw(m: i32, img: i32, imgX: i32, imgY: i32, tileX: i32, tileY: i32): void {
  const camX = maps[m].cam.x,
    camY = maps[m].cam.y;
  // tile_x >= cam.x + cam.w compares tiles with pixels, as the original does.
  if (
    tileX * 8 + 8 < camX ||
    tileX >= camX + maps[m].cam.w ||
    tileY * 8 <= camY - 8 ||
    tileY * 8 >= camY + maps[m].cam.h
  ) {
    return;
  }
  // blt(x, y, img, u, v, w, h, [colkey])
  screen.blt(40 + tileX * 8 - camX, 8 + tileY * 8 - camY, img, imgX, imgY, 8, 8);
}

/** e.draw(cam) for entity i of map m: teleporters and triggers draw nothing. */
function entityDrawAt(m: i32, i: i32): void {
  const type = maps[m].entities[i].type;
  if (type === TYPE_TELEPORTER || type === TYPE_TRIGGER) return;
  entityDraw(
    m,
    maps[m].entities[i].img,
    maps[m].entities[i].imgX,
    maps[m].entities[i].imgY,
    maps[m].entities[i].tileX,
    maps[m].entities[i].tileY,
  );
}

// ---- player.py ----------------------------------------------------------

// Player.WEAPONS, name/key: attack, img_x, img_y and the attack delay.
const NONE = 0;
const CLUB = 1;
const SWORD = 2;
const AXE = 3;
const WEAPON_NAMES: string[] = ["None", "Club", "Sword", "Axe"];
const WEAPON_ATTACK: i32[] = [1, 3, 6, 9];
const WEAPON_IMG_X: i32[] = [32, 64, 48, 56];
const WEAPON_IMG_Y: i32[] = [56, 32, 32, 32];
const WEAPON_ATTACK_DELAY: i32[] = [2, 3, 5, 10];

// Player.SHIELDS, name/key: defence, img_x, img_y ("None" is NONE too).
const WOOD = 1;
const BRONZE = 2;
const STEEL = 3;
const SHIELD_NAMES: string[] = ["None", "Wood", "Bronze", "Steel"];
const SHIELD_DEFENCE: i32[] = [2, 6, 12, 18];
const SHIELD_IMG_X: i32[] = [32, 72, 72, 72];
const SHIELD_IMG_Y: i32[] = [56, 72, 56, 48];

const MAX_XP = 99;
const MAX_LEVEL = 20;

/**
 * Player.XP_LEVELS: 4, 4, 7, 13, 16, 15, 18, 24, 27, 27, 30, 36, 39, 38, 41,
 * 47, 50, 49, 52, 59 (^ is Python's exclusive or).
 */
let xpLevels: i32[] = [];

function initXpLevels(): void {
  for (let i = 1; i < MAX_LEVEL + 1; i++) {
    push(xpLevels, math.round(f32(0.04) * f32(i ^ 3) + f32(0.8) * f32(i ^ 2) + f32(2 * i)));
  }
}

/** Player, an Entity("Player", 0, 32, 0, 0, 0) of TYPE_PLAYER. */
interface Player {
  tileX: i32;
  tileY: i32;
  hp: i32;
  maxHp: i32;
  attack: i32;
  defence: i32;
  level: i32;
  xp: i32;
  weapon: i32;
  shield: i32;
  attackDelay: i32;
  hasCastleKey: boolean;
}

let player: Player = {
  tileX: 0,
  tileY: 0,
  hp: 10,
  maxHp: 10,
  attack: 1,
  defence: 1,
  level: 0,
  xp: 0,
  weapon: NONE,
  shield: NONE,
  attackDelay: 0,
  hasCastleKey: false,
};

function playerInit(): void {
  player = {
    tileX: 0,
    tileY: 0,
    hp: 10,
    maxHp: 10,
    attack: 1,
    defence: 1,
    level: 0,
    xp: 0,
    weapon: NONE,
    shield: NONE,
    attackDelay: 0,
    hasCastleKey: false,
  };
}

function addXp(n: i32): void {
  if (player.level < MAX_LEVEL - 1) {
    const nextLevelXp = xpLevels[player.level + 1];
    player.xp = min(MAX_XP, player.xp + n);
    if (player.xp >= nextLevelXp) {
      player.level += 1;
      pushNewLine(`Level up! (${player.level + 1})`, 9);
      player.xp = 0;
      player.maxHp += 1;
      player.attack += 1;
      player.defence += 1;
      // self.hp = self.max_hp
    }
  }
}

function playerUpdate(m: i32): void {
  if (player.attackDelay > 0) player.attackDelay -= 1;

  if (hasInput(CONFIRM)) {
    if (hasInput(UP)) doAttack(0, -1, m);
    else if (hasInput(DOWN)) doAttack(0, 1, m);
    else if (hasInput(LEFT)) doAttack(-1, 0, m);
    else if (hasInput(RIGHT)) doAttack(1, 0, m);
  } else {
    if (hasInput(UP)) playerMove(0, -1, m);
    else if (hasInput(DOWN)) playerMove(0, 1, m);
    else if (hasInput(LEFT)) playerMove(-1, 0, m);
    else if (hasInput(RIGHT)) playerMove(1, 0, m);
  }

  if (hasInput(CANCEL)) doPickup(m);
}

function doAttack(dirX: i32, dirY: i32, m: i32): void {
  if (player.attackDelay === 0) {
    const enemy = tileGetAnyEnemy(m, player.tileX + dirX, player.tileY + dirY);
    if (enemy >= 0) {
      // map.entities.remove(enemy)
      player.attackDelay = WEAPON_ATTACK_DELAY[player.weapon];
      playerAttackedEnemy(m, enemy);
    }
  }
}

function doPickup(m: i32): void {
  const item = tileGetAnyItem(m, player.tileX, player.tileY);
  if (item >= 0) {
    const type = maps[m].entities[item].type;
    if (type === TYPE_WEAPON) {
      player.weapon = maps[m].entities[item].name;
      pushNewLine(`You got the ${WEAPON_NAMES[player.weapon]}!`, 12);
      removeAt(maps[m].entities, item);
    } else if (type === TYPE_SHIELD) {
      player.shield = maps[m].entities[item].name;
      pushNewLine(`You got the ${SHIELD_NAMES[player.shield]} shield!`, 12);
      removeAt(maps[m].entities, item);
    } else if (type === TYPE_POTION) {
      drink(m, item);
      pushNewLine(`You drank the ${POTION_NAMES[maps[m].entities[item].name]} potion!`, 14);
      removeAt(maps[m].entities, item);
    }
  }
}

function playerMove(moveX: i32, moveY: i32, m: i32): void {
  const item = tileGetAnyItem(m, player.tileX + moveX, player.tileY + moveY);
  if (item >= 0) {
    const type = maps[m].entities[item].type;
    if (type === TYPE_TELEPORTER) {
      enterMap(maps[m].entities[item].toMapName, maps[m].entities[item].toTileX, maps[m].entities[item].toTileY);
      return;
    } else if (type === TYPE_TRIGGER) {
      if (maps[m].entities[item].triggerType === TYPE_CASTLE_DOOR) {
        if (player.hasCastleKey) {
          pushNewLine("You open the doors! Well done!", 7);
          setGameOver();
        } else {
          pushNewLine("Find the key to open the doors!", 7);
        }
      } else if (maps[m].entities[item].triggerType === TYPE_CASTLE_KEY) {
        player.hasCastleKey = true;
        pushNewLine("You found the CASTLE KEY!", 7);
        removeAt(maps[m].entities, item);
      }
    }
  }

  if (isTileFree(m, player.tileX + moveX, player.tileY + moveY)) {
    if (moveX !== 0) {
      player.tileX = max(0, min(maps[m].tmW - 1, player.tileX + moveX));
      maps[m].updateCam = true;
    } else if (moveY !== 0) {
      player.tileY = max(0, min(maps[m].tmH - 1, player.tileY + moveY));
      maps[m].updateCam = true;
    }
  }
  // else:
  //    pass
  // play(ch, snd, loop=False)
  // if pyxel.play_pos(3) == -1:
  //    pyxel.play(3, 0)
}

function playerDraw(m: i32): void {
  if (player.hp === 0) return;
  entityDraw(m, 0, 32, 0, player.tileX, player.tileY);
}

// ---- enemy.py -----------------------------------------------------------

const RAT = 0;
const SCORPION = 1;
const GUARD = 2;
const STRONGMAN = 3;
const GHOST = 4;
const SKELETON = 5;
const ZOMBIE = 6;
const SERPENT = 7;
const WITCH = 8;
const ENEMY_NAMES: string[] = [
  "Rat",
  "Scorpion",
  "Guard",
  "Strongman",
  "Ghost",
  "Skeleton",
  "Zombie",
  "Serpent",
  "Witch",
];

/**
 * Enemy.__init__ followed by the stats every subclass sets: hp (and
 * max_hp), attack, defence, xp and max_move_delay, which replace Enemy's
 * defaults of 5, 1, 1, 1 and 10 frames; move_delay starts at random.
 */
function enemy(
  name: i32,
  img: i32,
  imgX: i32,
  imgY: i32,
  tileX: i32,
  tileY: i32,
  hp: i32,
  attack: i32,
  defence: i32,
  xp: i32,
  maxMoveDelay: i32,
): Entity {
  const e = entity(name, img, imgX, imgY, tileX, tileY);

  e.type = TYPE_ENEMY;

  e.hp = hp;
  e.maxHp = hp;
  e.attack = attack;
  e.defence = defence;
  e.xp = xp;

  e.maxMoveDelay = maxMoveDelay; // frames
  e.moveDelay = math.rndi(1, maxMoveDelay - 1); // frames
  return e;
}

function enemyUpdate(m: i32, i: i32): void {
  maps[m].entities[i].moveDelay += 1;
  if (maps[m].entities[i].moveDelay === maps[m].entities[i].maxMoveDelay) {
    maps[m].entities[i].moveDelay = 0;

    // try_attack() returns None, so `not self.try_attack(map)` holds and the
    // enemy moves whether or not it attacked.
    tryAttack(m, i);
    if (math.rndi(0, 1) === 0) {
      enemyMove(math.rndi(0, 1) === 0 ? -1 : 1, 0, m, i);
    } else {
      enemyMove(0, math.rndi(0, 1) === 0 ? -1 : 1, m, i);
    }
  }
}

function tryAttack(m: i32, i: i32): void {
  const pTileX = player.tileX;
  const pTileY = player.tileY;
  const tileX = maps[m].entities[i].tileX,
    tileY = maps[m].entities[i].tileY;
  if (
    (tileX === pTileX && (tileY - pTileY === 1 || pTileY - tileY === 1)) ||
    (tileY === pTileY && (tileX - pTileX === 1 || pTileX - tileX === 1))
  ) {
    enemyAttackedPlayer(m, i);
  }
}

function enemyMove(moveX: i32, moveY: i32, m: i32, i: i32): void {
  if (isTileFreeForEnemy(m, maps[m].entities[i].tileX + moveX, maps[m].entities[i].tileY + moveY)) {
    if (moveX !== 0) {
      maps[m].entities[i].tileX = max(0, min(maps[m].tmW - 1, maps[m].entities[i].tileX + moveX));
    } else if (moveY !== 0) {
      maps[m].entities[i].tileY = max(0, min(maps[m].tmH - 1, maps[m].entities[i].tileY + moveY));
    }
  }
}

/** enemy.create(): the Enemy subclass of each name. */
function create(name: i32, tileX: i32, tileY: i32): Entity {
  if (name === RAT) return enemy(RAT, 0, 48, 8, tileX, tileY, 1, 1, 1, 1, 20);
  else if (name === SCORPION) return enemy(SCORPION, 0, 56, 8, tileX, tileY, 3, 3, 3, 2, 15);
  else if (name === GUARD) return enemy(GUARD, 0, 40, 0, tileX, tileY, 8, 8, 8, 3, 15);
  else if (name === STRONGMAN) return enemy(STRONGMAN, 0, 48, 0, tileX, tileY, 14, 14, 14, 3, 12);
  else if (name === GHOST) return enemy(GHOST, 0, 72, 8, tileX, tileY, 2, 2, 2, 4, 5);
  else if (name === SKELETON) return enemy(SKELETON, 0, 64, 0, tileX, tileY, 6, 6, 6, 5, 15);
  else if (name === ZOMBIE) return enemy(ZOMBIE, 0, 72, 0, tileX, tileY, 16, 16, 16, 6, 20);
  else if (name === SERPENT) return enemy(SERPENT, 0, 32, 8, tileX, tileY, 20, 20, 20, 8, 20);
  return enemy(WITCH, 0, 56, 0, tileX, tileY, 25, 25, 25, 40, 18);
}

// ---- combat.py ----------------------------------------------------------

function sendMsg(msg: string, col: i32): void {
  pushNewLine(msg, col);
}

/** Removes enemy i of the current map (only the current map's enemies are attacked). */
function killEnemy(i: i32): void {
  removeAt(maps[currentMap].entities, i);
}

function playerAttackedEnemy(m: i32, i: i32): void {
  maps[m].entities[i].hp = max(0, maps[m].entities[i].hp - (player.attack + WEAPON_ATTACK[player.weapon]));
  if (maps[m].entities[i].hp === 0) {
    sendMsg(`You killed the ${ENEMY_NAMES[maps[m].entities[i].name]}. Got ${maps[m].entities[i].xp} XP!`, 3);
    addXp(maps[m].entities[i].xp);
    killEnemy(i);
  } else {
    sendMsg(`You hit the ${ENEMY_NAMES[maps[m].entities[i].name]}.`, 11);
  }
}

function enemyAttackedPlayer(m: i32, i: i32): void {
  const shieldVal = SHIELD_DEFENCE[player.shield];
  if (math.rndi(1, 100) <= shieldVal) {
    sendMsg(`You blocked the ${ENEMY_NAMES[maps[m].entities[i].name]}.`, 12);
  } else {
    player.hp = max(0, player.hp - maps[m].entities[i].attack);
    if (player.hp === 0) {
      sound.stop();
      music.play(2, false);
      sendMsg("You died.", 8);
      setGameOver();
    } else {
      sendMsg(`Got hit by ${ENEMY_NAMES[maps[m].entities[i].name]}.`, 8);
    }
  }
}

// ---- weapon.py, shield.py, potion.py ------------------------------------

function weapon(name: i32, img: i32, imgX: i32, imgY: i32, tileX: i32, tileY: i32): Entity {
  const e = entity(name, img, imgX, imgY, tileX, tileY);
  e.type = TYPE_WEAPON;
  return e;
}

function club(tileX: i32, tileY: i32): Entity {
  return weapon(CLUB, 0, 64, 32, tileX, tileY);
}

function sword(tileX: i32, tileY: i32): Entity {
  return weapon(SWORD, 0, 48, 32, tileX, tileY);
}

function axe(tileX: i32, tileY: i32): Entity {
  return weapon(AXE, 0, 56, 32, tileX, tileY);
}

function shield(name: i32, img: i32, imgX: i32, imgY: i32, tileX: i32, tileY: i32): Entity {
  const e = entity(name, img, imgX, imgY, tileX, tileY);
  e.type = TYPE_SHIELD;
  return e;
}

function wood(tileX: i32, tileY: i32): Entity {
  return shield(WOOD, 0, 72, 72, tileX, tileY);
}

function bronze(tileX: i32, tileY: i32): Entity {
  return shield(BRONZE, 0, 72, 56, tileX, tileY);
}

function steel(tileX: i32, tileY: i32): Entity {
  return shield(STEEL, 0, 72, 48, tileX, tileY);
}

const RED = 0;
const POTION_NAMES: string[] = ["Red"];

function potion(name: i32, img: i32, imgX: i32, imgY: i32, tileX: i32, tileY: i32): Entity {
  const e = entity(name, img, imgX, imgY, tileX, tileY);
  e.type = TYPE_POTION;
  return e;
}

function red(tileX: i32, tileY: i32): Entity {
  return potion(RED, 0, 56, 64, tileX, tileY);
}

/** Potion.drink(player) for potion i of map m. */
function drink(m: i32, i: i32): void {
  if (maps[m].entities[i].name === RED) player.hp = player.maxHp;
}

// ---- teleporter.py, trigger.py ------------------------------------------

function teleporter(tileX: i32, tileY: i32, toTileX: i32, toTileY: i32, toMapName: i32): Entity {
  const e = entity(0, 0, 32, 0, tileX, tileY); // "Teleporter"

  e.type = TYPE_TELEPORTER;
  e.toTileX = toTileX;
  e.toTileY = toTileY;
  e.toMapName = toMapName;
  return e;
}

const TYPE_CASTLE_DOOR = 0;
const TYPE_CASTLE_KEY = 1;

function trigger(tileX: i32, tileY: i32, type: i32): Entity {
  const e = entity(0, 0, 32, 0, tileX, tileY); // "Trigger"

  e.type = TYPE_TRIGGER;
  e.triggerType = type;
  return e;
}

// ---- journal.py ---------------------------------------------------------

const MAX_LINES = 3;
const JOURNAL_X = 8;
const JOURNAL_Y = 88;

/** A journal line: [line, col]. */
interface Line {
  line: string;
  col: i32;
}

let lines: Line[] = [];

function journalInit(): void {
  lines = [];
}

function pushNewLine(line: string, col: i32): void {
  if (len(lines) === MAX_LINES) removeAt(lines, 0);
  push(lines, { line: line, col: col });
}

function journalDraw(): void {
  // text(x, y, s, col)
  for (let i = 0; i < len(lines); i++) screen.text(JOURNAL_X, JOURNAL_Y + i * 8, lines[i].line, lines[i].col);
}

// ---- hud.py -------------------------------------------------------------

function hudDraw(): void {
  screen.pal();

  // bltm(x, y, tm, u, v, w, h, [colkey])
  screen.bltm(0, 0, 7, 0, 0, 160, 120, 15);

  const mapTitleW = len(MAP_NAMES[currentMap]) * 4;
  screen.rect(80 - math.floordiv(mapTitleW + 4, 2), 0, mapTitleW + 4, 8, 0);
  screen.text(80 - math.floordiv(mapTitleW, 2), 1, MAP_NAMES[currentMap], 7);

  // blt(x, y, img, u, v, w, h, [colkey])
  screen.text(9, 10, "You", 7);
  screen.blt(23, 8, 0, 32, 0, 8, 8); // man

  const x = 8;
  let y = 20;

  // health
  screen.blt(x, y, 0, 48, 48, 8, 8); // heart
  screen.text(x + 2, y + 8, `${player.hp}/${player.maxHp}`, 7); // hp text

  y += 20;

  // attack
  const attack = player.attack + WEAPON_ATTACK[player.weapon];
  let ax = x;
  if (attack > 9) ax -= 6;
  screen.blt(x, y, 0, WEAPON_IMG_X[player.weapon], WEAPON_IMG_Y[player.weapon], 8, 8); // sword
  screen.text(ax + 20, y, `${attack}`, 7);

  y += 8;

  // defence
  const defence = SHIELD_DEFENCE[player.shield];
  let dx = x;
  if (defence > 9) dx -= 6;
  screen.blt(x, y, 0, SHIELD_IMG_X[player.shield], SHIELD_IMG_Y[player.shield], 8, 8); // shield
  screen.text(dx + 20, y, `${defence}`, 7);

  y += 14;

  // xp needed for next level
  const level = player.level;
  let next = 0;
  let xp = 0;
  if (level < MAX_LEVEL - 1) {
    next = xpLevels[level + 1];
    xp = next - player.xp;
  }
  let xpx = x;
  if (xp > 9) xpx -= 6;
  screen.blt(x, y, 0, 24, 48, 8, 8);
  screen.text(xpx + 20, y, `${xp}`, 7);

  y += 8;

  // level
  let lx = x;
  if (level + 1 > 9) lx -= 6;
  screen.text(x, y, "Lvl", 7);
  screen.text(lx + 20, y, `${level + 1}`, 7);

  // The original's commented-out daylight and mouse debug text is left out.
}
