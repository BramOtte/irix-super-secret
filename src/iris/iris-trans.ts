import { Opcode, Operant_Prim } from "../emulator/instructions.js";

interface Context {
    a: number, ap: Operant_Prim,
    b: number, bp: Operant_Prim,
    c: number, cp: Operant_Prim,
    
}

export const iris_translations: {[K in Opcode]?: (s: Context) => void} = {
    [Opcode.ADD]: s => {}
};