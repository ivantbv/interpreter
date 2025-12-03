import React, { useState, useRef, useEffect } from "react";
import "./styles.css";

function App({ botId = "pizza-bot", wsPath = "" }) {
const [opened, setOpened] = useState(false);
const [messages, setMessages] = useState([]);
const [input, setInput] = useState("");
const [buttons, setButtons] = useState([]);
const chatBoxRef = useRef(null);
const ws = useRef(null);

// Connect WebSocket once
// Connect WebSocket once
useEffect(() => {
  const wsUrl = `${wsPath || 'ws://localhost:3001'}?botId=${encodeURIComponent(botId)}`;
  
  console.log("🟢 Connecting to:", wsUrl);
  
  ws.current = new WebSocket(wsUrl);
  
  ws.current.onopen = () => console.log("✅ WebSocket connected");
  ws.current.onerror = (error) => console.error("❌ WebSocket error:", error);
  
  ws.current.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === "bot_message") {
      if (msg.text && msg.text.trim() !== "") {
        setMessages((prev) => [...prev, { from: "bot", text: msg.text }]);
      }
      if (msg.buttons) {
        setButtons(msg.buttons);
      }
    }
    if (msg.type === "session") {
      console.log("Connected:", msg.sessionId, "botId:", msg.botId || botId);
    }
  };

  ws.current.onclose = () => console.log("🔌 Connection closed");

  return () => ws.current && ws.current.close();
}, [botId, wsPath]);

// Auto-scroll
useEffect(() => {
if (opened && chatBoxRef.current) {
chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
}
}, [messages, opened]);

const closeChat = () => setOpened(false);

const sendMessage = (textOverride) => {
const text = textOverride ?? input;
if (!text.trim()) return;
setMessages((p) => [...p, { from: "user", text }]);

if (ws.current && ws.current.readyState === WebSocket.OPEN) {
  ws.current.send(JSON.stringify({ type: "user_message", text }));
}

setInput("");
setButtons([]);
};

return (
<>
{!opened && (
<button
className="widget-btn"
onClick={() => setOpened(true)}
aria-label="Open chat"
>
💬
</button>
)}
  {opened && (
    <div className="widget-window" role="region" aria-label="Chat window">
      <div className="widget-header">
        <span>🤖 Pizza Bot Chat</span>
        <button
          onClick={closeChat}
          className="widget-close-btn"
          aria-label="Close chat"
        >
          ×
        </button>
      </div>

      <div className="widget-chatbox" ref={chatBoxRef}>
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`widget-msg ${
              msg.from === "user" ? "widget-msg-user" : "widget-msg-bot"
            }`}
          >
            {msg.text}
          </div>
        ))}

        {buttons.length > 0 && (
          <div className="widget-buttons-row">
            {buttons.map((b, idx) => (
              <button
                key={b.label + idx}
                className="widget-option-btn"
                onClick={() => sendMessage(b.label)}
              >
                {b.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="widget-input-area">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="widget-input"
          placeholder="Type a message..."
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
        />

        <button onClick={() => sendMessage()} className="widget-send-btn">
          Send
        </button>
      </div>
    </div>
  )}
</>
);
}

export default App;

