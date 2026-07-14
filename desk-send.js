#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const axios = require("axios");

const DEFAULT_CONFIG = {
  envFile: ".env",
  envUrlKey: "DESK_API_URL",
  envTokenKey: "DESK_API_TOKEN",
  timeoutMs: 30000,
  headers: {
    "Content-Type": "application/json"
  }
};

const COMMANDS = {
  SEND: "send"
};

if (require.main === module) {
  main(process.argv.slice(2));
}

async function main(argv) {

  try {

    const parsed = parseCommand(argv);
    const configuration = loadConfiguration(parsed.args);
    const input = loadInput(parsed);
    const payload = buildPayload(configuration, input);

    validatePayload(payload);

    const result = await sendUpdate(configuration, payload);

    printResult(result);

    return result;

  } catch (err) {

    printError(err);
    process.exit(1);

  }

}

function parseCommand(argv) {

  const command = argv[0] && !argv[0].startsWith("--")
    ? argv[0]
    : COMMANDS.SEND;

  if (command === COMMANDS.SEND) {
    return {
      command: COMMANDS.SEND,
      args: parseArgs(command === argv[0] ? argv.slice(1) : argv)
    };
  }

  if (isJsonFile(command)) {
    return {
      command: COMMANDS.SEND,
      args: {
        _: [command],
        inputFile: command
      }
    };
  }

  throw new Error("Comando non riconosciuto: " + command);

}

function loadConfiguration(args, defaults) {

  const config = Object.assign({}, DEFAULT_CONFIG, defaults || {});

  loadEnv(config.envFile);

  return {
    url: args.url || process.env[config.envUrlKey],
    token: args.token || process.env[config.envTokenKey],
    timeoutMs: Number(args.timeout || config.timeoutMs),
    headers: config.headers
  };

}

function loadInput(parsed) {

  const fileInput = parsed.args.inputFile
    ? loadJsonFile(parsed.args.inputFile)
    : {};

  return Object.assign({}, fileInput, cliInput(parsed.args));

}

function buildPayload(configuration, input) {

  return {
    token: configuration.token,
    projectName: input.projectName,
    data: {
      summary: input.summary || "",
      focus: input.focus || "",
      nextAction: input.nextAction || "",
      status: input.status || "",
      newTasks: normalizeArray(input.newTasks),
      completedTasks: normalizeArray(input.completedTasks),
      timelineEvent: input.timelineEvent || ""
    }
  };

}

function validatePayload(payload) {

  if (!payload.token) {
    throw new Error("Token mancante. Usa --token oppure DESK_API_TOKEN in .env.");
  }

  if (!payload.projectName) {
    throw new Error("projectName mancante. Usa --projectName o un file JSON.");
  }

  if (!Array.isArray(payload.data.newTasks)) {
    throw new Error("newTasks deve essere un array.");
  }

  if (!Array.isArray(payload.data.completedTasks)) {
    throw new Error("completedTasks deve essere un array.");
  }

  return true;

}

async function sendUpdate(configuration, payload) {

  if (!configuration.url) {
    throw new Error("URL mancante. Usa --url oppure DESK_API_URL in .env.");
  }

  const response = await axios.post(configuration.url, payload, {
    headers: configuration.headers,
    timeout: configuration.timeoutMs
  });

  return response.data;

}

function printResult(result) {
  console.log(JSON.stringify(result, null, 2));
}

function printError(err) {

  if (err.response) {
    console.error(JSON.stringify(err.response.data, null, 2));
    return;
  }

  console.error("Errore: " + err.message);

}

function parseArgs(argv) {

  const result = {
    _: []
  };

  for (let i = 0; i < argv.length; i++) {

    const item = argv[i];

    if (!item.startsWith("--")) {
      result._.push(item);

      if (!result.inputFile && isJsonFile(item)) {
        result.inputFile = item;
      }

      continue;
    }

    const key = item.slice(2);
    const next = argv[i + 1];

    if (!next || next.startsWith("--")) {
      result[key] = true;
      continue;
    }

    result[key] = next;
    i++;

  }

  return result;

}

function cliInput(args) {

  const input = {};
  const keys = [
    "projectName",
    "summary",
    "focus",
    "nextAction",
    "status",
    "timelineEvent"
  ];

  keys.forEach(key => {
    if (args[key] !== undefined) {
      input[key] = args[key];
    }
  });

  if (args.newTasks !== undefined) {
    input.newTasks = args.newTasks;
  }

  if (args.completedTasks !== undefined) {
    input.completedTasks = args.completedTasks;
  }

  return input;

}

function normalizeArray(value) {

  if (Array.isArray(value)) {
    return value;
  }

  if (!value) {
    return [];
  }

  try {

    const parsed = JSON.parse(value);

    if (Array.isArray(parsed)) {
      return parsed;
    }

  } catch (err) {
    // Fall back to semicolon-separated values.
  }

  return String(value)
    .split(";")
    .map(item => item.trim())
    .filter(Boolean);

}

function loadJsonFile(filePath) {

  const resolvedPath = path.resolve(process.cwd(), filePath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error("File input non trovato: " + filePath);
  }

  try {
    return JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  } catch (err) {
    throw new Error("JSON non valido in " + filePath + ": " + err.message);
  }

}

function loadEnv(envFile) {

  const envPath = path.join(process.cwd(), envFile || DEFAULT_CONFIG.envFile);

  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

  lines.forEach(line => {

    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const separator = trimmed.indexOf("=");

    if (separator === -1) {
      return;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();

    if (key && process.env[key] === undefined) {
      process.env[key] = unquote(value);
    }

  });

}

function unquote(value) {

  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;

}

function isJsonFile(value) {
  return /\.json$/i.test(String(value || ""));
}

module.exports = {
  DEFAULT_CONFIG,
  COMMANDS,
  main,
  parseCommand,
  loadConfiguration,
  loadInput,
  buildPayload,
  validatePayload,
  sendUpdate,
  printResult,
  printError,
  parseArgs,
  cliInput,
  normalizeArray,
  loadJsonFile,
  loadEnv
};
