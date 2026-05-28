export function parseArgs(argv) {
  const options = {
    dryRun: false,
    home: process.env.HOME,
    manifestPath: undefined
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--home") {
      index += 1;
      options.home = requireValue(arg, argv[index]);
    } else if (arg.startsWith("--home=")) {
      options.home = arg.slice("--home=".length);
    } else if (arg === "--packages") {
      index += 1;
      options.manifestPath = requireValue(arg, argv[index]);
    } else if (arg.startsWith("--packages=")) {
      options.manifestPath = arg.slice("--packages=".length);
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function requireValue(flag, value) {
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}
