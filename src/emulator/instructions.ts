import { UintArray } from "./IEmu.js";
import {enum_count, object_map} from "./util.js";



export const call_stack_cap = 10_000;
export const data_stack_cap = 10_000;

export enum Opcode {
    // Core Instructions
    ADD, RSH, LOD, STR, BGE, NOR, IMM,
    // Basic Instructions
    SUB, JMP, MOV, NOP, LSH, INC, DEC, NEG,
    AND, OR, NOT, XNOR, XOR, NAND,
    BRL, BRG, BRE, BNE, BOD, BEV, BLE, BRZ,
    BNZ, BRN, BRP, PSH, POP, CAL, RET, HLT,
    CPY, BRC, BNC,

    // Complex Instructions
    MLT, DIV, MOD, BSR, BSL, SRS, BSS,
    SETE, SETNE, SETG, SETL, SETGE, SETLE,
    SETC, SETNC, LLOD, LSTR,

    // IO Instructions
    IN, OUT,
    
    // Signed Instructions
    SDIV, SBRL, SBRG, SBLE , SBGE, SSETL, SSETG, SSETLE, SSETGE,
    ABS,

    //----- Debug Instructions
    __ASSERT,
    __ASSERT0,
    __ASSERT_EQ,
    __ASSERT_NEQ,

    //----- experimental instructions
    UMLT, SUMLT,


    //----- iris instructions
    HCAL, HRET,
    HSAV, HRSR,
    HPSH, HPOP ,

    FTOI,
    ITOF,
    FMLT,
    FDIV,
    FADD,
    FSUB,
    FABS,
    FSQRT,
}

export enum Register {
    PC, SP, _DSP, _CSP
}
export const register_count = enum_count(Register);

export enum Operant_Prim {
    Reg, Imm,
}

export enum Operant_Type {
    Reg = Operant_Prim.Reg, Imm = Operant_Prim.Imm,
    Memory, Label, Data_Label, Constant, String,
    NoInit
}

export enum Operant_Operation {
    SET, GET, GET_RAM, SET_RAM, RAM_OFFSET
}

export enum URCL_Header {
    BITS, MINREG, MINHEAP, RUN, MINSTACK
}

export enum Constants {
    BITS, MSB, SMSB, MAX, SMAX, UHALF, LHALF,
    MINREG, MINHEAP, HEAP, MINSTACK
}


export enum Header_Operant {
    "==", "<=", ">="
}
export enum Header_Run {
    ROM, RAM
}

interface URCL_Header_Def {
    def: number,
    def_operant?: Header_Operant,
    in?: Record<string, unknown>
}

// TODO: changed for iris
export const urcl_headers: Record<URCL_Header, URCL_Header_Def> = {
    [URCL_Header.BITS]: {def: 16, def_operant: Header_Operant["=="]},
    [URCL_Header.MINREG]: {def: 25},
    [URCL_Header.MINHEAP]: {def: 1024 * 4},
    [URCL_Header.RUN]: {def: Header_Run.ROM, in: Header_Run},
    [URCL_Header.MINSTACK]: {def: 8},
}

export enum IO_Port {
    // General
    CPUBUS, TEXT, NUMB, SUPPORTED = 5, SPECIAL, PROFILE,
    // Graphics
    X, Y, COLOR, BUFFER, G_SPECIAL = 15,
    // Text
    ASCII, CHAR5, CHAR6, ASCII7, UTF8, UTF16, UTF32, T_SPECIAL = 23,
    // Numbers
    INT, UINT, BIN, HEX, FLOAT, FIXED, N_SPECIAL=31,
    // Storage
    ADDR, BUS, PAGE, S_SPECIAL=39,
    // Miscellaneous
    RNG, NOTE, INSTR, NLEG, WAIT, NADDR, DATA, M_SPECIAL,
    // User defined
    UD1, UD2, UD3, UD4, UD5, UD6, UD7, UD8, UD9, UD10, UD11, UD12, UD13, UD14, UD15, UD16,

    GAMEPAD, AXIS, GAMEPAD_INFO,
    KEY,
    MOUSE_X, MOUSE_Y, MOUSE_DX, MOUSE_DY,
    MOUSE_DWHEEL,
    MOUSE_BUTTONS,
    FILE,
    DBG_INT,
    
    BENCHMARK,
    TIME,

    // Iris ports
    TILE,
    X1, Y1, X2, Y2, LINE,
    TOGGLE_BUFFER,
    FAIL_ASSERT,
}

export interface Instruction_Ctx {
    // starting with an _ for the JIT
    readonly _bits: number,
    readonly max_value: number,
    readonly max_signed: number,
    readonly sign_bit: number,
    pc: number;
    a: number,
    b: number,
    c: number,
    sa: number,
    sb: number,
    sc: number,
    m_set(a: number, v: number): void;
    m_get(a: number): number;
    push(a: number): void;
    pop(): number;
    in(port: number): boolean;
    out(port: number, value: number): void;
    warn(msg: string): void;

    // ---- iris stuff
    csp: number;
    dsp: number;
    call_stack: UintArray;
    call_stack_cap: number;

    data_stack: UintArray;
    data_stack_cap: number;
    
    
    save_reg(): void;
    restore_reg(): void;

    f16_encode(float: number): number;
    f16_decode(int: number): number;
}

type Instruction_Callback = (ctx: Instruction_Ctx) => void | boolean;

const {SET, GET, GET_RAM: GAM, SET_RAM: SAM, RAM_OFFSET: RAO} = Operant_Operation;
export const Opcodes_operants: Record<Opcode, [Operant_Operation[], Instruction_Callback]> = {
    //----- Core Instructions
    // Add Op2 to Op3 then put result into Op1
    [Opcode.ADD ]: [[SET, GET, GET], (s) => {s.a = s.b + s.c}],
    // Unsigned right shift Op2 once then put result into Op1
    [Opcode.RSH ]: [[SET, GET     ], (s) => {s.a = s.b >>> 1}],
    // Copy RAM value pointed to by Op2 into Op1
    [Opcode.LOD ]: [[SET, GAM     ], (s) => {s.a = s.m_get(s.b)}],
    // Copy Op2 into RAM value pointed to by Op1
    [Opcode.STR ]: [[SAM, GET     ], (s) => s.m_set(s.a, s.b)],
    // Branch to address specified by Op1 if Op2 is more than or equal to Op3
    [Opcode.BGE ]: [[GET, GET, GET], (s) => {if (s.b >= s.c) s.pc = s.a}],
    [Opcode.SBGE ]: [[GET, GET, GET], (s) => {if (s.sb >= s.sc) s.pc = s.a}],
    // Bitwise NOR Op2 and Op3 then put result into Op1
    [Opcode.NOR ]: [[SET, GET, GET], (s) => {s.a = ~(s.b | s.c)}],
    // Load immediate
    [Opcode.IMM ]: [[SET, GET     ], (s) => {s.a = s.b}],
    
    //----- Basic Instructions
    // Subtract Op3 from Op2 then put result into Op1
    [Opcode.SUB ]: [[SET, GET, GET], (s) => {s.a = s.b - s.c}],
    // Branch to address specified by Op1
    [Opcode.JMP ]: [[GET          ], (s) => {s.pc = s.a}],
    // Copy Op2 to Op1
    [Opcode.MOV ]: [[SET, GET     ], (s) => {s.a = s.b}],
    // Copy Op2 to Op1
    [Opcode.NOP ]: [[             ], ()=> false],
    // Left shift Op2 once then put result into Op1
    [Opcode.LSH ]: [[SET, GET     ], (s) => {s.a = s.b << 1}],
    // Add 1 to Op2 then put result into Op1
    [Opcode.INC ]: [[SET, GET     ], (s) => {s.a = s.b + 1}],
    // Subtract 1 from Op2 then put result into Op1
    [Opcode.DEC ]: [[SET, GET     ], (s) => {s.a = s.b - 1}],
    // Calculates the 2s complement of Op2 then puts answer into Op1
    [Opcode.NEG ]: [[SET, GET     ], (s) => {s.a = -s.b}],
    // Bitwise AND Op2 and Op3 then put result into Op1
    [Opcode.AND ]: [[SET, GET, GET], (s) => {s.a = s.b & s.c}],
    // Bitwise OR Op2 and Op3 then put result into Op1
    [Opcode.OR  ]: [[SET, GET, GET], (s) => {s.a = s.b | s.c}],
    // Bitwise NOT of Op2 then put result into Op1
    [Opcode.NOT ]: [[SET, GET     ], (s) => {s.a = ~s.b}],
    // Bitwise XNOR Op2 and Op3 then put result into Op1
    [Opcode.XNOR]: [[SET, GET, GET], (s) => {s.a = ~(s.b ^ s.c)}],
    // Bitwise XOR Op2 and Op3 then put result into Op1
    [Opcode.XOR ]: [[SET, GET, GET], (s) => {s.a = s.b ^ s.c}],
    // Bitwise NAND Op2 and Op3 then put result into Op1
    [Opcode.NAND]: [[SET, GET, GET], (s) => {s.a = ~(s.b & s.c)}],
    // Branch to address specified by Op1 if Op2 is less than Op3
    [Opcode.BRL ]: [[GET, GET, GET], (s) => {if (s.b < s.c) s.pc = s.a}],
    [Opcode.SBRL ]: [[GET, GET, GET], (s) => {if (s.sb < s.sc) s.pc = s.a}],
    // Branch to address specified by Op1 if Op2 is more than Op3
    [Opcode.BRG ]: [[GET, GET, GET], (s) => {if (s.b > s.c) s.pc = s.a}],
    [Opcode.SBRG ]: [[GET, GET, GET], (s) => {if (s.sb > s.sc) s.pc = s.sa}],
    // Branch to address specified by Op1 if Op2 is equal to Op3
    [Opcode.BRE ]: [[GET, GET, GET], (s) => {if (s.b === s.c) s.pc = s.a}],
    // Branch to address specified by Op1 if Op2 is not equal to Op3
    [Opcode.BNE ]: [[GET, GET, GET], (s) => {if (s.b !== s.c) s.pc = s.a}],
    // Branch to address specified by Op1 if Op2 is Odd (AKA the lowest bit is active)
    [Opcode.BOD ]: [[GET, GET     ], (s) => {if (s.b & 1) s.pc = s.a}],
    // Branch to address specified by Op1 if Op2 is Even (AKA the lowest bit is not active)
    [Opcode.BEV ]: [[GET, GET     ], (s) => {if (!(s.b & 1)) s.pc = s.a}],
    // Branch to address specified by Op1 if Op2 is less than or equal to Op3
    [Opcode.BLE ]: [[GET, GET, GET], (s) => {if (s.b <= s.c) s.pc = s.a}],
    [Opcode.SBLE ]: [[GET, GET, GET], (s) => {if (s.sb <= s.sc) s.pc = s.a}],
    // Branch to address specified by Op1 if Op2 equal to 0
    [Opcode.BRZ ]: [[GET, GET     ], (s) => {if (s.b === 0) s.pc = s.a}],
    // Branch to address specified by Op1 if Op2 is not equal to 0
    [Opcode.BNZ ]: [[GET, GET     ], (s) => {if (s.b !== 0) s.pc = s.a}],
    // Branch to address specified by Op1 if the result of the previous instruction is negative (AKA the upper most bit is active)
    [Opcode.BRN ]: [[GET, GET     ], (s) => {if (s.b & s.sign_bit) s.pc = s.a}],
    // Branch to address specified by Op1 if the result of the previous instruction is positive (AKA the upper most bit is not active)
    [Opcode.BRP ]: [[GET, GET     ], (s) => {if (!(s.b & s.sign_bit)) s.pc = s.a}],
    // Push Op1 onto the value stack
    [Opcode.PSH ]: [[GET          ], (s) => {s.push(s.a)}],
    // Pop from the value stack into Op1
    [Opcode.POP ]: [[SET          ], (s) => {s.a = s.pop()}],
    // Pushes the address of the next instruction onto the stack then branches to Op1
    [Opcode.CAL ]: [[GET          ], (s) => {s.push(s.pc); s.pc = s.a}],
    // Pops from the stack, then branches to that value
    [Opcode.RET ]: [[             ], (s) => {s.pc = s.pop()}],
    // Stop Execution emediately after opcode is read
    [Opcode.HLT ]: [[             ],() => true],
    // Copies the value located at the RAM location pointed to by Op2 into the RAM position pointed to by Op1.
    [Opcode.CPY ]: [[SAM, GAM     ], (s) => s.m_set(s.a, s.m_get(s.b))],
    // Branch to Op1 if Op2 + Op3 gives a carry out
    [Opcode.BRC ]: [[GET, GET, GET], (s) => {if (s.b + s.c > s.max_value) s.pc = s.a}],
    // Branch to Op1 if Op2 + Op3 does not give a carry out
    [Opcode.BNC ]: [[GET, GET, GET], (s) => {if (s.b + s.c <= s.max_value) s.pc = s.a}],
    // Take the absolute value of op2 and put it in op 1
    [Opcode.ABS]: [[SET, GET], (s) => {s.sa = Math.abs(s.sb)}],

    //----- Complex Instructions
    // Multiply Op2 by Op3 then put the lower half of the answer into Op1
    [Opcode.MLT  ]: [[SET, GET, GET], (s) => {s.a = Math.imul(s.b, s.c);}],
    // Unsigned division of Op2 by Op3 then put answer into Op1
    [Opcode.DIV  ]: [[SET, GET, GET], (s) => {s.a = s.c !== 0 ? s.b / s.c : s.max_value}],
    [Opcode.SDIV  ]: [[SET, GET, GET], (s) => {s.a = s.sb / s.sc}],
    // Unsigned modulus of Op2 by Op3 then put answer into Op1
    [Opcode.MOD  ]: [[SET, GET, GET], (s) => {s.a = s.b % s.c}],
    // Right shift Op2, Op3 times then put result into Op1
    [Opcode.BSR  ]: [[SET, GET, GET], (s) => {s.a = s.b >>> s.c}],
    // Left shift Op2, Op3 times then put result into Op1
    [Opcode.BSL  ]: [[SET, GET, GET], (s) => {s.a = s.b << s.c}],
    // Signed right shift Op2 once then put result into Op1
    [Opcode.SRS  ]: [[SET, GET     ], (s) => {s.a = s.sb >> 1}],
    // Signed right shift Op2, Op3 times then put result into Op1
    [Opcode.BSS  ]: [[SET, GET, GET], (s) => {s.a = s.sb >> s.c}],
    // If Op2 equals Op3 then set Op1 to all ones in binary else set Op1 to 0
    [Opcode.SETE ]: [[SET, GET, GET], (s) => {s.a = s.b === s.c ? s.max_value : 0}],
    // If Op2 is not equal to Op3 then set Op1 to all ones in binary else set Op1 to 0
    [Opcode.SETNE]: [[SET, GET, GET], (s) => {s.a = s.b !== s.c ? s.max_value : 0}],
    // If Op2 if more than Op3 then set Op1 to all ones in binary else set Op1 to 0
    [Opcode.SETG ]: [[SET, GET, GET], (s) => {s.a = s.b > s.c ? s.max_value : 0}],
    [Opcode.SSETG ]: [[SET, GET, GET], (s) => {s.a = s.sb > s.sc ? s.max_value : 0}],
    // If Op2 if less than Op3 then set Op1 to all ones in binary else set Op1 to 0
    [Opcode.SETL ]: [[SET, GET, GET], (s) => {s.a = s.b < s.c ? s.max_value : 0}],
    [Opcode.SSETL ]: [[SET, GET, GET], (s) => {s.a = s.sb < s.sc ? s.max_value : 0}],
    // If Op2 if greater than or equal to Op3 then set Op1 to all ones in binary else set Op1 to 0
    [Opcode.SETGE]: [[SET, GET, GET], (s) => {s.a = s.b >= s.c ? s.max_value : 0}],
    [Opcode.SSETGE]: [[SET, GET, GET], (s) => {s.a = s.sb >= s.sc ? s.max_value : 0}],
    // If Op2 if less than or equal to Op3 then set Op1 to all ones in binary else set Op1 to 0
    [Opcode.SETLE]: [[SET, GET, GET], (s) => {s.a = s.b <= s.c ? s.max_value : 0}],
    [Opcode.SSETLE]: [[SET, GET, GET], (s) => {s.a = s.sb <= s.sc ? s.max_value : 0}],
    // If Op2 + Op3 produces a carry out then set Op1 to all ones in binary, else set Op1 to 0
    [Opcode.SETC ]: [[SET, GET, GET], (s) => {s.a = s.b + s.c > s.max_value ? s.max_value : 0}],
    // If Op2 + Op3 does not produce a carry out then set Op1 to all ones in binary, else set Op1 to 0
    [Opcode.SETNC]: [[SET, GET, GET], (s) => {s.a = s.b + s.c <= s.max_value ? s.max_value : 0}],
    // Copy RAM value pointed to by (Op2 + Op3) into Op1. Where Op2 is the base pointer is Op3 is the offset.
    [Opcode.LLOD ]: [[SET, RAO, GAM], (s) => {s.a = s.m_get((s.b + s.c) & s.max_value)}],
    // Copy Op3 into RAM value pointed to by (Op1 + Op2). Where Op1 is the base pointer is Op2 is the offset.
    [Opcode.LSTR ]: [[RAO, SAM, GET], (s) => s.m_set((s.a + s.b) & s.max_value, s.c)],

    //----- IO Instructions
    [Opcode.IN  ]: [[SET, GET], (s) => s.in(s.b)],
    [Opcode.OUT ]: [[GET, GET], (s) => {s.out(s.a, s.b)}],

    //----- Assert Instructions
    [Opcode.__ASSERT]: [[GET], (s) => {if (!s.a) fail_assert(s, `value = ${s.a}`) }],
    [Opcode.__ASSERT0]: [[GET], (s) => {if (s.a) fail_assert(s, `value = ${s.a}`) }],
    [Opcode.__ASSERT_EQ]: [[GET, GET], (s) => {if (s.a !== s.b) fail_assert(s, `left = ${s.a}, right = ${s.b}`)}],
    [Opcode.__ASSERT_NEQ]: [[GET, GET], (s) => {if (s.a === s.b) fail_assert(s, `left = ${s.a}, right = ${s.b}`)}],
    
    //----- Experimental Instructions
    [Opcode.UMLT]: [[SET, GET, GET], (s) => {s.a = (s.b * s.c) / (2 ** s._bits);}],
    [Opcode.SUMLT]: [[SET, GET, GET], (s) => {s.sa = Math.floor((s.sb * s.sc) / (2 ** s._bits));}],

    //----- Iris Instructions
    [Opcode.HCAL]: [[GET], (s) => {
        if (s.csp >= s.call_stack_cap) {
            throw new Error("call stack overflow");
        }
        s.call_stack[s.csp++] = s.pc;
        s.pc = s.a;
    }],
    [Opcode.HRET]: [[], (s) => {
        if (s.csp <= 0) {
            throw new Error("call stack underflow")
        }
        s.pc = s.call_stack[--s.csp];
    }],
    [Opcode.HSAV]: [[], (s) => {s.save_reg()}],
    [Opcode.HRSR]: [[], (s) => {s.restore_reg()}],
    [Opcode.HPSH]: [[GET], (s) => {
        if (s.dsp >= s.data_stack_cap) {
            throw new Error("data stack overflow");
        }
        s.data_stack[s.dsp++] = s.a;
    }],
    [Opcode.HPOP]: [[SET], (s) => {
        if (s.dsp <= 0) {
            throw new Error("data stack underflow")
        }
        s.a = s.data_stack[--s.dsp];
    }],

    [Opcode.ITOF]: [[SET, GET], (s) => {
        s.a = s.f16_encode(s.sb)
    }],
    [Opcode.FTOI]: [[SET, GET], (s) => {
        s.a = s.f16_decode(s.b)
    }],
    [Opcode.FADD]: [[SET, GET, GET], (s) => {
        s.a = s.f16_encode(s.f16_decode(s.b) + s.f16_decode(s.c));
    }],
    [Opcode.FMLT]: [[SET, GET, GET], (s) => {
        s.a = s.f16_encode(s.f16_decode(s.b) * s.f16_decode(s.c));
    }],
    [Opcode.FDIV]: [[SET, GET, GET], (s) => {
        s.a = s.f16_encode(s.f16_decode(s.b) / s.f16_decode(s.c));
    }],
    [Opcode.FSUB]: [[SET, GET, GET], (s) => {
        s.a = s.f16_encode(s.f16_decode(s.b) - s.f16_decode(s.c));
    }],
    [Opcode.FABS]: [[SET, GET], (s) => {
        s.a = s.f16_encode(Math.abs(s.f16_decode(s.b)));
    }],
    [Opcode.FSQRT]: [[SET, GET], (s) => {
        s.a = s.f16_encode(Math.sqrt(s.f16_decode(s.b)));
    }],
};


export const inst_fns: Record<Opcode, Instruction_Callback> 
    = object_map(Opcodes_operants, (key, value)=>{
        if (value === undefined){throw new Error("instruction definition undefined");}
        return [key, value?.[1]];
    }, []);

export const Opcodes_operant_lengths: Record<Opcode, number> 
    = object_map(Opcodes_operants, (key, value) => {
        if (value === undefined){throw new Error("instruction definition undefined");}
        return [key, value[0].length];
    }, []);


function fail_assert(ctx: Instruction_Ctx, msg: string){
    const message = `Assertion failed: ${msg}`;
    ctx.warn(message);
}
