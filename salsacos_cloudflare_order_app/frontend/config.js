
const PRODUCTS = {
  tacos: { name: "Tacos", price: 250 },
  special_tacos: { name: "Special Tacos", price: 300 },
  wrap: { name: "Wrap", price: 200 },
  special_wrap: { name: "Special Wrap", price: 250 },
  ketchup: { name: "Ketchup", price: 40 },
  mayonnaise: { name: "Mayonnaise", price: 40 },
  salsacos_sauce: { name: "Salsacos Sauce", price: 50 },
  coca_cola: { name: "Coca-Cola", price: 70 },
  fanta: { name: "Fanta", price: 70 },
  sprite: { name: "Sprite", price: 70 },
  water: { name: "Bottled Water", price: 50 },
  milkshake: { name: "Milkshake", price: 350 },
  strawberry_shake: { name: "Strawberry Shake", price: 350 },
  strawberry_mojito: { name: "Strawberry Mojito", price: 450 },
  mint_mojito: { name: "Mint Mojito", price: 450 },
  dashen_beer: { name: "Dashen Beer", price: 120, alcohol: true },
  st_george_beer: { name: "St. George Beer", price: 120, alcohol: true },
  arada_beer: { name: "Arada Beer", price: 120, alcohol: true }
};

const DELIVERY_FEE = 50;

window.SALSACOS_API_URL =
  "https://salsacos-orders.zelalemihret1.workers.dev";
