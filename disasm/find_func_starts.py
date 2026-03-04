#!/usr/bin/env python3
"""Find function starts in a range."""

def main():
    exe_path = 'earth/SCORCH.EXE'
    start_off = 0x33FC3
    end_off = 0x35000

    with open(exe_path, 'rb') as f:
        data = f.read()

    for i in range(start_off, end_off):
        if data[i] == 0xCB:  # RETF
            j = i + 1
            if j < len(data):
                if data[j] == 0xC8:  # ENTER
                    print(f'RETF+ENTER at 0x{j:05X}  (enter bytes: {data[j:j+4].hex()})')
                elif data[j] == 0x55:  # PUSH BP (far function start)
                    print(f'RETF+PUSH_BP at 0x{j:05X}')
                elif data[j] == 0x53:  # PUSH BX?
                    print(f'RETF+PUSH_BX at 0x{j:05X}')
            # Also show where the RETF is
            print(f'  RETF at 0x{i:05X}')
        elif data[i] == 0xC9:  # LEAVE
            j = i + 1
            if j < len(data) and data[j] == 0xCB:  # RETF
                k = j + 1
                if k < len(data):
                    if data[k] == 0xC8:
                        print(f'LEAVE+RETF+ENTER at 0x{k:05X}  (enter: {data[k:k+4].hex()})')
                    elif data[k] == 0x55:
                        print(f'LEAVE+RETF+PUSH_BP at 0x{k:05X}')

if __name__ == '__main__':
    main()
