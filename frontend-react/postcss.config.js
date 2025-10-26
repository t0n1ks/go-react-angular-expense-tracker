export default {
  plugins: {
    // ЗАМЕНЕНО: Используем новый официальный плагин для PostCSS
    // @tailwindcss/postcss является оберткой, которая вызывает основную библиотеку tailwindcss
    '@tailwindcss/postcss': {}, 
    autoprefixer: {},
  },
};