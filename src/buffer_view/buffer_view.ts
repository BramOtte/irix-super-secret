import { Emulator } from "../emulator/emulator.js";
import { Register } from "../emulator/instructions.js";
import { bound, memoryToString } from "../emulator/util.js";
import { l } from "../l.js";

export class BufferView extends HTMLElement {
    content: HTMLElement;
    scroll_div: HTMLElement;
    char: HTMLElement;
    width: number = 16;

    emulator?: Emulator;

    constructor() {
        super();
        l(this as HTMLElement, {
            style: {whiteSpace: "pre", fontFamily: "monospace", position: "relative", overflow: "auto", display: "block"}
        }, this.content = l("div", {style: {position: "absolute"}}),
            this.scroll_div = l("div"),
            this.char = l("div", {style: {position: "absolute", visibility: "hidden"}}, "a")
        );
        this.onscroll = this.update;
    
        const observer = new ResizeObserver(() => this.update());
        observer.observe(this);
    }
    
    
    public update(){
        if (this.emulator == undefined) {
            return
        }

        const memory = this.emulator.memory;

        const ch = this.char.clientHeight;
        const H = Math.ceil(memory.length / this.width);
        const height = H * ch;
        this.scroll_div.style.height = `${height}px`;
        


        const y = Math.floor(this.scrollTop/ch);
        const h = Math.ceil((this.clientHeight + 2)/ch);

        const sy = bound(y, 0, H), ey = bound(y+h, 0, H);
        this.content.style.top = `${sy*ch}px`;
    
        this.content.innerHTML = memoryToString(
            memory,
            sy * this.width, (ey - sy) * this.width,
            this.emulator._bits,
            [
                [this.emulator.program.data.length, "#132"],
                [this.emulator.heap_size, "#300"],
                [this.emulator.registers[Register.SP], "darkred"],
            ]
        );
    }

}

customElements.define("buffer-view", BufferView)