// Package inventory keeps a small stock count, written for the lexer tests.
package inventory

import "fmt"

/* Item is one line of stock. */
type Item struct {
	Name  string
	Count int
}

type Counter interface {
	Total() int
}

type Stock map[string]Item

func (s Stock) Total() int {
	sum := 0
	for _, item := range s {
		sum += item.Count
	}
	return sum
}

func describe(n int) string {
	switch {
	case n > 10:
		return "many"
	case n == 0:
		break
	default:
		return `few "items"`
	}
	return "none"
}

func main() {
	stock := Stock{}
	stock["a"] = Item{Name: "bolt", Count: 0x1F}
	var ratio float64 = 2.5e1
	initial := 'x'
	for i := 0; i < 3; i++ {
		if i%2 == 0 {
			continue
		}
		stock["b"] = Item{"nut", i}
	}
	fmt.Println(describe(stock.Total()), ratio, initial)
}
