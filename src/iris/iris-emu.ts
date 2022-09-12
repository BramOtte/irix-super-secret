enum Op {
    ADD, SUB, NOR, OR, XOR, BSL, BSR, BSS,
    MLT, UMLT, DIV, MOD,
    BCD0, BCD1, BCD2, BCD3, BCD4,
    INC, NAND, AND, XNOR, LOD, STR,
    SETX, SETY, PRT,
    SETX1, SETY1, SETX2, SETY2, Line,
    CUT
}

enum Flag {
    None, CF, NCF, ZF, NZF, NE, PO, OD, EV, OV, GE, LT, TR, JMP, JMF, PSL
}

enum A {
    SP = 29, AI, HLT
}

enum B {
    SP = 29, BI, MP
}

enum C {
    SP = 29, MP, PC
}

declare const __: unique symbol;
type Inst = number & {__: "Inst"};

const prog_size = 128;
const mem_size = 128;

function opcode(inst: Inst): Op {
    return inst & 31;
}

function oc(inst: Inst): number | C {
    return (inst >>> 5) & 31;
}
function oa(inst: Inst): number | A {
    return (inst >>> 10) & 31;
}
function ob(inst: Inst): number | B {
    return (inst >>> 15) & 31;
}
function of(inst: Inst): Flag {
    return (inst >>> 20) & 15;
}

function inst(opcode: Op, c: number | C = 0, a: number | A = 0, b: number | B = 0, flag: Flag = Flag.None): Inst {
    return (opcode | (c << 5) | (a << 10) | (b << 15) | (flag << 20)) as Inst;
}

function sign_extend16(x: number): number {
    return (x << 16) >> 16; 
}

class Iris_Emu {
    program = new Uint32Array(prog_size * 2) as any as Record<number, Inst>;
    reg = new Uint16Array(32);
    mem = new Uint16Array(mem_size);
    pc = 0;
    sp = mem_size;

    step() {
        const inst = this.program[this.pc];
        const op = opcode(inst);
        const c = oc(inst);
        const a = oa(inst);
        const b = ob(inst);
        const f = of(inst);

        let av: number;
        switch (a) {
            case 0: av = 0; break;
            case A.AI: throw new Error("not implemented"); break;
            case A.HLT: throw new Error("not implemented"); break;
            default: av = this.reg[a];
        }
        let bv: number;
        switch (b) {
            case 0: bv = 0; break;
            case B.BI: throw new Error("not implemented"); break;
            case B.MP: throw new Error("not implemented"); break;
        }
        let cv: number;
        switch (op) {
            case Op.ADD: cv = a + b; break;
            case Op.SUB: cv = a - b; break;
        }
    }

}