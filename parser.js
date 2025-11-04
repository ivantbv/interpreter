import fs from "fs";

export function parseBotFile(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").split("\n");

  const bot = {};
  let currentTheme = null;
  let currentKey = null;
  let buffer = [];

  const stateStack = [];

  function commitBuffer() {
    if (!currentTheme || !stateStack.length || !currentKey) return;
    const value = buffer.join("\n").trimEnd();
    const currentState = stateStack[stateStack.length - 1].obj;

    if (value) {
      if (currentKey === "a" || currentKey === "script") {
        if (!currentState[currentKey + "s"]) currentState[currentKey + "s"] = [];
        currentState[currentKey + "s"].push(value);
      } else {
        currentState[currentKey] = value;
      }
    }

    buffer = [];
    currentKey = null;
  }

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].replace(/\r$/, "");
    const indent = rawLine.match(/^\s*/)[0].length;
    const trimmed = rawLine.trim();

    if (!trimmed) continue;

    // === THEME ===
    if (trimmed.startsWith("theme:")) {
      commitBuffer();
      currentTheme = trimmed.split(":")[1].trim() || "/";
      bot[currentTheme] = { states: {} };
      stateStack.length = 0;
      continue;
    }

    // === STATE ===
    if (trimmed.startsWith("state:")) {
      commitBuffer();
      const stateName = trimmed.split(":")[1].trim();

      while (stateStack.length && indent <= stateStack[stateStack.length - 1].indent) {
        stateStack.pop();
      }

      const stateObj = {};
      let fullPath;

      if (stateStack.length > 0) {
        const parentState = stateStack[stateStack.length - 1].obj;
        if (!parentState.children) parentState.children = {};
        parentState.children[stateName] = stateObj;
        fullPath = `${parentState._path}/${stateName}`.replace(/\/+/g, "/");
      } else {
        fullPath = `/${stateName}`.replace(/\/+/g, "/");
      }

      stateObj._path = fullPath;
      bot[currentTheme].states[fullPath] = stateObj;
      stateStack.push({ name: stateName, indent, obj: stateObj });
      continue;
    }

    // === SCRIPT BLOCK ===
    if (trimmed.startsWith("script:")) {
      commitBuffer();
      currentKey = "script";
      const scriptIndent = indent;

      const scriptLines = [];
      i++;
      while (i < lines.length) {
        const nextLine = lines[i];
        if (!nextLine.trim()) {
          scriptLines.push(""); // preserve blank lines
          i++;
          continue;
        }

        const nextIndent = nextLine.match(/^\s*/)[0].length;
        if (nextIndent <= scriptIndent) break; // dedented => block end

        // Keep literal line, only strip the first scriptIndent spaces
        scriptLines.push(nextLine.slice(scriptIndent));
        i++;
      }
      i--; // step back to reprocess this line in outer loop

      //const scriptText = scriptLines.join("\n");

      const scriptText = ";" + scriptLines.join("\n") + ";\n"; // Add trailing semicolon for safety
      //const scriptText = ";" + scriptLines.join("\n"); // ← add leading semicolon
      //const scriptText = ";" + scriptLines.join(";\n") + ";";

      const currentState = stateStack[stateStack.length - 1]?.obj;
      if (currentState) {
        if (!currentState.scripts) currentState.scripts = [];
        currentState.scripts.push(scriptText);
      }

      currentKey = null;
      continue;
    }

    // === BUTTONS BLOCK ===
    if (trimmed.startsWith("buttons:")) {
      commitBuffer();
      currentKey = "buttons";
      continue;
    }

    if (currentKey === "buttons") {
      const parentIndent = stateStack[stateStack.length - 1].indent;
      if (indent <= parentIndent) {
        commitBuffer();
        currentKey = null;
      } else {
        buffer.push(trimmed);
        continue;
      }
    }

    // === KEY:VALUE ===
    const match = trimmed.match(/^([a-zA-Z!]+):\s*(.*)$/);
    if (match) {
      commitBuffer();
      const [, key, rest] = match;
      currentKey = key;
      const currentState = stateStack[stateStack.length - 1]?.obj;
      if (!currentState) continue;

      if (rest) {
        const value = rest.trim();
        if (["a", "script", "go", "go!"].includes(key)) {
          if (!currentState[key + "s"]) currentState[key + "s"] = [];
          currentState[key + "s"].push(value);
        } else {
          currentState[key] = value;
        }
        currentKey = null;
      }
      continue;
    }

    // === MULTILINE CONTINUATION ===
    if (currentKey && (indent >= 4 || rawLine.startsWith("\t"))) {
      buffer.push(rawLine.replace(/^\s{4}|\t/, ""));
      continue;
    }

    if (currentKey) {
      commitBuffer();
    }
  }

  commitBuffer();
  return bot;
}
