import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles.css'; // optional

// ReactDOM.createRoot(document.getElementById('root')).render(
//   <React.StrictMode>
//     <App />
//   </React.StrictMode>,
// );
ReactDOM.createRoot(document.getElementById("root")).render(
<React.StrictMode>
{/* Dev: always pizza-bot with explicit WS path */}
<App botId="pizza-bot" wsPath="ws://localhost:3001" />
</React.StrictMode>
);