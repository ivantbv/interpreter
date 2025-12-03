// server.js
import readline from "readline";
import path from "path";
import { fileURLToPath } from "url";
import { BotInterpreter } from "./interpreter.js";
import { WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";

// ===== Path resolution setup =====
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Bot registry for multiple bots ---
// keys: public bot ids you will use from frontend
// values: folder names inside /bots
const BOT_REGISTRY = {
  "pizza-bot": "pizza_bot",
  "support-bot": "support_bot",
  "bananas-bot": "bananas_bot",
  // add more here as you create new bot folders
};

function resolveBotPath(botId) {
  const folder = BOT_REGISTRY[botId];
  if (!folder) return null;
  return path.join(__dirname, "bots", folder);
}

// Absolute path to the .bot folder (for CLI only, keep as-is)
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

wss.on("connection", async (ws, request) => {
  // Determine botId from query string, default "pizza-bot" for backwards compat
  let botId = "pizza-bot";
  try {
    const url = new URL(request.url, "http://localhost");
    botId = url.searchParams.get("botId") || "pizza-bot";
  } catch (e) {
    console.warn("Could not parse request URL for WebSocket, defaulting to pizza-bot");
  }

  const botPath = resolveBotPath(botId);
  if (!botPath) {
    console.error(`❌ Unknown botId "${botId}"`);
    ws.send(JSON.stringify({ type: "error", message: "Unknown bot" }));
    ws.close();
    return;
  }

  const sessionId = uuidv4();

  console.log(`🟢 New session: ${sessionId} (botId=${botId}, path=${botPath})`);
  const bot = new BotInterpreter(botPath);
  sessions.set(sessionId, bot);

  // Send session info
  ws.send(JSON.stringify({ type: "session", sessionId, botId, message: "Connected to bot server" }));

  // Start bot
  try {
    const reply = await bot.start();
    const formatted = bot._formatForApi(reply);

    if (formatted.answers) {
      for (const ans of formatted.answers) {
        ws.send(JSON.stringify({ type: "bot_message", text: ans }));
      }
    }

    if (formatted.buttons && formatted.buttons.length > 0) {
      ws.send(JSON.stringify({ type: "bot_message", text: "", buttons: formatted.buttons }));
    }

  } catch (err) {
    console.error("Bot start failed:", err);
    ws.send(JSON.stringify({ type: "error", message: err.message }));
  }

  // Incoming user messages
  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw);
      const userText = msg.text || msg;

      console.log(`[DEBUG] [${sessionId}] Passing to interpreter:`, userText);

      const reply = await bot.handleMessage(userText);
      if (!reply) return;

      const formatted = bot._formatForApi(reply);

      if (formatted.answers) {
        for (const ans of formatted.answers) {
          ws.send(JSON.stringify({ type: "bot_message", text: ans }));
        }
      }

      if (formatted.buttons && formatted.buttons.length > 0) {
        ws.send(JSON.stringify({ type: "bot_message", text: "", buttons: formatted.buttons }));
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

  ws.on("error", (err) => {
    console.error(`WebSocket error on session ${sessionId}:`, err);
  });
});
