const WORDS = [
  "airplane", "alligator", "anchor", "astronaut", "avocado", "backpack",
  "balloon", "banana", "bicycle", "birthday", "blueberry", "book",
  "butterfly", "camera", "campfire", "candle", "castle", "cat",
  "cheeseburger", "chocolate", "cloud", "coconut", "computer", "dinosaur",
  "donut", "dragon", "drum", "elephant", "fireworks", "football",
  "guitar", "hamburger", "headphones", "ice cream", "jellyfish", "kangaroo",
  "lantern", "lemon", "lighthouse", "mermaid", "moon", "mountain",
  "octopus", "paintbrush", "pancake", "parachute", "penguin", "pineapple",
  "pizza", "popcorn", "rainbow", "robot", "rocket", "sandwich",
  "snowman", "spaceship", "spider", "strawberry", "sunglasses", "telescope",
  "tiger", "toothbrush", "tornado", "turtle", "umbrella", "watermelon",
  "waterfall", "whale", "wizard", "zebra"
];

export function chooseWords(count = 3) {
  const pool = [...WORDS];
  const choices = [];
  while (choices.length < count && pool.length) {
    choices.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return choices;
}

export function normalizeWord(word) {
  return word.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}
