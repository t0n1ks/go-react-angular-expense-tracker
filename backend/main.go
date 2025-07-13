package main

import (
	"fmt"
	"log"
	"net/http"
)

func main() {
	http.HandleFunc("/", handler) // Определяем обработчик для корневого URL
	fmt.Println("Сервер запущен на :8080")
	log.Fatal(http.ListenAndServe(":8080", nil)) // Запускаем сервер на порту 8080
}

// handler - функция, которая обрабатывает HTTP-запросы
func handler(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintf(w, "Hello from Go Backend! You requested: %s\n", r.URL.Path)
}