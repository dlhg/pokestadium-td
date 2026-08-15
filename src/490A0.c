#include "490A0.h"
#include "src/libnumus/player.h"
#include "src/45720.h"
#include "src/3D140.h"
#include "src/373A0.h"

void func_800484A0(s32 arg0) {
    MusHandleAsk(arg0);
}

s32 func_800484C0(s32 arg0) {
    return MusAsk(arg0);
}

s32 func_800484E0(void) {
    s32 i;
    s32 temp_v0;
    s32 var_s1;

    var_s1 = 0;
    if (mus_free_voices_count != mus_num_vvoices) {
        var_s1 = mus_num_vvoices - mus_free_voices_count;
    }

    for (i = 0; i < 2; i++) {
        if (func_80044E54(i) != 0) {
            var_s1 += 100;
        }
    }

    temp_v0 = func_8003D494();
    if (temp_v0 != 0) {
        var_s1 += temp_v0 * 1000;
    }

    return var_s1;
}

s32 func_80048574(void) {
    return mus_free_voices_count;
}

s32 func_80048580(void) {
    return mus_releasing_voices_count;
}
