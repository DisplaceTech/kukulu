// A tiny stack, written for the lexer tests.
#include <string>
#include <vector>

namespace demo {

template <typename T>
class Stack {
public:
    void push(const T &value) { items_.push_back(value); }

    bool pop(T &out) {
        if (items_.empty()) {
            return false;
        }
        out = items_.back();
        items_.pop_back();
        return true;
    }

    std::size_t size() const { return items_.size(); }

private:
    std::vector<T> items_;
};

struct Point {
    int x;
    int y;
};

enum class Color { Red, Green };

/* Count the words in a string. */
int words(const std::string &text) {
    int count = 0;
    bool inside = false;
    for (char c : text) {
        if (c == ' ') {
            inside = false;
        } else if (!inside) {
            inside = true;
            ++count;
        }
    }
    return count;
}

} // namespace demo

int main() {
    demo::Stack<int> stack;
    stack.push(0x2A);
    int top = 0;
    const char *raw = R"(a "raw" string)";
    while (stack.pop(top)) {
        switch (top) {
        case 42:
            break;
        default:
            continue;
        }
    }
    auto none = nullptr;
    (void)none;
    (void)raw;
    return demo::words("one two") > 1 ? 0 : 1;
}
