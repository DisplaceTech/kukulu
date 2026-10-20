<?php
// A tiny greeter, written for the lexer tests.
# Another comment style.
/* A block comment. */
namespace Demo;

interface Greeter
{
    public function greet(string $name): string;
}

class Polite implements Greeter
{
    private int $count = 0;

    public function greet(string $name): string
    {
        $this->count++;
        return 'Hello, ' . $name . " #{$this->count}";
    }
}

function pick(int $n): string
{
    switch ($n) {
        case 0:
            return 'zero';
        default:
            break;
    }
    foreach ([1, 2, 3] as $i) {
        if ($i === 2) {
            continue;
        } elseif ($i > 0x10) {
            break;
        }
    }
    for ($j = 0; $j < 3; $j++) {
        $total = $j * 1.5e1;
    }
    while ($n > 100) {
        $n--;
    }
    return 'many';
}

$greeter = new Polite();
echo $greeter->greet('Ada');
?>
