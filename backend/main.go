// backend/main.go
package main

import (
	"fmt"
	"log"
	"net/http"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database" // Обновите путь!
)

func main() {
	// Подключаемся к базе данных при запуске приложения
	database.Connect()

	// Пока оставим тестовый обработчик
	http.HandleFunc("/", handler)
	fmt.Println("Сервер запущен на :8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}

// handler - функция, которая обрабатывает HTTP-запросы
func handler(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintf(w, "Hello from Go Backend! You requested: %s\n", r.URL.Path)
}