import { Step_Result } from "../IEmu";
import { Debug_Info, Program } from "../compiler";
import { Opcode, Operant_Prim, Register, URCL_Header, register_count } from "../instructions";
import { Export_Type, Section_Type, WASM_Opcode, WASM_Type, magic, version } from "./wasm";
import { WASM_Writer } from "./wasm_writer";

export interface WASM_Exports {
    run(): number,
}

export type WASM_Imports = WebAssembly.Imports & {
    env: {
        in(port: number, pc: number): number,
        out(port: number, value: number): void;
        memory: WebAssembly.Memory
    }
}

const arg_len = 0;

enum Locals {
    Sign, Exp, Frac,
    Registers,
}

interface Buffers {
    wasm_memory: WebAssembly.Memory,
    registers: WordArray,
    memory: WordArray,
    call_stack: WordArray,
    data_stack: WordArray,
}

export function urcl2wasm(program: Program, buffer: Buffers, debug?: Debug_Info): Uint8Array {
    const s = new Context(program, buffer, debug);
    s.bytes(magic).u32(version)
        .u8(Section_Type.type)
            .size_start() // section size
            .uvar(3)    // type count
                .u8(0x60)   // function
                    .uvar(0)    // argument count
                    .uvar(1)    // result count
                        .uvar(WASM_Type.i32)
                .u8(0x60)   // function
                    .uvar(2)    // argument count
                        .uvar(WASM_Type.i32)
                        .uvar(WASM_Type.i32)
                    .uvar(1)    // result count
                        .uvar(WASM_Type.i32)
                .u8(0x60)   // function
                    .uvar(2)    // argument count
                        .uvar(WASM_Type.i32)
                        .uvar(WASM_Type.i32)
                    .uvar(0)    // result count
            .size_end()
        .u8(Section_Type.import)
            .size_start()
            .uvar(3)
                .str("env")
                    .str("in")
                    .u8(Export_Type.func)
                    .uvar(1)
                .str("env")
                    .str("out")
                    .u8(Export_Type.func)
                    .uvar(2)
                .str("env")
                    .str("memory")
                    .u8(Export_Type.memory)
                    .uvar(0).uvar(s.memory_blocks)
            .size_end()
        .u8(Section_Type.function)
            .size_start()   // section size
            .uvar(1)        // function count
                .uvar(0)    // function type
            .size_end()
        // .u8(Section_Type.memory)
        //     .size_start()
        //     .u8(1).u8(0)
        //     .uvar(s.memory_blocks)
        //     .size_end()
        .u8(Section_Type.export)
            .size_start()
            .uvar(1)        // export count
                .str("run")             // export name
                .u8(Export_Type.func)   // export type
                .uvar(2)                // export value
            .size_end()
        .u8(Section_Type.code)
            .size_start()
            .uvar(1)    // function count
                generate_run(s);
            s.size_end();

    return s.finish();
}

function generate_run(s: Context) {
    s.size_start();  // function length
    
    const program_length = s.program.opcodes.length;
    const min_reg = s.program.headers[URCL_Header.MINREG].value;
    s.uvar(1) // local count
        .uvar(min_reg + register_count + Locals.Registers - arg_len) // local repeat
        .u8(WASM_Type.i32);             // local type
    
    s.load_regfile();    

    s.u8(WASM_Opcode.loop).uvar(64);
    for (let i = 0; i < program_length; ++i) {
        s.u8(WASM_Opcode.block).uvar(64);
    }
    s.u8(WASM_Opcode.block).uvar(64);
    s._read_reg(Register.PC);
    s.u8(WASM_Opcode.br_table)
        .uvar(program_length);
    for (let i = program_length; i >= 1; --i) {
        s.uvar(program_length - i)
    }
    s.uvar(program_length);
    s.u8(WASM_Opcode.end);
    for (s.pc = 0; s.pc < program_length; ++s.pc) {
        const opcode = s.program.opcodes[s.pc]
        const fn = stuff[opcode];
        if (fn === undefined) {
            const msg = `WASM backend does not implement opcode ${opcode} ${Opcode[opcode]}`;
            console.error(msg);
            throw new Error(msg);
        }
        fn(s);
        s.u8(WASM_Opcode.end);
    }
    
    s.end();

    s.store_regfile();
    s.const(Step_Result.Halt);
    
    s.end();
    s.size_end()
}

const memoryback_registers = false;

class Context extends WASM_Writer {
    bits: number
    pc = 0;
    in_func = 0;
    out_func = 1;

    private load_opcode_u: number;
    private load_opcode_s: number;
    private store_opcode: number;
    size_shift: number;
    private get should_mask() {
        return this.bits < 32;
    }
    private get max() {
        return 0xffffffff >>> (32 - this.bits);
    }
    private get max_s () {
        return (1 << (this.bits - 1)) - 1
    }
    private get sign_bit() {
        return (1 << (this.bits - 1));
    }
    private get n_max_s() {
        return ~this.max_s
    }
    private get sign_mult() {
        return 0xffffff << this.bits;
    }
    private allign: number;
    memory_blocks: number;
    memory_size: number;
    min_reg: number;
    min_memory: number;

    call_stack_start: number;
    data_stack_start: number;

    
    private get depth() {
        return this.program.opcodes.length - this.pc;
    }

    constructor(
        public program: Program,
        buffers: Buffers,
        public debug?: Debug_Info,
    ) {
        super();

        this.bits = this.program.headers[URCL_Header.BITS].value;

        const min_reg = this.min_reg = program.headers[URCL_Header.MINREG].value;
        const min_heap = program.headers[URCL_Header.MINHEAP].value;
        const min_stack = program.headers[URCL_Header.MINSTACK].value;
        const min_memory = this.min_memory = min_heap + min_stack + program.data.length;

        const min_wasm_memory = buffers.wasm_memory.buffer.byteLength;
        const memory_block_size = 1024 * 64;
        this.memory_blocks = Math.ceil(min_wasm_memory / memory_block_size);

        this.memory_size = this.memory_blocks * memory_block_size;
        this.call_stack_start = buffers.call_stack.byteOffset;
        this.data_stack_start = buffers.data_stack.byteOffset;


        
        if (this.bits == 8) {
            this.size_shift = 0;
            this.allign = 0;
            this.load_opcode_u = WASM_Opcode.i32_load8_u;
            this.load_opcode_s = WASM_Opcode.i32_load8_s;
            this.store_opcode = WASM_Opcode.i32_store8;
        } else if (this.bits == 16) {
            this.allign = 1;
            this.load_opcode_u = WASM_Opcode.i32_load16_u;
            this.load_opcode_s = WASM_Opcode.i32_load16_s;
            this.store_opcode = WASM_Opcode.i32_store16;
            this.size_shift = 1;
        } else if (this.bits == 32) {
            this.allign = 2;
            this.load_opcode_u = WASM_Opcode.i32_load;
            this.load_opcode_s = WASM_Opcode.i32_load;
            
            this.store_opcode = WASM_Opcode.i32_store;
            this.size_shift = 2;
        } else {
            throw new Error(`bits ${this.bits} > 32`);
        }
        this.allign = 0;
    }

    block(type = 64) {
        return this.u8(WASM_Opcode.block).uvar(type);
    }

    load_reg(i: number) {
        return this.const((i + this.min_memory) << this.size_shift).load_u()._write_reg(i);
    }
    store_reg(i: number) {
        return this.const((i + this.min_memory) << this.size_shift).read_reg(i).store();
    }

    load_regfile() {
        for (let i = 0; i < this.min_reg + register_count; i++) {
            this.load_reg(i);
        }
        return this;
    }

    store_regfile(){
        for (let i = 0; i < this.min_reg + register_count; i++) {
            this.store_reg(i);
        }
        return this;
    }
    
    arg(index: number, signed: boolean) {
        const prim = this.program.operant_prims[this.pc][index];
        const value = this.program.operant_values[this.pc][index];
        if (prim === Operant_Prim.Reg) {
            if (signed) {
                this.read_reg_s(value);
            } else {
                this.read_reg(value);
            }
        } else {
            this.const(value);
            if (signed && value > this.max_s) {
                this.sign_extend()
            }
        }

        return this;
    }
    read_reg_s(index: number) {
        return this.read_reg(index).sign_extend();
    }
    read_reg(index: number) {
        if (index === Register.PC) {
            return this.const(this.pc);
        }

        return this._read_reg(index);
    }
    _read_reg(index: number) {
        return this.u8(WASM_Opcode.local_get).uvar(index + Locals.Registers);
    }

    write_reg(index: number) {
        this._write_reg(index);
        // TODO: check for if statements or post write code
        if (index === Register.PC) {
            this.u8(WASM_Opcode.br).uvar(this.depth)
        }
        return this;
    }

    _write_reg(index: number) {
        this.mask_u().u8(WASM_Opcode.local_set).uvar(index + Locals.Registers);
        if (memoryback_registers) {
            this.store_reg(index);
        }
        return this;
    }
    tee_reg(index: number) {
        return this.mask_u().u8(WASM_Opcode.local_tee).uvar(index + Locals.Registers);
    }
    tee_local(index: number) {
        return this.u8(WASM_Opcode.local_tee).uvar(index);
    }

    set_local(index: number) {
        return this.u8(WASM_Opcode.local_set).uvar(index);
    }
    get_local(index: number) {
        return this.u8(WASM_Opcode.local_get).uvar(index);
    }

    sign_extend() {
        if (this.should_mask) {
            if (this.bits == 16) {
                this.u8(WASM_Opcode.i32_extend16_s)
            } else if (this.bits == 8) {
                this.u8(WASM_Opcode.i32_extend16_s)
            } else {
                this.const(this.max).u8(WASM_Opcode.i32_and)
                    .const(~this.max).u8(WASM_Opcode.i32_or)
                    .const(this.sign_bit).u8(WASM_Opcode.i32_add)
                    .const(~this.max_s).u8(WASM_Opcode.i32_xor);
            }
        }
        return this;
    }

    mask_u() {
        if (this.should_mask) {
            this.const(this.max)
                .u8(WASM_Opcode.i32_and);
        }
        return this;
    }

    write_arg(index: number) {
        const prim = this.program.operant_prims[this.pc][index];
        const value = this.program.operant_values[this.pc][index];
        if (prim == Operant_Prim.Reg) {
            this.write_reg(value)
        } else {
            this.u8(WASM_Opcode.drop)
        }
        return this;     
    }
    address() {
        if (this.size_shift) {
            this.const(this.size_shift).u8(WASM_Opcode.i32_shl);
        }
        return this;
    }
    const(value: number) {
        return this.u8(WASM_Opcode.i32_const)
            .ivar(value);
    }
    const64(value: number) {
        return this.u8(this.bits <= 16 ? WASM_Opcode.i32_const : WASM_Opcode.i64_const)
            .ivar(value);
    }
    // takes address then value
    store() {
        return this.mask_u().u8(this.store_opcode).u8(this.allign).uvar(0);
    }
    load_u() {
        return this.u8(this.load_opcode_u).uvar(this.allign).uvar(0);
    }
    load_s() {
        return this.u8(this.load_opcode_s).uvar(this.allign).uvar(0);
    }

    branch() {
        return this.if().a().jump(1).end();
    }
    bbranch(cond: WASM_Opcode) {
        return this.b().c().u8(cond).branch();
    }
    sbbranch(cond: WASM_Opcode) {
        return this.sb().sc().u8(cond).branch();
    }
    sbranch(cond: WASM_Opcode) {
        return this.sb().sc().u8(cond).branch();
    }
    if() {
        return this.u8(WASM_Opcode.if).uvar(64);
    }
    else() {
        return this.u8(WASM_Opcode.else);
    }
    end(){
        return this.u8(WASM_Opcode.end);
    }

    extend_u() {
        if (this.bits > 16) {
            this.u8(WASM_Opcode.i64_extend_i32_u);
        }

        return this;
    }
    extend_s() {
        if (this.bits > 16) {
            this.u8(WASM_Opcode.i64_extend_i32_s);
        }

        return this;
    }
    wrap() {
        if (this.bits > 16) {
            this.u8(WASM_Opcode.i32_wrap_i64);
        }
        return this;
    }

    break_ret() {
        return this.store_regfile().u8(WASM_Opcode.return);
    }
    jump(offset: number) {
        return this._write_reg(Register.PC).u8(WASM_Opcode.br).uvar(this.depth + offset);
    }
    bin(code: WASM_Opcode) {
        return this.b().c().u8(code).wa();
    }
    sbin(code: WASM_Opcode) {
        return this.sb().sc().u8(code).wa();
    }
    
    wa(){return this.write_arg(0);}
    a() {return this.arg(0, false);}
    sa() {return this.arg(0, true);}

    b() {return this.arg(1, false);}
    sb() {return this.arg(1, true);}
    
    c() {return this.arg(2, false);}
    sc() {return this.arg(2, true);}

}

const stuff: Record<Opcode, undefined | ((s: Context) => void)> = {
    [Opcode.ADD]: s => {s.bin(WASM_Opcode.i32_add)},
    [Opcode.RSH]: s => {s.b().const(1).u8(WASM_Opcode.i32_shr_u).wa()},
    [Opcode.LOD]: s => {s.b().address().load_u().wa()},
    [Opcode.STR]: s => {s.a().address().b().store()},
    [Opcode.BGE]: s => {s.bbranch(WASM_Opcode.i32_ge_u)},
    [Opcode.NOR]: s => {s.b().c().u8(WASM_Opcode.i32_or).const(-1).u8(WASM_Opcode.i32_xor).wa()},
    [Opcode.IMM]: s => {s.b().wa()},
    [Opcode.SUB]: s => {s.bin(WASM_Opcode.i32_sub)},
    [Opcode.JMP]: s => {s.a().jump(0)},
    [Opcode.MOV]: s => {s.b().wa()},
    [Opcode.NOP]: s => {},
    [Opcode.LSH]: s => {s.b().const(1).u8(WASM_Opcode.i32_shl).wa()},
    [Opcode.INC]: s => {s.b().const(1).u8(WASM_Opcode.i32_add).wa()},
    [Opcode.DEC]: s => {s.b().const(1).u8(WASM_Opcode.i32_sub).wa()},
    [Opcode.NEG]: s => {s.const(0).b().u8(WASM_Opcode.i32_sub).wa()},
    [Opcode.AND]: s => {s.bin(WASM_Opcode.i32_and)},
    [Opcode.OR]: s => {s.bin(WASM_Opcode.i32_or)},
    [Opcode.NOT]: s => {s.b().const(-1).u8(WASM_Opcode.i32_xor).wa()},
    [Opcode.XNOR]: s => {s.b().c().u8(WASM_Opcode.i32_xor).const(-1).u8(WASM_Opcode.i32_xor).wa()},
    [Opcode.XOR]: s => {s.bin(WASM_Opcode.i32_xor)},
    [Opcode.NAND]: s => {s.b().c().u8(WASM_Opcode.i32_and).const(-1).u8(WASM_Opcode.i32_xor).wa()},
    [Opcode.BRL]: s => {s.bbranch(WASM_Opcode.i32_lt_u)},
    [Opcode.BRG]: s => {s.bbranch(WASM_Opcode.i32_gt_u)},
    [Opcode.BRE]: s => {s.bbranch(WASM_Opcode.i32_eq)},
    [Opcode.BNE]: s => {s.bbranch(WASM_Opcode.i32_ne)},
    [Opcode.BOD]: s => {s.b().const(1).u8(WASM_Opcode.i32_and).const(0).u8(WASM_Opcode.i32_ne).branch()},
    [Opcode.BEV]: s => {s.b().const(1).u8(WASM_Opcode.i32_and).u8(WASM_Opcode.i32_eqz).branch()},
    [Opcode.BLE]: s => {s.bbranch(WASM_Opcode.i32_le_u)},
    [Opcode.BRZ]: s => {s.b().u8(WASM_Opcode.i32_eqz).branch()},
    [Opcode.BNZ]: s => {s.b().const(0).u8(WASM_Opcode.i32_ne).branch()},
    [Opcode.BRN]: s => {s.sb().const(0).u8(WASM_Opcode.i32_lt_s).branch()},
    [Opcode.BRP]: s => {s.sb().const(0).u8(WASM_Opcode.i32_ge_s).branch()},
    [Opcode.PSH]: s => {
        s.read_reg(Register.SP).const(1).u8(WASM_Opcode.i32_sub).tee_reg(Register.SP)
            .address().a().store()
    },
    [Opcode.POP]: s => {
        s.read_reg(Register.SP).address().load_u().wa()
            .read_reg(Register.SP).const(1).u8(WASM_Opcode.i32_add)._write_reg(Register.SP)
    },
    [Opcode.CAL]: s => {
        s.read_reg(Register.SP).const(1).u8(WASM_Opcode.i32_sub).tee_reg(Register.SP).address().const(s.pc+1).store()
        s.a().jump(0)
    },
    [Opcode.RET]: s => {
        s.read_reg(Register.SP).address().load_u()
        s.read_reg(Register.SP).const(1).u8(WASM_Opcode.i32_add)._write_reg(Register.SP)
        s.jump(0);
    },
    [Opcode.HLT]: s => {s.const(Step_Result.Halt).break_ret()},
    [Opcode.CPY]: s => {s.a().address().b().address().load_u().store()},
    [Opcode.BRC]: s => {s.b().c().u8(WASM_Opcode.i32_add).mask_u().b().u8(WASM_Opcode.i32_lt_u).branch()},
    [Opcode.BNC]: s => {s.b().c().u8(WASM_Opcode.i32_add).mask_u().b().u8(WASM_Opcode.i32_ge_u).branch()},
    [Opcode.MLT]: s => {s.bin(WASM_Opcode.i32_mul)},
    [Opcode.DIV]: s => {s.bin(WASM_Opcode.i32_div_u)},
    [Opcode.MOD]: s => {s.bin(WASM_Opcode.i32_rem_u)},
    [Opcode.BSR]: s => {s.bin(WASM_Opcode.i32_shr_u)},
    [Opcode.BSL]: s => {s.bin(WASM_Opcode.i32_shl)},
    [Opcode.SRS]: s => {s.sb().const(1).u8(WASM_Opcode.i32_shr_s).wa()},
    [Opcode.BSS]: s => {s.sbin(WASM_Opcode.i32_shr_s)},
    [Opcode.SETE]: s => {s.const(-1).const(0).b().c()   .u8(WASM_Opcode.i32_eq)     .u8(WASM_Opcode.select).wa()},
    [Opcode.SETNE]: s => {s.const(-1).const(0).b().c()  .u8(WASM_Opcode.i32_ne)     .u8(WASM_Opcode.select).wa()},
    [Opcode.SETG]: s => {s.const(-1).const(0).b().c()   .u8(WASM_Opcode.i32_gt_u)   .u8(WASM_Opcode.select).wa()},
    [Opcode.SETL]: s => {s.const(-1).const(0).b().c()   .u8(WASM_Opcode.i32_lt_u)   .u8(WASM_Opcode.select).wa()},
    [Opcode.SETGE]: s => {s.const(-1).const(0).b().c()  .u8(WASM_Opcode.i32_ge_u)   .u8(WASM_Opcode.select).wa()},
    [Opcode.SETLE]: s => {s.const(-1).const(0).b().c()  .u8(WASM_Opcode.i32_le_u)   .u8(WASM_Opcode.select).wa()},
    [Opcode.SETC]: s => {s.const(-1).const(0).b().c()   .u8(WASM_Opcode.i32_add).mask_u().b().u8(WASM_Opcode.i32_lt_u)   .u8(WASM_Opcode.select).wa()},
    [Opcode.SETNC]: s => {s.const(-1).const(0).b().c()   .u8(WASM_Opcode.i32_add).mask_u().b().u8(WASM_Opcode.i32_ge_u)   .u8(WASM_Opcode.select).wa()},
    [Opcode.LLOD]: s => {s.b().c().u8(WASM_Opcode.i32_add).address().load_u().wa()},
    [Opcode.LSTR]: s => {s.a().b().u8(WASM_Opcode.i32_add).address().c().store()},
    [Opcode.IN]: s => {
        s.b().const(s.pc).u8(WASM_Opcode.call).uvar(s.in_func)
            .const(Step_Result.Input).u8(WASM_Opcode.i32_eq).if()
                .const(Step_Result.Input)
                .break_ret()
            .end();
        if (s.program.operant_prims[s.pc][0] === Operant_Prim.Reg) {
            s.load_reg(s.program.operant_values[s.pc][0]);
        }
    },
    [Opcode.OUT]: s => {s.a().b().u8(WASM_Opcode.call).uvar(s.out_func)},
    [Opcode.SDIV]: s => {s.sbin(WASM_Opcode.i32_div_s)},
    [Opcode.SBRL]: s => {s.sbbranch(WASM_Opcode.i32_lt_s)},
    [Opcode.SBRG]: s => {s.sbbranch(WASM_Opcode.i32_gt_s)},
    [Opcode.SBLE]: s => {s.sbbranch(WASM_Opcode.i32_le_s)},
    [Opcode.SBGE]: s => {s.sbbranch(WASM_Opcode.i32_ge_s)},
    [Opcode.SSETL]: s => {s.const(-1).const(0).sb().sc()   .u8(WASM_Opcode.i32_lt_s)     .u8(WASM_Opcode.select).wa()},
    [Opcode.SSETG]: s => {s.const(-1).const(0).sb().sc()   .u8(WASM_Opcode.i32_gt_s)     .u8(WASM_Opcode.select).wa()},
    [Opcode.SSETLE]: s => {s.const(-1).const(0).sb().sc()   .u8(WASM_Opcode.i32_le_s)     .u8(WASM_Opcode.select).wa()},
    [Opcode.SSETGE]: s => {s.const(-1).const(0).sb().sc()   .u8(WASM_Opcode.i32_ge_s)     .u8(WASM_Opcode.select).wa()},
    [Opcode.ABS]: s => {s.const(0).b().u8(WASM_Opcode.i32_sub)  .b()   .b().const(0).u8(WASM_Opcode.i32_lt_s).u8(WASM_Opcode.select).wa()},
    [Opcode.__ASSERT]: s => {s.a().u8(WASM_Opcode.i32_eqz); panic_if(s)},
    [Opcode.__ASSERT0]: s => {s.a().const(0).u8(WASM_Opcode.i32_ne); panic_if(s)},
    [Opcode.__ASSERT_EQ]: s => {s.a().b().u8(WASM_Opcode.i32_ne); panic_if(s)},
    [Opcode.__ASSERT_NEQ]: s => {s.a().b().u8(WASM_Opcode.i32_eq); panic_if(s)},
    [Opcode.UMLT]: s => {
        s.b().extend_u().c().extend_u().u8(s.bits <= 16 ? WASM_Opcode.i32_mul : WASM_Opcode.i64_mul)
            .const64(s.bits).u8(s.bits <= 16 ? WASM_Opcode.i32_shr_u : WASM_Opcode.i64_shr_u)
            .wrap().wa();
    },
    [Opcode.SUMLT]: s => {
        s.sb().extend_s().sc().extend_s().u8(s.bits <= 16 ? WASM_Opcode.i32_mul : WASM_Opcode.i64_mul)
            .const64(s.bits).u8(s.bits <= 16 ? WASM_Opcode.i32_shr_s : WASM_Opcode.i64_shr_s)
            .wrap().wa();
    },
    [Opcode.HCAL]: s => {
        s.read_reg(Register._CSP)
            .address().const(s.call_stack_start).u8(WASM_Opcode.i32_add)
            .const(s.pc + 1)
            .store();
        s.read_reg(Register._CSP).const(1).u8(WASM_Opcode.i32_add).write_reg(Register._CSP);
        s.a().jump(0);
    },
    [Opcode.HRET]: s => {
        s.read_reg(Register._CSP).const(1).u8(WASM_Opcode.i32_sub);
        s.tee_reg(Register._CSP)
            .address().const(s.call_stack_start).u8(WASM_Opcode.i32_add)
            .load_u().jump(0);
    },
    [Opcode.HSAV]: undefined,
    [Opcode.HRSR]: undefined,
    [Opcode.HPSH]: s => {
        s.read_reg(Register._DSP)
            .address().const(s.data_stack_start).u8(WASM_Opcode.i32_add)
            .a()
            .store();
        s.read_reg(Register._DSP).const(1).u8(WASM_Opcode.i32_add).write_reg(Register._DSP);
    },
    [Opcode.HPOP]: s => {
        s.read_reg(Register._DSP).const(1).u8(WASM_Opcode.i32_sub);
        s.tee_reg(Register._DSP)
            .address().const(s.data_stack_start).u8(WASM_Opcode.i32_add)
            .load_u().wa();
    },
    [Opcode.FTOI]: s => {
        s.b()
        f16_to_f32(s);
        s.u8(WASM_Opcode.i32_trunc_f32_s)
        s.wa()
    },
    [Opcode.ITOF]: s => {
        s.sb().u8(WASM_Opcode.f32_convert_i32_s)
        f32_to_f16(s);
        s.wa()
    },
    [Opcode.FMLT]: s => {
        s.b(); f16_to_f32(s);
        s.c(); f16_to_f32(s);
        s.u8(WASM_Opcode.f32_mul);
        f32_to_f16(s)
        s.wa()
    },
    [Opcode.FDIV]: s => {
        s.b(); f16_to_f32(s);
        s.c(); f16_to_f32(s);
        s.u8(WASM_Opcode.f32_div);
        f32_to_f16(s)
        s.wa()
    },
    [Opcode.FADD]: s => {
        s.b(); f16_to_f32(s);
        s.c(); f16_to_f32(s);
        s.u8(WASM_Opcode.f32_add);
        f32_to_f16(s)
        s.wa()
    },
    [Opcode.FSUB]: s => {
        s.b(); f16_to_f32(s);
        s.c(); f16_to_f32(s);
        s.u8(WASM_Opcode.f32_sub);
        f32_to_f16(s)
        s.wa()
    },
    [Opcode.FABS]: s => {
        s.b();
        f16_to_f32(s);
        s.u8(WASM_Opcode.f32_abs);
        f32_to_f16(s)
        s.wa()
    },
    [Opcode.FSQRT]: s => {
        s.b(); f16_to_f32(s);
        s.u8(WASM_Opcode.f32_sqrt);
        f32_to_f16(s)
        s.wa()
    },
};

function panic_if(s: Context) {
    return s.if().const(s.pc)._write_reg(Register.PC).const(420).const(s.pc).u8(WASM_Opcode.call).uvar(s.out_func).a().u8(WASM_Opcode.return).end()
}


const f16_bias = 16;
const f16_exp_bits = 5;
const f16_exp_max = (1 << f16_exp_bits) - 1;
const f16_frac_bits = 10;
const f16_frac_max = (1 << f16_frac_bits) - 1;
const f16_max = 0x7FFF;

const f32_bias = 127;
const f32_exp_bits = 8;
const f32_exp_max = (1 << f32_exp_bits) - 1;
const f32_frac_bits = 23;
const f32_frac_max = (1 << f32_frac_bits) - 1;

function f16_to_f32(s: Context) {
    s.sign_extend()
    s.tee_local(Locals.Frac)

    // get sign
    .const(15)
        .u8(WASM_Opcode.i32_shr_s)
        .set_local(Locals.Sign)
    // invert if sign
    .get_local(Locals.Sign)
        .get_local(Locals.Frac)
        .u8(WASM_Opcode.i32_xor)
        .set_local(Locals.Frac)
    // get exponent
    .get_local(Locals.Frac)
        .const(f16_frac_bits)
        .u8(WASM_Opcode.i32_shr_u)
        .const(f16_exp_max)
            .u8(WASM_Opcode.i32_and)
        .const(f32_bias - f16_bias)
            .u8(WASM_Opcode.i32_add)
        .const(f32_frac_bits)
            .u8(WASM_Opcode.i32_shl)
        .set_local(Locals.Exp)
    // get fraction
    .get_local(Locals.Frac)
        .const(f32_frac_bits - f16_frac_bits)
            .u8(WASM_Opcode.i32_shl)
        .const(f32_frac_max)
            .u8(WASM_Opcode.i32_and)
        .set_local(Locals.Frac)

    // or everything together
    .get_local(Locals.Frac)
    .get_local(Locals.Exp)
    .u8(WASM_Opcode.i32_or)
    .get_local(Locals.Sign)
        .const(31).u8(WASM_Opcode.i32_shl)
    .u8(WASM_Opcode.i32_or)

    // convert to f32
    .u8(WASM_Opcode.f32_reinterpret_i32)
}

function f32_to_f16(s: Context) {
    s.u8(WASM_Opcode.i32_reinterpret_f32)
    .set_local(Locals.Frac)

    s.block(WASM_Type.i32)
    // get sign
    s.get_local(Locals.Frac)
        .const(31)
        .u8(WASM_Opcode.i32_shr_s)
        .set_local(Locals.Sign)
    // get exponent
    .get_local(Locals.Frac)
        .const(f32_frac_bits)
        .u8(WASM_Opcode.i32_shr_u)
        .const(f32_exp_max)
            .u8(WASM_Opcode.i32_and)
        .const(f16_bias - f32_bias)
            .u8(WASM_Opcode.i32_add)
        .set_local(Locals.Exp)
    // return max if exponent is too large
    .get_local(Locals.Exp)
        .const(f16_exp_max)
        .u8(WASM_Opcode.i32_gt_s)
        .if()
            .const(f16_max)
            .get_local(Locals.Sign)
            .u8(WASM_Opcode.i32_xor)
            .u8(WASM_Opcode.br).uvar(1)
        .end()
    // return 0 if exponent is too small
    .get_local(Locals.Exp)
        .const(0)
        .u8(WASM_Opcode.i32_lt_s)
        .if()
            .const(0)
            .u8(WASM_Opcode.br).uvar(1)
        .end()
     
    // get fraction
    .get_local(Locals.Frac)
        .const(f32_frac_bits - f16_frac_bits)
        .u8(WASM_Opcode.i32_shr_u)
        .const(f16_frac_max)
        .u8(WASM_Opcode.i32_and)
        .set_local(Locals.Frac)

    // or together exponent and fraction
    .get_local(Locals.Frac)
        .get_local(Locals.Exp)
        .const(f16_frac_bits)
            .u8(WASM_Opcode.i32_shl)
        .u8(WASM_Opcode.i32_or)
    // invert if signed
    .get_local(Locals.Sign)
        .u8(WASM_Opcode.i32_xor)
    s.end()
}