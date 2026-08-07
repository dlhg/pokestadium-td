#include "fragment3.h"
#include "src/19840.h"
#include "src/1C720.h"
#include "src/12D80.h"
#include "src/memory.h"

static MiniActor* D_87906120;

void func_87903600(void) {
    s32 i;
    MiniActor* ptr;

    D_87906120 = main_pool_alloc(sizeof(MiniActor) * 3, 0);
    ptr = D_87906120;

    for (i = 0; i < 3; i++, ptr++) {
        func_8001BB58(&ptr->unk_000);
        ptr->unk_168 = func_80019D18(0xAB);
        func_8001BC34(&ptr->unk_000, 0, ptr->unk_23C, ptr->unk_168->unk_08->unk_00[0]);
        func_8001BD04(&ptr->unk_000, 0);
        ptr->unk_000.unk_000.unk_01 &= ~1;
        miniActorAllToZero(ptr);
    }
}

void func_879036B4(MiniActor* arg0) {
    if (arg0->mainState == 1) {
        arg0->unk_000.unk_000.unk_01 |= 1;
        miniChangeActorAnim(arg0, 0, -1, 0);
        arg0->mainState++;
    }
}

void func_8790370C(void) {
    s32 i;
    MiniActor* ptr = D_87906120;

    func_8140C5D0();

    for (i = 0; i < 3; i++, ptr++) {
        func_879036B4(ptr);
        func_879003A0(ptr);
        miniActorUpdateTransform(ptr);
        func_87900808(ptr);
    }
}

void func_87903778(MiniActor* arg0, f32 arg1, f32 arg2, f32 arg3, f32 arg4, s16 arg5, s16 arg6, s16 arg7, s16 arg8) {
    arg0->scale.x = arg1;
    arg0->scale.y = arg1;
    arg0->scale.z = arg1;

    arg0->position_1.x = arg2;
    arg0->position_1.y = arg3;
    arg0->position_1.z = arg4;
    arg0->xRot_1 = arg5;
    arg0->yRot_1 = arg6;
    arg0->zRot_1 = arg7;
    arg0->collidingActorId = arg8;
    arg0->mainState = 1;
}

void func_879037D0(f32 arg0, f32 arg1, f32 arg2, f32 arg3, s16 arg4, s16 arg5, s16 arg6) {
    MiniActor* sp34 = D_87906120;

    func_87903778(sp34, arg0, arg1, arg2, arg3, arg4, arg5, arg6, 0);
    sp34->unk_000.unk_000.unk_14 = 0;
}

void func_87903838(f32 arg0, f32 arg1, f32 arg2, f32 arg3, s16 arg4, s16 arg5, s16 arg6) {
    MiniActor* sp34 = &D_87906120[1];

    func_87903778(sp34, arg0, arg1, arg2, arg3, arg4, arg5, arg6, 1);
    sp34->unk_000.unk_000.unk_14 = 1;
}

void func_879038AC(f32 arg0, f32 arg1, f32 arg2, f32 arg3, s16 arg4, s16 arg5, s16 arg6) {
    MiniActor* sp34 = &D_87906120[2];

    func_87903778(sp34, arg0, arg1, arg2, arg3, arg4, arg5, arg6, 2);
    sp34->unk_000.unk_000.unk_14 = 2;
}

Gfx* func_87903920(Gfx* gfx, arg1_func_87903D64_014* arg1) {
    u8 tmp1;
    u8 tmp2;
    u8 tmp3;
    u8 tmp4;
    u8 tmp5;
    u8 tmp6;
    u8 tmp7;
    u8 tmp8;
    u8 tmp9;
    u32 sp38;
    u32 sp34;
    u32 sp30;
    unk_D_86002F34_000_014_004* sp2C;
    unk_D_86002F34_000_014_004* sp28;
    unk_D_86002F34_000_014_010* sp24;
    unk_D_86002F34_000_014_010* sp20;
    u32 pad;
    u32 temp_a2;
    u32 temp_a3;

    temp_a2 = D_8006F09C->unk_000.unk_14;
    temp_a3 = (D_8006F09C->unk_040.unk_08 >> 0x10) + 1;

    pad = arg1->unk_00;
    switch (pad) {
        case 1:
            if (temp_a3 < 0xF) {
                sp38 = 0;
                sp34 = 1;
                sp30 = (temp_a3 << 8) / 15;
            } else if (temp_a3 < 0x1D) {
                sp38 = 1;
                sp34 = 2;
                sp30 = ((temp_a3 << 8) - 0xF00) / 14;
            } else {
                sp38 = 2;
                sp34 = 2;
                sp30 = 0;
            }
            break;

        case 2:
            if (temp_a3 < 5) {
                sp38 = 0;
                sp34 = 1;
                sp30 = (temp_a3 << 8) / 5;
            } else if (temp_a3 < 0xF) {
                sp38 = 1;
                sp34 = 2;
                sp30 = ((temp_a3 << 8) - 0x500) / 10;
            } else if (temp_a3 < 0x1D) {
                sp38 = 2;
                sp34 = 3;
                sp30 = ((temp_a3 << 8) - 0xF00) / 14;
            } else {
                sp38 = 3;
                sp34 = 3;
                sp30 = 0;
            }
            break;
    }

    switch (temp_a2) {
        case 0:
            sp2C = &arg1->unk_04[sp38];
            sp28 = &arg1->unk_04[sp34];
            sp24 = &arg1->unk_10[sp38];
            sp20 = &arg1->unk_10[sp34];
            break;

        case 1:
            sp2C = &arg1->unk_08[sp38];
            sp28 = &arg1->unk_08[sp34];
            sp24 = &arg1->unk_14[sp38];
            sp20 = &arg1->unk_14[sp34];
            break;

        case 2:
            sp2C = &arg1->unk_0C[sp38];
            sp28 = &arg1->unk_0C[sp34];
            sp24 = &arg1->unk_18[sp38];
            sp20 = &arg1->unk_18[sp34];
            break;
    }



    tmp1 = ((sp28->unk_00[0] * sp30) + (sp2C->unk_00[0] * (0x100 - sp30))) >> 8;
    tmp2 = ((sp28->unk_00[1] * sp30) + (sp2C->unk_00[1] * (0x100 - sp30))) >> 8;
    tmp3 = ((sp28->unk_00[2] * sp30) + (sp2C->unk_00[2] * (0x100 - sp30))) >> 8;
    tmp4 = ((sp28->unk_00[3] * sp30) + (sp2C->unk_00[3] * (0x100 - sp30))) >> 8;
    tmp5 = ((sp28->unk_00[4] * sp30) + (sp2C->unk_00[4] * (0x100 - sp30))) >> 8;

    tmp6 = ((sp20->unk_00[0] * sp30) + (sp24->unk_00[0] * (0x100 - sp30))) >> 8;
    tmp7 = ((sp20->unk_00[1] * sp30) + (sp24->unk_00[1] * (0x100 - sp30))) >> 8;
    tmp8 = ((sp20->unk_00[2] * sp30) + (sp24->unk_00[2] * (0x100 - sp30))) >> 8;
    tmp9 = ((sp20->unk_00[3] * sp30) + (sp24->unk_00[3] * (0x100 - sp30))) >> 8;

    gDPPipeSync(gfx++);
    gDPSetPrimColor(gfx++, 0, tmp5, tmp1, tmp2, tmp3, tmp4);
    gDPSetEnvColor(gfx++, tmp6, tmp7, tmp8, tmp9);

    return gfx;
}

void func_87903D64(s32 arg0, arg1_func_87903D64* arg1) {
    if (arg0 == 5) {
        arg1_func_87903D64_014* tmp = arg1->unk_14;

        gDisplayListHead = func_87903920(gDisplayListHead, tmp);
    }
}
