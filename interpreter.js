// interpreter.js working version before $reactions
import fs from "fs";
import vm from "vm";
import path from "path";
import { fileURLToPath } from "url";
import { parseBotFile } from "./parser.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class BotInterpreter {
  constructor(botPath, { debug = true } = {}) {
    this.context = { session: {}, client: {}, request: {} };
    this.theme = null;
    this.states = {};
    this.bot = {}; // 👈 Added: holds full parsed bot structure (by theme)
    this.currentState = "Start";
    this.debug = debug;
    this.sandbox = null;
  
    const fullPath = path.resolve(__dirname, botPath);
    const stat = fs.statSync(fullPath);
  
    if (stat.isDirectory()) {
      this.loadBotProject(fullPath);
    } else {
      this.loadBotFile(fullPath);
    }
  }   

  log(...args) {
    if (this.debug) console.log("[DEBUG]", ...args);
  }

  // --- NEW: Load a full bot project folder ---
  loadBotProject(folderPath) {
    const botFiles = fs.readdirSync(folderPath).filter(f => f.endsWith(".bot"));
    const jsFiles = fs.readdirSync(folderPath).filter(f => f.endsWith(".js"));
  
    // Shared sandbox for this bot project
    const sandbox = {
      $context: this.context,
      $client: this.context.client,
      $session: this.context.session,
      $request: this.context.request,
      $input: "",
      console,
      fetch,
      setTimeout,
      setInterval,
      clearTimeout,
      clearInterval,
      Date,
      Promise,
    };
  
    vm.createContext(sandbox);
  
    // Load all .js helper files
    for (const jsFile of jsFiles) {
      const filePath = path.join(folderPath, jsFile);
      try {
        const code = fs.readFileSync(filePath, "utf-8");
        vm.runInContext(code, sandbox);
  
        for (const key of Object.keys(sandbox)) {
          if (typeof sandbox[key] === "function") {
            this[key] = sandbox[key];
          }
        }
  
        this.log(`[DEBUG] Loaded shared script: ${jsFile}`);
      } catch (e) {
        console.error(`Error loading shared script (${jsFile}):`, e);
      }
    }
  
    // --- Multi-theme bot storage with flattened states ---
    this.bot = {};
  
    function flattenStates(states, parentPath = "") {
      const result = {};
      for (const [name, state] of Object.entries(states)) {
        const pathKey = (parentPath ? parentPath + "/" : "") + name;
        result[pathKey] = state;
        if (state.children) {
          Object.assign(result, flattenStates(state.children, pathKey));
          delete state.children; // optional: cleanup
        }
      }
      return result;
    }
  
    for (const botFile of botFiles) {
      const filePath = path.join(folderPath, botFile);
      const botData = parseBotFile(filePath);
  
      for (const [themeNameRaw, themeData] of Object.entries(botData)) {
        // ✅ Normalize theme name to always start with '/'
        const themeName = themeNameRaw.startsWith("/") ? themeNameRaw : `/${themeNameRaw}`;
      
        if (!this.bot[themeName]) {
          this.bot[themeName] = { states: flattenStates(themeData.states) };
        } else {
          Object.assign(this.bot[themeName].states, flattenStates(themeData.states));
        }
      }      
  
      console.log(`Loaded bot file: ${botFile}`);
      this.log("Themes loaded:", Object.keys(botData));
    }
  
    // Default theme selection
    if (this.bot["/"]) {
      this.theme = "/";
      this.states = this.bot["/"].states;
    } else {
      const firstTheme = Object.keys(this.bot)[0];
      this.theme = firstTheme;
      this.states = this.bot[firstTheme].states;
    }
  
    this.sandbox = sandbox;
  }
  
  loadBotFile(filePath) {
    const botData = parseBotFile(filePath);
    this.bot = {};
  
    function flattenStates(states, parentPath = "") {
      const result = {};
      for (const [name, state] of Object.entries(states)) {
        const pathKey = (parentPath ? parentPath + "/" : "") + name;
        result[pathKey] = state;
        if (state.children) {
          Object.assign(result, flattenStates(state.children, pathKey));
          delete state.children;
        }
      }
      return result;
    }
  
    for (const [themeNameRaw, themeData] of Object.entries(botData)) {
      // ✅ Normalize theme name to always start with '/'
      const themeName = themeNameRaw.startsWith("/") ? themeNameRaw : `/${themeNameRaw}`;
    
      if (!this.bot[themeName]) {
        this.bot[themeName] = { states: flattenStates(themeData.states) };
      } else {
        Object.assign(this.bot[themeName].states, flattenStates(themeData.states));
      }
    }    
  
    if (this.bot["/"]) {
      this.theme = "/";
      this.states = this.bot["/"].states;
    } else {
      const firstTheme = Object.keys(this.bot)[0];
      this.theme = firstTheme;
      this.states = this.bot[firstTheme].states;
    }
  
    console.log(`Loaded bot file: ${path.basename(filePath)}`);
    this.log("Theme:", this.theme);
    this.log("States loaded:", Object.keys(this.states));
  }  

  async start() {
    // start at flattened key
    this.currentState = "/Start";
    this.log("Starting bot at state:", this.currentState);
  
    const reply = await this._enterState(this.currentState, true);
  
    const state = this._getCurrentState();
    if (state["go!"]) {
      this.log("Following instant go! transition to:", state["go!"]);
      const nextReply = await this._transition(state["go!"]);
      return (reply ? reply + "\n" + nextReply : nextReply).trim();
    }
  
    return reply.trim();
  }  
  

  async handleMessage(message) {
    this.log(`Received message: "${message}" (currentState = ${this.currentState})`);
    this.context.input = message;
    if (this.sandbox) this.sandbox.$input = message;

    // 🔹 Step 1: Check global q! triggers across ALL themes
    for (const [themeName, themeData] of Object.entries(this.bot)) {
      for (const [stateName, stateData] of Object.entries(themeData.states)) {
        if (stateData["q!"]) {
          const regex = this._parseRegex(stateData["q!"]);
          if (regex && regex.test(message)) {
            this.log(`Global regex matched in theme "${themeName}", state "${stateName}":`, regex);
            // Transition to the matched state (absolute path)
            const fullTarget = `${themeName}${stateName}`;
            return await this._transition(fullTarget, message);
          }
        }
      }
    }
  
    // 🔹 Step 2: Handle buttons in the current state
    const state = this._getCurrentState();
    if (state["buttons"]) {
      const buttons = this._parseButtons(state["buttons"]);
      this.log("Available buttons:", buttons.map(b => b.label));
      const reply = this._handleButtonClick(message, buttons);
      if (reply) return reply;
    }
  
    // 🔹 Step 3: Check regex only for the current state
    if (state["q!"]) {
      const regex = this._parseRegex(state["q!"]);
      if (regex && regex.test(message)) {
        this.log("Regex matched:", regex);
        return await this._transition(state["go"] || state["go!"]);
      }
    }
  
    // 🔹 Step 4: Check deferred go:
    if (state["go"]) {
      this.log("Deferred go transition to:", state["go"]);
      return await this._transition(state["go"], message);
    }

    // 🔹 Step 5 (NEW): Check for matching nested child state (q:)
    const nestedMatch = this._findMatchingState(message);
    if (nestedMatch) {
      this.log(`Nested child state matched: ${nestedMatch}`);
      return await this._transition(nestedMatch, message);
    }
  
    this.log("No match for message, staying in state:", this.currentState);
    return "I didn’t understand that. Please try again.";
  }  

  _handleButtonClick(message, buttons) {
    const clicked = buttons.find(b => b.label.toLowerCase() === message.toLowerCase());
    if (clicked) {
      this.log(`Button clicked: "${clicked.label}" → ${clicked.target || "null"}`);
  
      // 🧠 If the button has a valid target → transition as usual
      if (clicked.target) {
        return this._transition(clicked.target, message);
      }
  
      // 🧩 Otherwise, treat it as normal user input (loop-safe)
      if (this._buttonRecursionGuard === message) {
        this.log(`Prevented recursion loop for button "${message}"`);
        return null;
      }
  
      // 🛡️ Set guard to prevent infinite recursion if same button triggers itself again
      this._buttonRecursionGuard = message;
      
      this.context.input = message;
      if (this.sandbox) this.sandbox.$input = message;

      this.log(`Button "${message}" has no target — treating as normal message input`);
      const result = this.handleMessage(message);
  
      // ✅ Clear the guard afterward
      this._buttonRecursionGuard = null;
  
      return result;
    }
    return null;
  }  

  // _getCurrentState() {
  //   return this.states[this.currentState] || {};
  // }
// Return actual current state's object (using flattened keys)
_getCurrentState() {
  if (!this.currentState) return {};
  let norm = String(this.currentState);
  if (!norm.startsWith("/")) norm = "/" + norm;

  const { theme, state } = this._resolveStatePath(norm);
  const themeKey = theme && theme.startsWith("/") ? theme : "/" + theme;
  const stateKey = state && state.startsWith("/") ? state : "/" + state;

  if (!this.bot[themeKey] || !this.bot[themeKey].states[stateKey]) {
    this.log(`⚠️ State "${this.currentState}" not found (resolved: theme="${themeKey}", state="${stateKey}")`);
    return {};
  }
  return this.bot[themeKey].states[stateKey];
}

  _parseRegex(text) {
    const match = text.match(/\$regex<(.*)>/);
    return match ? new RegExp(match[1]) : null;
  }

  _parseButtons(text) {
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    return lines.map(l => {
      const [label, target] = l.split("->").map(s => s ? s.trim() : "");
      const cleanLabel = label.replace(/["']/g, "");
      const cleanTarget = target || null; // keep leading / or ../ ./ as written
      return { label: cleanLabel, target: cleanTarget };
    });
  }  

  /**
   * Recursively find a matching nested (child) state by checking "q" triggers under the current state
   */
   _findMatchingState(input, parentPath = this.currentState) {
    const themeData = this.bot[this.theme];
    if (!themeData || !themeData.states) return null;

    for (const [stateName, stateData] of Object.entries(this.states)) {
      // Only consider states that are nested under the current parentPath
      if (!stateName.startsWith(parentPath + "/")) continue;

      // If it's a direct child (not a deeper one), we test its q:
      const subPath = stateName.slice(parentPath.length + 1);
      if (!subPath.includes("/")) {
        // --- Check q: condition ---
        if (stateData["q"]) {
          const q = stateData["q"].trim();

          if (q === "*") {
            return stateName;
          }

          try {
            const regex = this._parseRegex(q);
            if (regex && regex.test(input)) {
              return stateName;
            }
          } catch (e) {
            // ignore invalid regex
          }
        }
        // --- Recurse into this child to check its own nested children ---
        const deeperMatch = this._findMatchingState(input, stateName);
        if (deeperMatch) return deeperMatch;
      }
    }

    return null;
  }

  // --- UPDATED: uses persistent sandbox ---
  async _executeScript(script) {
    try {
      // Use persistent sandbox if available, otherwise create a fresh one
      const sandbox = this.sandbox || {
        $context: this.context,
        $client: this.context.client,
        $session: this.context.session,
        $request: this.context.request,
        $input: "",
        console,
        fetch,
        setTimeout,
        setInterval,
        clearTimeout,
        clearInterval,
        Date,
        Promise
      };
  
      // IMPORTANT: keep sandbox references in sync with this.context each run
      sandbox.$context = this.context;
      sandbox.$client = this.context.client;
      sandbox.$session = this.context.session;
      sandbox.$request = this.context.request;
      sandbox.$input = this.context.input || "";
  
      // Ensure context is an actual vm context
      vm.createContext(sandbox);
  
      // Wrap user script in async IIFE so it can use await
      const wrapped = `(async () => { ${script} })()`;
  
      // Run script inside the persistent sandbox
      const result = await vm.runInContext(wrapped, sandbox, { timeout: 20000 });
  
      // Copy back any mutated objects if sandbox was newly created (defensive)
      if (!this.sandbox) {
        this.context = sandbox.$context;
        this.context.client = sandbox.$client;
        this.context.session = sandbox.$session;
        this.context.request = sandbox.$request;
      }
  
      return result;
    } catch (e) {
      console.error("Script error:", e);
    }
  }
  
//_substituteVars with only script tags escaping for anti xss scripting (safe)
  // _substituteVars(text) {
  //   try {
  //     const sandbox = {
  //       $context: this.context,
  //       $client: this.context.client,
  //       $session: this.context.session,
  //       $request: this.context.request,
  //       $input: this.context.input || "",
  //       ...this.sandbox,
  //       console,
  //     };
  
  //     vm.createContext(sandbox);
  
  //     // helper to escape dangerous tags (script, iframe, event attributes, etc.)
  //     const escapeDangerousHTML = (value) => {
  //       if (typeof value !== "string") return value;
  //       return value
  //         .replace(/<script/gi, "&lt;script")
  //         .replace(/<\/script>/gi, "&lt;/script&gt;")
  //         .replace(/on\w+="[^"]*"/gi, "")
  //         .replace(/javascript:/gi, "");
  //     };
  
  //     const result = text.replace(/\$\{([^}]+)\}/g, (_, expr) => {
  //       try {
  //         let value = vm.runInContext(expr, sandbox);
  //         if (value === undefined || value === null) return "";
  //         if (typeof value === "object") value = JSON.stringify(value);
  //         return escapeDangerousHTML(String(value));
  //       } catch (err) {
  //         console.error("Error evaluating expression:", expr, err);
  //         return "";
  //       }
  //     });
  
  //     return result;
  //   } catch (err) {
  //     console.error("Error substituting vars:", err);
  //     return text;
  //   }
  // } 
  
  _substituteVars(text) {
    try {
      const sandbox = {
        $context: this.context,
        $client: this.context.client,
        $session: this.context.session,
        $request: this.context.request,
        $input: this.context.input || "",
        ...this.sandbox, // keep helper functions available
        console,
      };
  
      vm.createContext(sandbox);
  
      // sanitize evaluated values to prevent XSS and dangerous embeds
      const escapeDangerousHTML = (value) => {
        if (typeof value !== "string") return value;
  
        let v = value;
  
        // 1) Remove inline event handlers, e.g. onload="...", onclick='...', onmouseover=...
        v = v.replace(/ on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  
        // 2) Remove javascript: and data: schemes in attributes / URIs
        v = v.replace(/javascript\s*:/gi, "");
        v = v.replace(/data\s*:/gi, ""); // optionally strip data: URIs
  
        // 3) Neutralize dangerous tags by escaping < and > for those tags
        //    This preserves other HTML (bot authored) but neutralizes script/iframe/object/embed/svg
        const dangerousTags = ["script", "iframe", "object", "embed", "svg"];
        for (const tag of dangerousTags) {
          // opening tags
          v = v.replace(new RegExp(`<\\s*(${tag})([^>]*)>`, "gi"), (m) =>
            m.replace(/</g, "&lt;").replace(/>/g, "&gt;")
          );
          // closing tags
          v = v.replace(new RegExp(`<\\/\\s*(${tag})\\s*>`, "gi"), (m) =>
            m.replace(/</g, "&lt;").replace(/>/g, "&gt;")
          );
        }
  
        // 4) As a fallback, escape any remaining <script-like sequences just in case
        v = v.replace(/<\s*script/gi, "&lt;script");
        v = v.replace(/<\s*iframe/gi, "&lt;iframe");
        v = v.replace(/<\s*object/gi, "&lt;object");
        v = v.replace(/<\s*embed/gi, "&lt;embed");
        v = v.replace(/<\s*svg/gi, "&lt;svg");
  
        // 5) Remove potentially dangerous attributes (style with expression, srcdoc, etc.)
        //    This is conservative — removes entire attribute matches like srcdoc="..."
        v = v.replace(/\s(srcdoc|formaction|poster|sandbox)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  
        return v;
      };
  
      // Replace ${ ... } with evaluated result (sanitized)
      const result = text.replace(/\$\{([^}]+)\}/g, (_, expr) => {
        try {
          let value = vm.runInContext(expr, sandbox);
          if (value === undefined || value === null) return "";
          if (typeof value === "object") value = JSON.stringify(value);
          return escapeDangerousHTML(String(value));
        } catch (err) {
          console.error("Error evaluating expression:", expr, err);
          return "";
        }
      });
  
      return result;
    } catch (err) {
      console.error("Error substituting vars:", err);
      return text;
    }
  }

// Resolve a target into { theme, stateKey } where:
// - theme is like "/Deliv" or "/" (always starts with "/")
// - stateKey is the flattened state key that the parser created, e.g. "/Start" or "/ChooseCity/RememberCity"
_resolveStatePath(target) {
  if (!target) return null;

  target = String(target).trim().replace(/\/+$/, "");

  let currentFull = this.currentState || "";
  if (!currentFull.startsWith("/")) currentFull = "/" + currentFull;

  // --- Absolute path starting with / ---
  if (target.startsWith("/")) {
    const parts = target.slice(1).split("/").filter(Boolean);

    if (parts.length === 1) {
      // Single segment, e.g. "/ChooseCity" → search in root theme first
      if (this.bot["/"] && this.bot["/"].states["/" + parts[0]]) {
        return { theme: "/", state: "/" + parts[0] };
      }
      // fallback: current theme
      if (this.bot[this.theme] && this.bot[this.theme].states["/" + parts[0]]) {
        return { theme: this.theme, state: "/" + parts[0] };
      }
    } else if (parts.length > 1) {
      // Multi-segment: first part might be a theme
      const candidateTheme = "/" + parts[0];
      if (this.bot[candidateTheme]) {
        return { theme: candidateTheme, state: "/" + parts.slice(1).join("/") };
      }
      // fallback to root theme
      const rootState = "/" + parts.join("/");
      if (this.bot["/"] && this.bot["/"].states[rootState]) {
        return { theme: "/", state: rootState };
      }
      // fallback: current theme
      if (this.bot[this.theme] && this.bot[this.theme].states[rootState]) {
        return { theme: this.theme, state: rootState };
      }
    }

    // last resort
    return { theme: this.theme, state: "/" + parts.join("/") };
  }

  // --- Relative paths etc remain unchanged ---
  if (target.startsWith("..")) { /* ... */ }
  if (target.startsWith("./")) { /* ... */ }

  const candidate1 = (currentFull ? currentFull + "/" + target : "/" + target).replace(/\/+/g, "/");
  if (this.bot[this.theme] && this.bot[this.theme].states[candidate1]) {
    return { theme: this.theme, state: candidate1 };
  }

  const candidate2 = "/" + target;
  if (this.bot[this.theme] && this.bot[this.theme].states[candidate2]) {
    return { theme: this.theme, state: candidate2 };
  }

  return { theme: this.theme, state: "/" + target.replace(/^\/+/, "") };
}

// Transition to target (target can be absolute /Theme/State, /State, relative names, ./, ../)
async _transition(target, userInput = null) {
  if (!target) return "";

  target = String(target).trim();
  const resolved = this._resolveStatePath(target);
  if (!resolved) return `State "${target}" not found`;

  const theme = resolved.theme && resolved.theme.startsWith("/") ? resolved.theme : "/" + resolved.theme;
  const stateKey = resolved.state && resolved.state.startsWith("/") ? resolved.state : "/" + resolved.state;

  if (!this.bot[theme]) {
    return `State "${target}" not found (theme "${theme}" missing)`;
  }
  const nextState = this.bot[theme].states[stateKey];
  if (!nextState) {
    return `State "${target}" not found`;
  }

  this.log(`Transitioning: ${this.currentState} → ${target} (theme="${theme}", stateKey="${stateKey}", input="${userInput}")`);

  this.theme = theme;
  this.states = this.bot[theme].states;
  this.currentState = stateKey;          // store full flattened key
  this.context.input = userInput;

  return await this._enterState(stateKey);
}


  // async _transition(target, userInput = null) {
  //   if (!target) return "";
  //   const stateName = target.replace(/^\.?\//, "");
  //   this.log(`Transitioning: ${this.currentState} → ${stateName} (input="${userInput}")`);
  //   this.currentState = stateName;
  //   this.context.input = userInput;
  //   return await this._enterState(stateName);
  // }
  // --- NEW: Execute tags in exact order and stop after go!: ---
  async _runStateSequentially(stateName) {
    const state = this.states[stateName];
    if (!state) return "";

    this.log(`Sequentially entering state: ${stateName}`);

    // Parser enhancement fallback: derive property order by index appearance
    // parser pushes multi-value keys like .scripts, .as, .go!s, so we reconstruct a timeline
    const orderedEntries = [];

    // preserve key creation order if parser supports it
    const rawEntries = state._rawOrder || [];

    if (rawEntries.length > 0) {
      for (const entry of rawEntries) {
        orderedEntries.push(entry); // already { key, value } if patched parser
      }
    } else {
      // backward compatible fallback (approximate order)
      for (const key of ['scripts', 'as', 'a', 'go!s', 'go!']) {
        if (state[key]) {
          for (const v of state[key]) {
            const type = key === 'as' ? 'a' : key.replace('s', '');
            orderedEntries.push({ type, value: v });
          }
        }
      }
    }

    let reply = "";

    for (const entry of orderedEntries) {
      const type = entry.type;
      const value = entry.value;

      switch (type) {
        case 'script':
          await this._executeScript(value);
          break;

        case 'a':
          reply += this._substituteVars(value) + "\n";
          break;

        case 'go!':
          this.log(`Instant go! transition → ${value}`);
          const nextReply = await this._transition(value);
          return (reply + "\n" + nextReply).trim(); // cutoff everything after
      }
    }

    // handle deferred transitions and buttons (only if go! not fired)
    if (state.go) {
      this.log("Deferred go transition →", state.go);
      const nextReply = await this._transition(state.go);
      reply += "\n" + nextReply;
    }

    if (state.buttons) {
      const buttons = this._parseButtons(state.buttons);
      if (buttons.length) {
        const buttonsText = buttons.map(b => `- ${b.label}`).join("\n");
        reply += `\n\nOptions:\n${buttonsText}`;
        this.log("Buttons displayed:", buttons.map(b => b.label));
      }
    }

    return reply.trim();
  }


  async _enterState(stateName, isInitial = false) {
    return await this._runStateSequentially(stateName);
  }  
  
}
