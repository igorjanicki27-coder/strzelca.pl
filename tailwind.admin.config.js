/** Konfiguracja Tailwind tylko dla panelu admina (bez CDN w produkcji). */
module.exports = {
  content: ["./admin/index.html"],
  theme: {
    extend: {
      colors: {
        coyote: "#c19a6b",
      },
    },
  },
  plugins: [],
};
