import readline from "readline";
import path from "path";
import { fileURLToPath } from "url";
import { BotInterpreter } from "./interpreter.js";
import { WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";

// ===== Path resolution setup =====
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Correct absolute path to the .bot folder
const pizzaBotPath = path.join(__dirname, "bots", "pizza_bot");

//////////////////////////////////////
// CLI MODE (for debugging)
//////////////////////////////////////

const cliBot = new BotInterpreter(pizzaBotPath);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function promptUser() {
  rl.question("> ", async (input) => {
    const reply = await cliBot.handleMessage(input.trim());
    console.log(reply);
    promptUser(); // loop
  });
}

async function main() {
  try {
    const startReply = await cliBot.start();
    console.log(startReply);
    promptUser();
  } catch (err) {
    console.error("Error starting bot:", err);
  }
}

main();

//////////////////////////////////////
// WEBSOCKET SERVER (for React)
//////////////////////////////////////

const PORT = 3001;
const wss = new WebSocketServer({ port: PORT });
console.log(`✅ WebSocket server running on ws://localhost:${PORT}`);

const sessions = new Map(); // sessionId → BotInterpreter

wss.on("connection", async (ws) => {
  const sessionId = uuidv4();
  console.log(`🟢 New session: ${sessionId}`);

  const bot = new BotInterpreter(pizzaBotPath);
  sessions.set(sessionId, bot);

  // Send session info to frontend
  ws.send(
    JSON.stringify({
      type: "session",
      sessionId,
      message: "Connected to bot server",
    })
  );

  // Initialize bot for this session
  try {
    const reply = await bot.start();

    const formatted = bot._formatForApi(reply);

    if (formatted.answers) {
        for (const ans of formatted.answers) {
            ws.send(JSON.stringify({ type: "bot_message", text: ans }));
        }
    }
    if (formatted.buttons && formatted.buttons.length > 0) {
        ws.send(JSON.stringify({
            type: "bot_message",
            text: "",
            buttons: formatted.buttons,
        }));
    }
  } catch (err) {
    console.error("Bot start failed:", err);
  }

  //////////////////////////////////////
  // ✅ Handle incoming user messages
  //////////////////////////////////////
  ws.on("message", async (raw) => {
    try {
        const msg = JSON.parse(raw);
        const userText = msg.text || msg; // only the text, not full object
        console.log(`[DEBUG] Passing to interpreter:`, userText);

        const reply = await bot.handleMessage(userText);
        if (!reply) return;
        const formatted = bot._formatForApi(reply);

        if (formatted.answers) {
            for (const ans of formatted.answers) {
                ws.send(JSON.stringify({ type: "bot_message", text: ans }));
            }
        }
        if (formatted.buttons && formatted.buttons.length > 0) {
            ws.send(JSON.stringify({
                type: "bot_message",
                text: "",
                buttons: formatted.buttons,
            }));
        }
    } catch (err) {
      console.error("Error handling WebSocket message:", err);
      ws.send(
        JSON.stringify({
          type: "error",
          message: err.message,
        })
      );
    }
  });

  ws.on("close", () => {
    sessions.delete(sessionId);
    console.log(`🔴 Session closed: ${sessionId}`);
  });
});
