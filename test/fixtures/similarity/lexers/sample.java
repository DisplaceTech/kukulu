// A tiny queue, written for the lexer tests.
package demo;

import java.util.ArrayList;
import java.util.List;

/* A block comment. */
public class Queue {
    private final List<Integer> items = new ArrayList<>();

    interface Visitor {
        void visit(int value);
    }

    enum Mode { FIFO, LIFO }

    public void push(int value) {
        items.add(value);
    }

    public int pop(Mode mode) {
        if (items.isEmpty()) {
            return -1;
        } else {
            int index = mode == Mode.FIFO ? 0 : items.size() - 1;
            return items.remove(index);
        }
    }

    public static String describe(long n) {
        switch ((int) n) {
            case 0:
                return "empty";
            default:
                break;
        }
        char c = 'q';
        double ratio = 1.5e2;
        for (int i = 0; i < 3; i++) {
            if (i == 1) {
                continue;
            }
        }
        do {
            n--;
        } while (n > 0x10);
        while (n > 100L) {
            n -= 1;
        }
        return "n" + c + ratio;
    }
}
