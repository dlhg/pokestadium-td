#include "4BA90.h"
#include "src/49790.h"
#include "src/libnumus/player.h"
#include "src/3D140.h"

void func_8004AE90(s32 arg0, u32 arg1) {
    s32 var_a1;

    switch (arg1) {
        case 0:
            var_a1 = 0;
            break;

        case 1:
            var_a1 = 0x3FFF;
            break;

        case 2:
            var_a1 = 0x4FFF;
            break;

        case 3:
            var_a1 = 0x5FFF;
            break;

        case 4:
            var_a1 = 0x6FFF;
            break;

        case 5:
            var_a1 = 0x7FFF;
            break;

        default:
            var_a1 = 0x6FFF;
            break;
    }

    if (arg0 & 1) {
        D_80078E64 = var_a1;
    }

    if (arg0 & 2) {
        D_80078E60 = var_a1;
    }

    MusSetMasterVolume(arg0, var_a1);
}

void func_8004AF24(s32 arg0) {
    MusSetPanMode(arg0);
}

void func_8004AF44(u32 arg0) {
    switch (arg0) {
        case 1:
            MusSetDurationScale(D_80078E68, 3);
            MusSetMasterVolume(2, D_80078E60 >> 1);
            MusSetMasterVolume(1, D_80078E64 / 3);
            D_80078E68 = func_80048B90(0x23);
            MusSetVolumeScale(D_80078E68, 0xFF);
            break;

        case 0:
            MusSetDurationScale(D_80078E68, 3);
            MusSetMasterVolume(2, D_80078E60);
            MusSetMasterVolume(1, D_80078E64);
            D_80078E68 = func_80048B90(0x24);
            break;

        case 2:
            MusSetVolumeScale(func_80048B90(1), 0xFF);
            break;

        case 3:
            MusSetVolumeScale(func_80048B90(0x21), 0xFF);
            break;

        case 4:
            MusSetDurationScale(D_80078E68, 3);
            MusSetMasterVolume(2, D_80078E60);
            MusSetMasterVolume(1, D_80078E64);
            break;
    }
}

void func_8004B094(u32 arg0) {
    u32 temp_v0;

    if (arg0 == 0) {
        arg0 = 1;
    }

    temp_v0 = osSetIntMask(1);

    D_80077DD4 = D_80078E60;
    D_80077DDC = D_80078E64;
    D_80077DD8 = D_80077DD4 / arg0;
    D_80077DE0 = D_80077DDC / arg0;
    mus_sound_effect_blocked = 1;

    osSetIntMask(temp_v0);
}

void func_8004B154(void) {
    u32 temp_v0 = osSetIntMask(1);

    mus_sound_effect_blocked = 0;
    D_80077DD4 = 0.0f;
    D_80077DDC = 0.0f;

    osSetIntMask(temp_v0);

    MusSetMasterVolume(2, D_80078E60);
    MusSetMasterVolume(1, D_80078E64);
}
