import { buildProduction } from "@factor/build/webpack-config"

import { generateLoaders } from "@factor/cli/extension-loader"
import * as tools from "@factor/api"
import commander from "commander"
import log from "@factor/api/logger"
import execa from "execa"
import { serverInfo } from "./util"
import { factorize, setEnvironment } from "./factorize"
import { CommandOptions } from "./types"
import pkg from "./package.json"
import LoadingBar from "./loading"
import { logSetupNeeded } from "./setup"
interface CommanderArguments {
  options: object[];
  parent: Record<string, any>;
  [key: string]: any;
}

/**
 * Opens the node inspector port
 * https://nodejs.org/api/inspector.html
 */
const initializeNodeInspector = async (): Promise<void> => {
  const inspector = require("inspector")
  inspector.close()
  await inspector.open()
}

/**
 * Serve Factor
 * @param setup - server options
 */
export const runServer = async (setup: CommandOptions): Promise<void> => {
  await tools.runCallbacks("create-server", setup)
}

/**
 * Runs a command entered in the CLI
 * @param options - command options
 */
export const runCommand = async (options: CommandOptions): Promise<void> => {
  const setup = {
    install: true,
    clean: true,
    NODE_ENV: options.command == "dev" ? "development" : "production",
    ...options
  }

  const { install, filter, command, inspect, NODE_ENV } = setup

  /**
   * Log initial server info
   */
  serverInfo({ NODE_ENV })

  const bar = new LoadingBar()

  await bar.update({ percent: 12, msg: "setting up" })

  /**
   * Make sure all package dependencies are installed and updated
   */
  if (install) {
    const ePath = process.env.npm_execpath
    const packageUtil = ePath && ePath.includes("yarn") ? "yarn" : "npm"
    await bar.update({ percent: 35, msg: `checking dependencies (${packageUtil})` })

    const verifyDepProcess = execa(packageUtil, ["install"])
    await verifyDepProcess
    await bar.update({ percent: 55, msg: "create files" })
    generateLoaders(setup)
  }

  /**
   * Open node inspector port if 'inspect' flag is set
   */
  if (command && inspect) {
    await initializeNodeInspector()
  }

  /**
   * Extend and setup Node server environment
   */

  await bar.update({ percent: 85, msg: "extending server" })
  await factorize(setup)
  await bar.update({ percent: 100, msg: "loaded" })
  bar.stop()
  logSetupNeeded(command)

  try {
    if (command && ["build", "start"].includes(command)) {
      await buildProduction(setup)
    } else if (command == "setup") {
      await tools.runCallbacks(`cli-setup`, setup)
    } else if (command == "run") {
      if (!filter) throw new Error("Filter argument is required.")

      await tools.runCallbacks(`cli-run-${filter}`, setup)

      log.success(`Successfully ran "${filter}"\n\n`)
    }

    if (command && ["start", "dev", "serve"].includes(command)) {
      await runServer(setup) // Long running process
    } else {
      if (command) log.success(`Successfully ran [${command}]`)
      // eslint-disable-next-line unicorn/no-process-exit
      process.exit(0)
    }
  } catch (error) {
    log.error(error)
  }

  return
}

/**
 * Clean up commanders provided arguments to just return needed CLI arguments
 * @library commander
 * @param commanderArguments - arguments provided by commander lib
 */
const cleanArguments = (commanderArguments: CommanderArguments): Record<string, any> => {
  const out: { [index: string]: any } = {}

  const { parent = {}, ...rest } = commanderArguments

  const flat = { ...parent, ...rest }

  // Remove all keys starting with Capital letters or underscore
  Object.keys(flat).forEach(k => {
    if (!k.startsWith("_") && !/[A-Z]/.test(k[0])) {
      out[k] = flat[k]
    }
  })

  return out
}

/**
 * Handle the CLI using Commander
 * Set up initial Node environment
 */
export const setup = (): void => {
  process.noDeprecation = true
  process.maxOldSpaceSize = 8192

  setEnvironment()

  // options added by filters, plugins or if not wanted in '--help'
  commander.allowUnknownOption(true)

  commander
    .version(pkg.version)
    .description("CLI for managing Factor data, builds and deployments")
    .option("--PORT <PORT>", "set server port. default: 3000")
    .option("--ENV <ENV>", "set FACTOR_ENV. default: NODE_ENV")
    .option("--restart", "restart server process flag")
    .option("--debug", "log debugging info")
    .option("--offline", "run in offline mode")
    .option("--inspect", "run node debug-mode inspector")

  commander
    .command("dev")
    .description("Start development server")
    .option("--static", "use static file system for builds instead of memory")
    .option("--server", "server development mode - restart the server on file changes")
    .action(_arguments => {
      runCommand({
        command: "dev",
        ...cleanArguments(_arguments),
        NODE_ENV: "development"
      })
    })

  commander
    .command("start")
    .description("Build and then serve production app.")
    .action(_arguments => runCommand({ command: "start", ...cleanArguments(_arguments) }))

  commander
    .command("serve [NODE_ENV]")
    .description("Serve app in selected environment.")
    .action((NODE_ENV, _arguments) =>
      runCommand({
        command: "serve",
        ...cleanArguments(_arguments),
        install: false,
        NODE_ENV
      })
    )

  commander
    .command("build")
    .option("--analyze", "Analyze package size")
    .option("--speed", "Output build speed data")
    .description("Build production app")
    .action(_arguments => runCommand({ command: "build", ...cleanArguments(_arguments) }))

  commander
    .command("setup [filter]")
    .description("Setup and verify your Factor app")
    .action((filter, _arguments) =>
      runCommand({
        command: "setup",
        filter,
        clean: false,
        ...cleanArguments(_arguments)
      })
    )

  commander
    .command("run <filter>")
    .description("Run CLI utilities based on filter name (see documentation)")
    .action((filter, _arguments) =>
      runCommand({
        command: "run",
        filter,
        install: false,
        ...cleanArguments(_arguments)
      })
    )

  commander
    .command("create-loaders")
    .option("--clean", "clean generated directories before creation")
    .description("Generate extension loaders")
    .action(_arguments => generateLoaders(cleanArguments(_arguments)))

  commander.parse(process.argv)
}

setup()
