#ifndef _PLAYER_H_
#define _PLAYER_H_

#include "global.h"
#include "src/libnaudio/n_libaudio_sc.h"
#include "src/libnaudio/n_libaudio_sn_sc.h"
#include "src/libnaudio/n_synthInternals.h"

#define FORNEXT_DEPTH 4

#define MUSFLAG_EFFECTS	1
#define MUSFLAG_SONGS	2

#define FX_PRIORITY 3

typedef struct musConfig {
    /* 0x00 */ u32 channels;
    /* 0x04 */ u32 vvoices;
    /* 0x08 */ u32 pvoices;
    /* 0x0C */ void* heap;
    /* 0x10 */ s32 heap_length;
    /* 0x14 */ u32 syn_updates;
    /* 0x18 */ u32 syn_output_rate;
    /* 0x1C */ u32 syn_rsp_cmds;
    /* 0x20 */ u32 syn_retraceCount;
    /* 0x24 */ u32 syn_num_dma_bufs;
    /* 0x28 */ u32 syn_dma_buf_size;
    /* 0x2C */ u32 command_queue_max_size;
} musConfig; // size >= 0x30

/**
 * byte 0: envelope speed
 * byte 1: padding
 * byte 2: attack speed
 * byte 3: max volume
 * byte 4: decay speed
 * byte 5: sustain volume
 * byte 6: release speed
 */
typedef struct envelope_t {
    /* 0x00 */ char params[0x7];
} envelope_t; // size = 0x7

typedef struct fx_metadata_t {
    /* 0x00 */ u8 params[4]; // [3] = default priority
} fx_metadata_t; // size = 0x4

typedef struct song_t {
    /* 0x00 */ u32 num_channels;
    /* 0x04 */ u32* channel_data;
    /* 0x08 */ u32* volume_data;
    /* 0x0C */ u32* pitchbend_data;
    /* 0x10 */ envelope_t* env_table;
    /* 0x14 */ s32* drum_table;
    /* 0x18 */ char unk18[0x10];
    /* 0x28 */ f32* detune;
    /* 0x2C */ u32* samples;
} song_t; // size >= 0x18

typedef struct fx_t {
    /* 0x00 */ char unk00[0x8];
    /* 0x08 */ fx_metadata_t** fx_metadata;
    /* 0x0C */ u32* fx_data;
} fx_t; // size >= 0x10

typedef struct audio_voice_t {
    /* 0x00 */ ALLink node;
    /* 0x08 */ N_ALVoice voice;
    /* 0x24 */ s32 release_end_frame;
    /* 0x28 */ u16 env_release_speed;
    /* 0x2A */ u8 env_phase;
} audio_voice_t; // size = 0x2C

typedef struct channel_t {
    /* 0x000 */ struct channel_t* unk_000;
    /* 0x004 */ char unk004[0x4];
    /* 0x008 */ u64 channel_frame;
    /* 0x010 */ u64 volume_frame;
    /* 0x018 */ u64 pitchbend_frame;
    /* 0x020 */ u64 note_end_frame;
    /* 0x028 */ u64 note_start_frame;
    /* 0x030 */ u64 envelope_end;
    /* 0x038 */ u8* pdata;
    /* 0x03C */ s32 sample;
    /* 0x040 */ s32 duration;
    /* 0x044 */ s32 duration_scale;
    /* 0x048 */ f32 vib_amount;
    /* 0x04C */ f32 pitchbend_calc;
    /* 0x050 */ f32 pitch_current;
    /* 0x054 */ f32 base_note;
    /* 0x058 */ f32 freqoffset;
    /* 0x05C */ u8* ppitchbendbase;
    /* 0x060 */ u8* pvolumebase;
    /* 0x064 */ s32 handle;
    /* 0x068 */ s32 priority;
    /* 0x06C */ f32 last_note;
    /* 0x070 */ f32 port_base;
    /* 0x074 */ f32 env_attack_calc;
    /* 0x078 */ f32 env_decay_calc;
    /* 0x07C */ s32 env_speed_calc;
    /* 0x080 */ f32 vibrato;
    /* 0x084 */ f32 bendrange;
    /* 0x088 */ f32 pitchbend;
    /* 0x08C */ song_t* song_addr;
    /* 0x090 */ song_t* sample_bank;
    /* 0x094 */ u8* pbase;
    /* 0x098 */ u8* pdrums;
    /* 0x09C */ u8* ppitchbendbase_offset;
    /* 0x0A0 */ u8* pvolumebase_offset;
    /* 0x0A4 */ f32 distort;
    /* 0x0A8 */ u32 sweep_frame;
    /* 0x0AC */ s16 temscale;
    /* 0x0AE */ u16 note_duration;
    /* 0x0B0 */ u16 channel_tempo;
    /* 0x0B2 */ s16 volume_scale;
    /* 0x0B4 */ u16 volume_current;
    /* 0x0B6 */ u16 cont_vol_repeat_count;
    /* 0x0B8 */ u16 cont_pb_repeat_count;
    /* 0x0BA */ u16 IsFX;
    /* 0x0BC */ u16 channel_tempo_save;
    /* 0x0BE */ u16 wobble_frame;
    /* 0x0C0 */ u16 fixed_length;
    /* 0x0C2 */ u16 wave;
    /* 0x0C4 */ s16 sweep_amount;
    /* 0x0C6 */ u16 cutoff;
    /* 0x0C8 */ u16 endit;
    /* 0x0CA */ u8 vib_delay;
    /* 0x0CB */ u8 ignore;
    /* 0x0CC */ u8 port;
    /* 0x0CD */ s8 transpose;
    /* 0x0CE */ u8 ignore_transpose;
    /* 0x0CF */ u8 velocity;
    /* 0x0D0 */ u8 volume;
    /* 0x0D1 */ u8 pan;
    /* 0x0D2 */ u8 pan_current;
    /* 0x0D3 */ u8 env_speed;
    /* 0x0D4 */ u8 env_init_vol;
    /* 0x0D5 */ u8 env_max_vol;
    /* 0x0D6 */ u8 env_sustain_vol;
    /* 0x0D7 */ u8 env_state;
    /* 0x0D8 */ u8 env_current_vol;
    /* 0x0D9 */ u8 env_decay_begin;
    /* 0x0DA */ u8 env_attack_speed;
    /* 0x0DB */ u8 env_decay_speed;
    /* 0x0DC */ u32 pending;
    /* 0x0E0 */ u8 env_release_speed;
    /* 0x0E1 */ u8 playing;
    /* 0x0E2 */ u8 reverb;
    /* 0x0E3 */ u8 reverb_intensity;
    /* 0x0E4 */ u8 reverb_mix;
    /* 0x0E5 */ u8 wobble_on_speed;
    /* 0x0E6 */ u8 wobble_off_speed;
    /* 0x0E7 */ u8 wobble_counter;
    /* 0x0E8 */ s8 wobble_value;
    /* 0x0E9 */ u8 velocity_on;
    /* 0x0EA */ u8 default_velocity;
    /* 0x0EB */ u8 sweep_speed;
    /* 0x0EC */ u8 vib_speed;
    /* 0x0ED */ u8 env_trigger_off;
    /* 0x0EE */ u8 trigger_off;
    /* 0x0EF */ s8 wobble_amount;
    /* 0x0F0 */ u8 sweep_counter;
    /* 0x0F1 */ u8 sweep_direction;
    /* 0x0F2 */ u8 for_stack_count;
    /* 0x0F4 */ u8* for_stack[FORNEXT_DEPTH];
    /* 0x104 */ u8* for_stackvol[FORNEXT_DEPTH];
    /* 0x114 */ u8* for_stackpb[FORNEXT_DEPTH];
    /* 0x124 */ u16 for_vol_count[FORNEXT_DEPTH];
    /* 0x12C */ u16 for_pb_count[FORNEXT_DEPTH];
    /* 0x134 */ u8 for_count[FORNEXT_DEPTH];
    /* 0x138 */ u8 for_volume[FORNEXT_DEPTH];
    /* 0x13C */ u8 for_pitchbend[FORNEXT_DEPTH];
    /* 0x140 */ fx_t* fx_bank;
    /* 0x144 */ char unk144[0x4];
    /* 0x148 */ audio_voice_t* voice;
    /* 0x14C */ char unk14C[0x4];
} channel_t; // size = 0x150

typedef struct bank_remap_descriptor_t {
    /* 0x00 */ u32 num_entries;
    /* 0x04 */ u32 flags;
    /* 0x08 */ u32* metadata_offset;
    /* 0x0C */ u32* entries_offset;
} bank_remap_descriptor_t; // size = 0x10

extern ALHeap* audio_heap;
extern u32 mus_num_vvoices;
extern s32 mus_free_voices_count;
extern s32 mus_releasing_voices_count;

u8* Fstop(channel_t*, UNUSED u8*);
u8* Fwave(channel_t*, u8*);
u8* Fport(channel_t*, u8*);
u8* Fportoff(channel_t*, u8*);
u8* Fdefa(channel_t*, u8*);
u8* Ftempo(channel_t*, u8*);
u8* Fendit(channel_t*, u8*);
u8* Fcutoff(channel_t*, u8*);
u8* Fvibup(channel_t*, u8*);
u8* Fvibdown(channel_t*, u8*);
u8* Fviboff(channel_t*, u8*);
u8* Flength(channel_t*, u8*);
u8* Fignore(channel_t*, u8*);
u8* Ftrans(channel_t*, u8*);
u8* Fignore_trans(channel_t*, u8*);
u8* Fdistort(channel_t*, u8*);
u8* Fenvelope(channel_t*, u8*);
u8* Fenvoff(channel_t*, u8*);
u8* Fenvon(channel_t*, u8*);
u8* Ftroff(channel_t*, u8*);
u8* Ftron(channel_t*, u8*);
u8* Ffor(channel_t*, u8*);
u8* Fnext(channel_t*, u8*);
u8* Fwobble(channel_t*, u8*);
u8* Fwobbleoff(channel_t*, u8*);
u8* Fvelon(channel_t*, u8*);
u8* Fveloff(channel_t*, u8*);
u8* Fvelocity(channel_t*, u8*);
u8* Fpan(channel_t*, u8*);
u8* Fstereo(UNUSED channel_t*, u8*);
u8* Fdrums(channel_t*, u8*);
u8* Fdrumsoff(channel_t*, u8*);
u8* Fprint(UNUSED channel_t*, u8*);
u8* Fgoto(channel_t*, u8*);
u8* Freverb(channel_t*, u8*);
u8* FrandNote(channel_t*, u8*);
u8* FrandVolume(channel_t*, u8*);
u8* FrandPan(channel_t*, u8*);
u8* Fvolume(channel_t*, u8*);
u8* Fstartfx(channel_t*, u8*);
u8* Fbendrange(channel_t*, u8*);
u8* Fsweep(channel_t*, u8*);
u8* Fstartfx_ext(channel_t*, u8*);
void write_u32_be(u8*, u32);
void write_u16_be(u8*, u32);
s32 MusInitialize(musConfig*);
void MusSetMasterVolume(s32, u32);
s32 MusLoadSong(SoundBank*, song_t*);
s32 MusStartSoundEffect(SoundBank*, fx_t*, s32, s32, u32, s32);
void MusSetAllChannelsDuration(s32, u32);
s32 MusAsk(s32);
void MusSetDurationScale(s32, u32);
s32 MusHandleAsk(s32);
void MusSetVolumeScale(s32, u32);
void MusSetSweepAmount(s32, u16);
void MusSetFrequencyOffset(s32, f32);
void MusSetTempoScale(s32, s32);
void MusSetTempoScale_u8(u32, s32);
void MusBankInitialize(s32, s32);
void RemapBankPointers(bank_remap_descriptor_t*);
void MusSetPanMode(s32);
void MusSetVoicePriority(s32);
void MusStopAllSongs(void);
s32 MusLoadSongWithFade(SoundBank*, song_t*, u32);
s32 MusSetupVolumeFade(s32, u8, u8, u32);
u32 read_u32_be(u8*);
u16 read_u16_be(u8*);
void MusProcessCommandQueue(void);
u8* __MusLoadSong(u8*);
u8* ____MusLoadSongWithFade(u8*);
u8* __MusStartSoundEffect(u8*);
u8* __MusSetFrequencyOffset(u8*);
u8* __MusSetTempoScale(u8*);
u8* __MusSetVolumeScale(u8*);
u8* __MusSetSweepAmount(u8*);
u8* __MusSetReverbIntensity(u8*);
u8* __MusSetDurationScale(u8*);
u8* __MusSetAllChannelsDuration(u8*);
u8* __MusSetMasterVolume(u8*);
u8* __MusSetPanMode(u8*);
s32 __MusIntMain(void*);
void __MusIntGetNewNote(channel_t*);
s32 __MusIntSetVolumeAndPan(channel_t*);
f32 __MusIntSetPitch(channel_t*, f32);
void __MusIntInitEnvelope(channel_t*);
void __MusIntProcessEnvelope(channel_t*);
void __MusIntInitSweep(channel_t*);
void __MusIntProcessSweep(channel_t*);
f32 __MusIntProcessWobble(channel_t*);
f32 __MusIntProcessVibrato(channel_t*);
void __MusIntProcessContinuousVolume(channel_t*);
void __MusIntProcessContinuousPitchBend(channel_t*);
f32 __MusIntPowerOf2(f32);
void __MusIntRemapPtrBank(u8*, s32);
s32 __MusIntRandom(s32);
void __MusIntInitialiseChannel(channel_t*);
s32 __MusIntFindChannel(song_t*, s32);
void __MusIntMemSet(u8*, u8, u32);
void __MusIntRemapPtrs(u8*, u32, u32);
s32 __MusIntStartEffect(channel_t*, s32, s32, s32, s32);
void MusVoiceReturnToFree(audio_voice_t*);
audio_voice_t* MusVoiceAllocate(void);
void MusVoiceAddToReleaseList(audio_voice_t*);
void MusVoiceProcessCleanup(void);

#endif // _PLAYER_H_
