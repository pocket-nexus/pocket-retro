/*
 * Headless GBA frontend over libmgba for tests and measurements.
 *
 * The functions below have fixed-width scalar signatures so that Bun's FFI
 * can call them without callbacks. Video frames, audio samples and mGBA log
 * lines are copied into caller buffers.
 */
#include <mgba-util/vfs.h>
#include <mgba/core/blip_buf.h>
#include <mgba/core/config.h>
#include <mgba/core/core.h>
#include <mgba/core/log.h>

#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#define VIDEO_STRIDE 256
#define VIDEO_HEIGHT 160
#define AUDIO_RATE 32768
#define LOG_CAPACITY (1 << 20)

static struct mCore *core;
static color_t video[VIDEO_STRIDE * VIDEO_HEIGHT];
static char logText[LOG_CAPACITY];
static size_t logLength;
static int logDropped;

static void appendLog(const char *text) {
  size_t length = strlen(text);
  if (logLength + length + 1 >= LOG_CAPACITY) {
    logDropped = 1;
    return;
  }
  memcpy(logText + logLength, text, length);
  logLength += length;
  logText[logLength] = 0;
}

static void captureLog(struct mLogger *logger, int category,
                       enum mLogLevel level, const char *format, va_list args) {
  (void)logger;
  const char *name = mLogCategoryName(category);
  int debug = name && strcmp(name, "GBA Debug") == 0;
  // Keep the ROM's own prints and anything the emulator reports as a problem.
  if (!debug &&
      !(level & (mLOG_FATAL | mLOG_ERROR | mLOG_WARN | mLOG_GAME_ERROR))) {
    return;
  }
  char line[1024];
  int prefix = snprintf(line, sizeof(line), "%s%s",
                        debug  ? ""
                        : name ? name
                               : "mGBA",
                        debug ? "" : ": ");
  vsnprintf(line + prefix, sizeof(line) - prefix - 1, format, args);
  strcat(line, "\n");
  appendLog(line);
}

static struct mLogger logger = {.log = captureLog};

int32_t emu_open(const char *path) {
  mLogSetDefaultLogger(&logger);
  core = mCoreFind(path);
  if (!core) {
    return -1;
  }
  if (!core->init(core)) {
    return -2;
  }
  mCoreInitConfig(core, NULL);
  core->setVideoBuffer(core, video, VIDEO_STRIDE);
  core->setAudioBufferSize(core, 4096);
  if (!mCoreLoadFile(core, path)) {
    return -3;
  }
  struct mCoreOptions options = {.useBios = false,
                                 .skipBios = true,
                                 .volume = 0x100,
                                 .audioSync = false,
                                 .videoSync = false};
  mCoreConfigLoadDefaults(&core->config, &options);
  mCoreLoadConfig(core);
  blip_set_rates(core->getAudioChannel(core, 0), core->frequency(core),
                 AUDIO_RATE);
  blip_set_rates(core->getAudioChannel(core, 1), core->frequency(core),
                 AUDIO_RATE);
  core->reset(core);
  return 0;
}

void emu_close(void) {
  if (!core) {
    return;
  }
  mCoreConfigDeinit(&core->config);
  core->deinit(core);
  core = NULL;
}

void emu_set_keys(uint32_t keys) { core->setKeys(core, keys); }

void emu_run_frames(int32_t frames) {
  for (int32_t i = 0; i < frames; ++i) {
    core->runFrame(core);
  }
}

uint32_t emu_frame_counter(void) { return core->frameCounter(core); }

/* Copies the 240x160 frame as RGBA8888 into out (153600 bytes). */
void emu_video_rgba(uint8_t *out) {
  for (int y = 0; y < VIDEO_HEIGHT; ++y) {
    for (int x = 0; x < 240; ++x) {
      color_t color = video[y * VIDEO_STRIDE + x];
      uint8_t *pixel = &out[(y * 240 + x) * 4];
      pixel[0] = color & 0xff;
      pixel[1] = (color >> 8) & 0xff;
      pixel[2] = (color >> 16) & 0xff;
      pixel[3] = 0xff;
    }
  }
}

/* Moves up to capacity stereo frames of 32768 Hz audio into out; returns the
 * count. */
int32_t emu_audio(int16_t *out, int32_t capacity) {
  struct blip_t *left = core->getAudioChannel(core, 0);
  struct blip_t *right = core->getAudioChannel(core, 1);
  int available = blip_samples_avail(left);
  if (available > capacity) {
    available = capacity;
  }
  blip_read_samples(left, out, available, 1);
  blip_read_samples(right, out + 1, available, 1);
  return available;
}

void emu_read(uint32_t address, uint8_t *out, uint32_t length) {
  for (uint32_t i = 0; i < length; ++i) {
    out[i] = core->rawRead8(core, address + i, -1);
  }
}

/* Moves captured log text into out; returns its length, or -1 if lines were
 * dropped. */
int32_t emu_take_log(char *out, int32_t capacity) {
  size_t length =
      logLength < (size_t)capacity - 1 ? logLength : (size_t)capacity - 1;
  memcpy(out, logText, length);
  out[length] = 0;
  memmove(logText, logText + length, logLength - length + 1);
  logLength -= length;
  int dropped = logDropped;
  logDropped = 0;
  return dropped ? -1 : (int32_t)length;
}
