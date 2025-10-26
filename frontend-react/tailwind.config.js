// frontend-react/tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}", // Указываем Tailwind сканировать эти файлы
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}