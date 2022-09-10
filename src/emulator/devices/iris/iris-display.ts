import { l } from "../../../l";
import { IO_Port } from "../../instructions";
import { Device } from "../device";
import { Display } from "../display";
import { Gl_Display } from "../gl-display";

const tw = 4, th = 8, tile_count = 255;

export class Iris_Display implements Device {
    colors = new Uint32Array(tw*th * tile_count);
    masks = new Uint32Array(tw*th * tile_count);


    constructor(private display: Gl_Display) {
        this.colors.set([
            1, 1, 1, 1,
            1, 0 ,0, 1,
            1, 0, 0, 1,
            1, 0, 0, 1,
            1, 0, 0, 1,
            1, 0, 0, 1,
            1, 0, 0, 1,
            1, 1, 1, 1,
        ]);
        this.masks.set([
            1, 1, 1, 1,
            1, 1, 1, 1,
            1, 1, 1, 1,
            1, 1, 1, 1,
            1, 1, 1, 1,
            1, 1, 1, 1,
            1, 1, 1, 1,
            1, 1, 1, 1,
        ])

        const font = new Image();
        font.src = "src/emulator/devices/iris/iris-font.png";
        font.onload = e => {
            const canvas = document.createElement("canvas");
            canvas.width = font.width;
            canvas.height = font.height;
            document.body.appendChild(font);
            const ctx = canvas.getContext("2d");
            if (!ctx) {
                throw new Error("");
            }
            ctx.drawImage(font, 0, 0);
            const img = ctx.getImageData(0, 0, font.width, font.height);
            for (let y = 0, dest_i = 0; y < img.height; y += th) {
                for (let x = 0; x < img.width; x += tw) {
                    for (let ty = 0; ty < th; ty += 1) {
                        for (let tx = 0; tx < tw; tx += 1, dest_i += 1) {
                            const src_i = 4 * ((x + tx) + (y + ty) * img.width);
                            this.colors[dest_i] = img.data[src_i] + img.data[src_i + 1] + img.data[src_i + 2] < 128*3 ? 0xffffff : 0;
                            this.masks[dest_i] = img.data[src_i + 3] >= 128 ? 0xffffff : 0;
                        }
                    }
                }
            }
            console.log(this.colors.map(v => v > 0 ? 1 : 0).join(""));
            console.log(this.masks.map(v => v > 0 ? 1 : 0).join(""));
        }
    }

    outputs = {
        [IO_Port.TILE]: (index: number) => {
            const src_offset = index * tw * th;
            const dest_offset = this.display.x + this.display.y * this.display.width;
            const sx = this.display.x, ex = Math.min(sx + tw, this.display.width ), dx = ex - sx;
            const sy = this.display.y, ey = Math.min(sy + th, this.display.height), dy = ey - sy;
            for (let y = 0; y < dy; ++y) {
                for (let x = 0; x < dx; ++x) {
                    const src_i = src_offset + x + y*tw;
                    const dest_i = dest_offset + x + y * this.display.width;
                    if (this.masks[src_i]) {
                        this.display.buffer[dest_i] = this.colors[src_i];
                    }
                }
            }
            this.display.x += tw;
            this.display.update_display();
        },
    };

    inputs = {

    };
}