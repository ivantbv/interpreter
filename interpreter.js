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
    this.bot = {}; // 👈 holds full parsed bot structure (by theme)
    this.currentState = "Start";
    this.debug = debug;
    this.sandbox = null;
    this._requestedTransition = null;

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
    const self = this; // Save interpreter context outside

    const sandbox = {
    $context: self.context,
    $client: self.context.client,
    $session: self.context.session,
    $request: self.context.request,
    $input: "",
    console,
    fetch,
    setTimeout,
    setInterval,
    clearTimeout,
    clearInterval,
    Date,
    Promise,
    $reactions: {
        transition: (arg) => {
          let target = null, deferred = false;
          if (typeof arg === "string") {
          target = arg;
          deferred = false;
          } else if (typeof arg === "object" && arg !== null) {
          target = arg.value || arg.path || "";
          deferred = !!arg.deferred;
          }
          if (target) self._setRequestedTransition(target, deferred);
          return Promise.resolve();
        },
        buttons: (arg) => {
          if (!self._scriptedButtons) self._scriptedButtons = [];
      
          const pushButton = (label, target) => {
            if (target) {
              // Resolve target to absolute theme+state path (flat)
              const resolved = self._resolveStatePath(target);
              if (!resolved || !resolved.state) {
                self.log(`[WARN] [reactions.buttons] Could not resolve target "${target}" relative to "${self.currentState}"`);
                self._scriptedButtons.push({ label, target: null });
                return;
              }
              // Compose normalized full path with theme + state for storage
              const normalized = this._normalizeResolvedPath(resolved) //`${resolved.theme}${resolved.state}`;
              self._scriptedButtons.push({ label, target: normalized });
              self.log(`[DEBUG] [reactions.buttons] Added button "${label}" → ${normalized}`);
            } else {
              self._scriptedButtons.push({ label, target: null });
              self.log(`[DEBUG] [reactions.buttons] Added button "${label}" (no target)`);
            }
          };
      
          if (typeof arg === "string") {
            pushButton(arg, null);
          } else if (Array.isArray(arg)) {
            for (const label of arg) pushButton(label, null);
          } else if (typeof arg === "object" && arg !== null) {
            if (arg.text) {
              pushButton(arg.text, arg.transition || null);
            } else if (arg.buttons) {
              for (const btn of arg.buttons) {
                pushButton(btn.text, btn.transition);
              }
            }
          }
      
          return Promise.resolve();
        },
        answer: (text) => {
          if (!self._scriptedAnswers) self._scriptedAnswers = [];
          const safe = typeof text === "string" ? text : String(text);
          self._scriptedAnswers.push(safe);
          self.log(`[DEBUG] [reactions.answer] Added scripted answer: "${safe}"`);
          return Promise.resolve();
        }
    }
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
  
    // 1. Find global q! matches NOT in current state
    let globalMatch = null;
    for (const [themeName, themeData] of Object.entries(this.bot)) {
      for (const [stateName, stateData] of Object.entries(themeData.states)) {
        if (stateData["q!"] && stateName !== this.currentState) {
          const regex = this._parseRegex(stateData["q!"]);
          if (regex && regex.test(message)) {
            this.log(`Global regex matched in theme "${themeName}", state "${stateName}":`, regex);
            globalMatch = `${themeName}${stateName}`;
          }
        }
      }
    }
  
    // 2. Button handling (EXPLICIT)
    const state = this._getCurrentState();
    // if (state["buttons"]) {
    //   const buttons = this._parseButtons(state["buttons"]);
    //   this.log("Available buttons:", buttons.map(b => b.label));
    //   const reply = this._handleButtonClick(message, buttons);
    //   if (reply) return reply;
    // }
    const staticButtons = state["buttons"]
    ? this._parseButtons(state["buttons"])
    : [];
    const reply = this._handleButtonClick(message, staticButtons);
    if (reply) return reply;
  
    // 3. Local q! in current state
    if (state["q!"]) {
      const regex = this._parseRegex(state["q!"]);
      if (regex && regex.test(message)) {
        // Predict if local transition leads to self
        const target = state["go"] || state["go!"];
        if (target) {
          const resolved = this._resolveStatePath(target);
          const nextStateKey = resolved && resolved.state;
          if (nextStateKey === this.currentState) {
            // Would loop to self—skip, prefer global q!
            this.log("Local q! would loop to self, skipping to global.");
          } else {
            this.log("Regex matched:", regex);
            return await this._transition(target);
          }
        } else {
          // No explicit target—would stay in same state; skip to global too.
          this.log("Local q! would loop (no explicit go), skipping to global.");
        }
      }
    }    
  
    // 4. Deferred go:
    if (state["go"]) {
      this.log("Deferred go transition to:", state["go"]);
      return await this._transition(state["go"], message);
    }
  
    // 5. Nested q: (children/siblings)
    const nestedMatch = this._findMatchingState(message);
    if (nestedMatch) {
      this.log(`Nested child state matched: ${nestedMatch}`);
      return await this._transition(nestedMatch, message);
    }
  
    // 6. If nothing else, trigger global q!
    if (globalMatch) {
      return await this._transition(globalMatch, message);
    }
  
    this.log("No match for message, staying in state:", this.currentState);
    return "I didn’t understand that. Please try again.";
  }  

  _setRequestedTransition(target, deferred = false) {
    if (!this._requestedTransition) {
      this._requestedTransition = { target, deferred };
    }
  }
  
  // Clear transition flag before each state entry
  _clearRequestedTransition() {
    this._requestedTransition = null;
  }

  _handleButtonClick(message, buttons) {
    const lowerMsg = message.toLowerCase();
  
    // Normalize static buttons' targets
    const normalizedStaticButtons = (buttons || []).map(b => {
      if (b.target) {
        const resolved = this._resolveStatePath(b.target);
        if (resolved && resolved.state) {
          const normalized = this._normalizeResolvedPath(resolved);
          return {
            label: b.label,
            target: normalized //`${resolved.theme}${resolved.state}`
          };
        }
      }
      return { label: b.label, target: null };
    });
  
    // Combine normalized static buttons + any dynamic ones from $reactions.buttons()
    const allButtons = [
      ...normalizedStaticButtons,
      ...(this._scriptedButtons || [])
    ];
  
    if (allButtons.length > 0) {
      this.log("[DEBUG] Available buttons (combined):", allButtons.map(b => `${b.label} → ${b.target || "null"}`));
    }
  
    const clicked = allButtons.find(b => b.label.toLowerCase() === lowerMsg);
    if (clicked) {
      this.log(`[DEBUG] Button clicked: "${clicked.label}" (target = ${clicked.target || "null"})`);
  
      // If button has a valid target → transition to it
      if (clicked.target) {
        this.log(`[DEBUG] Transitioning via button "${clicked.label}" → ${clicked.target}`);
        return this._transition(clicked.target, message);
      }
  
      // Otherwise, treat as a normal user message
      if (this._buttonRecursionGuard === message) {
        this.log(`[DEBUG] Prevented recursion loop for button "${message}"`);
        return null;
      }
  
      this._buttonRecursionGuard = message;
      this.log(`[DEBUG] Button "${message}" has no target — reinterpreting as message`);
      const result = this.handleMessage(message);
      this._buttonRecursionGuard = null;
      return result;
    }
  
    this.log(`[DEBUG] No button matched message "${message}"`);
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
   /**
 * Find a matching direct child state (not grandchildren) by checking "q" triggers.
 */
/**
 * Finds a matching q: among direct child OR sibling states (i.e. same parent) of parentPath.
 */
  _findMatchingState(input, parentPath = this.currentState) {
    const themeData = this.bot[this.theme];
    if (!themeData || !themeData.states) return null;

    // 1. Try direct children first
    const childPrefix = parentPath.endsWith("/") ? parentPath : parentPath + "/";

    for (const [stateName, stateData] of Object.entries(this.states)) {
      if (!stateName.startsWith(childPrefix)) continue;
      const rel = stateName.slice(childPrefix.length);
      if (!rel || rel.includes("/")) continue; // must be direct child
      if (stateData["q"]) {
        const q = String(stateData["q"]).trim();
        if (q === "*") return stateName;
        try {
          const regex = this._parseRegex(q);
          if (regex && regex.test(input)) return stateName;
        } catch (e) {}
      }
    }

    // 2. If no direct child matches, try siblings
    let parentPrefix;
    if (parentPath === "/" || parentPath === "") {
      parentPrefix = "/"; // root theme, top-level states
    } else {
      parentPrefix = parentPath.split("/").slice(0, -1).join("/");
      if (!parentPrefix) parentPrefix = "/";
    }
    const siblingPrefix = parentPrefix.endsWith("/") ? parentPrefix : parentPrefix + "/";

    for (const [stateName, stateData] of Object.entries(this.states)) {
      if (!stateName.startsWith(siblingPrefix)) continue;
      const rel = stateName.slice(siblingPrefix.length);
      if (!rel || rel.includes("/")) continue; // only direct siblings/roots
      if (stateName === parentPath) continue; // don't match self
      if (stateData["q"]) {
        const q = String(stateData["q"]).trim();
        if (q === "*") return stateName;
        try {
          const regex = this._parseRegex(q);
          if (regex && regex.test(input)) return stateName;
        } catch (e) {}
      }
    }

    return null;
  }
  // --- UPDATED: uses persistent sandbox ---
  async _executeScript(script) {
      try {
        if (!this.sandbox) throw new Error("Sandbox not initialized");
          this.sandbox.$context = this.context;
          this.sandbox.$client = this.context.client;
          this.sandbox.$session = this.context.session;
          this.sandbox.$request = this.context.request;
          this.sandbox.$input = this.context.input || "";
          
          const wrapped = `(async () => { ${script} })()`;
          return await vm.runInContext(wrapped, this.sandbox, { timeout: 20000 });
        
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

      sandbox.$reactions = {
        transition: (arg) => {
          // Usage: $reactions.transition("/Welcome") OR $reactions.transition({value:"/Welcome", deferred:true/false})
          let target = null, deferred = false;
          if (typeof arg === "string") {
            target = arg;
            deferred = false;
          } else if (typeof arg === "object" && arg !== null) {
            target = arg.value || arg.path || "";
            deferred = !!arg.deferred;
          }
          if (target) this._setRequestedTransition(target, deferred);
          return Promise.resolve();
        }
        // Optionally add aliases: go, go!
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
    let themeKey = this.theme.startsWith("/") ? this.theme : "/" + this.theme;
  
    // Up N levels ONLY (e.g. "..", "../..", "../../..")
    if (/^(\.\.\/?)+$/.test(target)) {
      const upCount = target.split("/").filter(s => s === "..").length;
      let pieces = currentFull.slice(1).split("/").filter(Boolean);
      pieces = pieces.slice(0, Math.max(0, pieces.length - upCount));
      return { theme: themeKey, state: "/" + pieces.join("/") };
    }
  
    // Starts with .. and then child (e.g. "../child", "../../other")
    if (/^((\.\.)\/)+.+/.test(target)) {
      const segments = target.split("/");
      let upCount = 0;
      while (segments[upCount] === "..") upCount++;
      let pieces = currentFull.slice(1).split("/").filter(Boolean);
      pieces = pieces.slice(0, Math.max(0, pieces.length - upCount));
      if (segments.length > upCount) {
        pieces = pieces.concat(segments.slice(upCount));
      }
      return { theme: themeKey, state: "/" + pieces.join("/") };
    }
  
    // "./child" -- go to direct child state from current
    if (target.startsWith("./")) {
      const child = target.slice(2);
      return { theme: themeKey, state: currentFull + "/" + child };
    }
  
    // "child" or "SomeState"
    if (/^[^.\/][^\/]*$/.test(target)) {
      return { theme: themeKey, state: currentFull + "/" + target };
    }
  
    // Absolute path
    if (target.startsWith("/")) {
      // (...leave your absolute logic unchanged...)
      const parts = target.slice(1).split("/").filter(Boolean);
      if (parts.length === 1) {
        if (this.bot["/"] && this.bot["/"].states["/" + parts[0]]) {
          return { theme: "/", state: "/" + parts[0] };
        }
        if (this.bot[this.theme] && this.bot[this.theme].states["/" + parts[0]]) {
          return { theme: this.theme, state: "/" + parts[0] };
        }
      } else if (parts.length > 1) {
        const candidateTheme = "/" + parts[0];
        if (this.bot[candidateTheme]) {
          return { theme: candidateTheme, state: "/" + parts.slice(1).join("/") };
        }
        const rootState = "/" + parts.join("/");
        if (this.bot["/"] && this.bot["/"].states[rootState]) {
          return { theme: "/", state: rootState };
        }
        if (this.bot[this.theme] && this.bot[this.theme].states[rootState]) {
          return { theme: this.theme, state: rootState };
        }
      }
      return { theme: this.theme, state: "/" + parts.join("/") };
    }
  
    // fallback
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
  
  _normalizeResolvedPath(resolved) {
    return resolved.theme === "/" ? resolved.state : `${resolved.theme}${resolved.state}`;
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
  
    this._clearRequestedTransition(); // Reset for each state entry
    this._scriptedButtons = [];

    // Use parser's _rawOrder for real tag order
    const orderedEntries = state._rawOrder || [];
  
    let reply = "";
    let goTriggered = false;
  
    for (const entry of orderedEntries) {
      if (goTriggered) break;
      const { type, value } = entry;
  
      // CLEAR answer buffer for **each tag**
      this._scriptedAnswers = [];
  
      switch (type) {
        case 'script':
          await this._executeScript(value);

          // ... handle $reactions.transition ...
          if (this._requestedTransition && !this._requestedTransition.deferred) {
            goTriggered = true;
            const target = this._requestedTransition.target;
            this.log(`[reactions] Instant transition → ${target}`);
            this._clearRequestedTransition();
            const nextReply = await this._transition(target);
            return (reply + "\n" + nextReply).trim();
          }
          // Append any $reactions.answer(s) emitted DURING this script
          if (this._scriptedAnswers && this._scriptedAnswers.length > 0) {
            this.log(`[DEBUG] Injecting ${this._scriptedAnswers.length} scripted answers into output (from current script tag)`);
            reply += this._scriptedAnswers.join("\n") + "\n";
          }
          this._scriptedAnswers = [];
          break;
  
        case 'a':
          reply += this._substituteVars(value) + "\n";
          break;
  
        case 'go!':
          goTriggered = true;
          this.log(`Instant go! transition → ${value}`);
          this._clearRequestedTransition();
          const nextReply = await this._transition(value);
          return (reply + "\n" + nextReply).trim();
      }
      // Append any $reactions.answer(s) emitted DURING other tag types (if you support that)
      if (this._scriptedAnswers && this._scriptedAnswers.length > 0) {
        this.log(`[DEBUG] Injecting ${this._scriptedAnswers.length} scripted answers into output (from non-script tag)`);
        reply += this._scriptedAnswers.join("\n") + "\n";
        this._scriptedAnswers = [];
      }
    }
  
    // Handle deferred transitions from script (after all tags)
    if (this._requestedTransition && this._requestedTransition.deferred) {
      const target = this._requestedTransition.target;
      this.log(`[reactions] Deferred transition → ${target}`);
      this._clearRequestedTransition();
      const nextReply = await this._transition(target);
      reply += "\n" + nextReply;
    }
  
    // Standard go: (deferred)
    if (state.go) {
      this.log("Deferred go transition →", state.go);
      const nextReply = await this._transition(state.go);
      reply += "\n" + nextReply;
    }
  
    // Buttons
// Merge scripted buttons and static tag buttons
  const tagButtons = state.buttons ? this._parseButtons(state.buttons) : [];
  const combinedButtons = this._scriptedButtons.concat(tagButtons);

  if (combinedButtons.length) {
    const buttonsText = combinedButtons.map(b => `${b.label}`).join("\n");
    reply += `\n\nOptions:\n${buttonsText}`;
    this.log("Buttons displayed:", combinedButtons.map(b => b.label));
  }
  
    return reply.trim();
  }  


  async _enterState(stateName, isInitial = false) {
    return await this._runStateSequentially(stateName);
  }  
  
}
