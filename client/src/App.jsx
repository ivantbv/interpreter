import React, { useState, useEffect } from "react";

function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [ws, setWs] = useState(null);
  const [buttons, setButtons] = useState([]);

  useEffect(() => {
    const socket = new WebSocket("ws://localhost:3001");
    setWs(socket);

    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "bot_message") {
        if (msg.text && msg.text.trim() !== "") {
          setMessages((prev) => [...prev, { from: "bot", text: msg.text }]);
        }
        if (msg.buttons && msg.buttons.length > 0) {
          setButtons(msg.buttons);
        }
      }
      else if (msg.type === "session") {
        console.log("Connected:", msg.sessionId);
      }
    };

    socket.onclose = () => console.log("🔌 Connection closed");
    return () => socket.close();
  }, []);

  const sendMessage = (textToSend) => {
    const finalText = textToSend === undefined ? input : textToSend;
    if (!finalText.trim()) return;
    setMessages((prev) => [...prev, { from: "user", text: finalText }]);
    if (ws) ws.send(JSON.stringify({ type: "user_message", text: finalText }));
    setInput("");
    setButtons([]); // Hide buttons after selection
  };

  return (
    <div style={styles.container}>
      <h2>🤖 Chatbot</h2>
      <div style={styles.chatBox}>
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              ...styles.msg,
              alignSelf: msg.from === "user" ? "flex-end" : "flex-start",
              backgroundColor: msg.from === "user" ? "#007bff" : "#eee",
              color: msg.from === "user" ? "white" : "black",
            }}
          >
            {msg.text}
          </div>
        ))}
        {buttons.length > 0 && (
          <div style={{ marginTop: 10 }}>
            {buttons.map((b, idx) => (
              <button
                key={b.label + idx}
                style={styles.btn}
                onClick={() => sendMessage(b.label)}
              >
                {b.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div style={styles.inputArea}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          style={styles.input}
          placeholder="Type a message..."
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
        />
        <button onClick={() => sendMessage()} style={styles.btn}>
          Send
        </button>
      </div>
    </div>
  );
}

const styles = {
  container: { maxWidth: 500, margin: "auto", fontFamily: "sans-serif" },
  chatBox: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "10px",
    border: "1px solid #ccc",
    height: "400px",
    overflowY: "auto",
  },
  msg: { padding: "8px 12px", borderRadius: "12px", maxWidth: "80%" },
  inputArea: { display: "flex", marginTop: "10px" },
  input: { flex: 1, padding: "8px" },
  btn: { marginLeft: "8px", padding: "8px 12px" },
};

export default App;
