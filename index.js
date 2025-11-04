// index.js
import readline from "readline";
import { BotInterpreter } from "./interpreter.js";

const bot = new BotInterpreter("./bots/pizza_bot"); // path to your .bot folder

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function promptUser() {
  rl.question("> ", async (input) => {
    const reply = await bot.handleMessage(input.trim());
    console.log(reply);
    promptUser(); // keep looping
  });
}

async function main() {
  const startReply = await bot.start();
  console.log(startReply);
  promptUser();
}

main();
