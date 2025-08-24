import sys

output = sys.stdout

def print_table(name: str, values: list[int]):
    max_width = max(len(str(v)) for v in values)

    print(f"RW []", file=output)
    print(f".{name}", file=output)
    for i, num in enumerate(values):
        if i & 0xf == 0:
            print(f"RW [", end=" ", file=output)

        print(str(num).ljust(max_width), end=" ", file=output)

        if i & 0xf == 0xf:
            print(f"]", file=output)

    if len(values) != 0 and len(values) & 0xf != 0:
        print(f"]", file=output)


    print(f".{name}_end", file=output)
    print(f"RW []", file=output)
    print(f"", file=output)


def main():
    alive_set: set[int] = set()
    dead_set: set[int] = set()

    for alive in [False, True]:
        for count in range(11):
            store = count ^ (1 << 3) if alive else count
            next = count == 3 or (alive and count == 4)
            print(store)

            current = alive_set if next else dead_set
            other = dead_set if next else alive_set

            if other.__contains__(store):
                print(alive, count, store, file=sys.stderr)
                sys.exit(1)
            current.add(store)


    values: list[int] = []
    for high in range(16):
        high_alive = 1 if alive_set.__contains__(high) else 0
        for low in range(16):
            low_alive = 1 if alive_set.__contains__(low) else 0
            alive = low_alive | (high_alive << 1)
            values.append(alive)


    print_table("tile_low", values)
    print_table("tile_high", [x << 2 for x in values])

    tile_to_cells: list[int] = []
    for i in range(16):
        a = i & (1 << 0) != 0
        b = i & (1 << 1) != 0
        c = i & (1 << 2) != 0
        d = i & (1 << 3) != 0

        cells = (a << 0) | (b << 4) | (c << 8) | (d << 12)
        tile_to_cells.append(cells)

    print_table("tile_to_cells", tile_to_cells)


if __name__ == "__main__":
    main()