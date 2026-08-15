#include "48C60.h"
#include "38BB0.h"

// .data
u8 D_80078A10[3] = { 0xFF, 0xFF, 0xFF };
u32 D_80078A14 = 0;
s32 D_80078A18 = 0;
u8 D_80078A1C[4] = { 0 };
u8 D_80078A20[16] = { 0 };

#pragma GLOBAL_ASM("asm/us/nonmatchings/48C60/func_80048060.s")

void func_80048464(void) {
  if (D_80078A1C[0] != 0) {
      func_800392A8(D_80078A18, (s32)D_80078A1C[0]);
  }
}
