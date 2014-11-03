os = require 'os'
{exec, child} = require 'child_process'
{Range, Point, BufferedProcess} = require 'atom'
linterPath = atom.packages.getLoadedPackage("linter").path
Linter = require "#{linterPath}/lib/linter"

class LinterElixirc extends Linter
  @syntax: 'source.elixir'
  defaultLevel: 'error'
  cmd: ['elixirc', "--ignore-module-conflict", "--app", "mix", "--app", "ex_unit", "-o", os.tmpDir()]
  linterName: 'elixirc'
  cwd: atom.project.path
  regex: '.*\\(?(?<error>.*)?\\)?.?(?<file>.*):(?<line>\\d+):\\s*(?<warning>warning)?:?\\s*(?<message>.+)[\\n\\r]'

  constructor: (editor) ->
    super(editor)
    atom.config.observe 'linter-elixirc.elixircExecutablePath', =>
      @executablePath = atom.config.get 'linter-elixirc.elixircExecutablePath'

  destroy: ->
    atom.config.unobserve 'linter-elixirc.elixircExecutablePath'

  lintFile: (filePath, callback) ->
    {command, args} = @getCmdAndArgs(filePath)

    pa = atom.config.get 'linter-elixirc.pa'
    for path in pa.split(",").map((x) -> x.trim()).filter((x) -> x)
      args.push("-pa")
      args.push(path)

    includeDirs = atom.config.get 'linter-elixirc.includeDirs'
    for path in includeDirs.split(",").map((x) -> x.trim()).filter((x) -> x)
      args.push("-I")
      args.push(path)

    build_env = process.env["MIX_ENV"] || "dev"
    process.env["ERL_LIBS"] = atom.project.path+"/_build/"+build_env+"/lib/"

    # options for BufferedProcess, same syntax with child_process.spawn
    options = { cwd: @cwd }

    # We need to redefine this as warns come on stderr but errs on stdout
    dataStdAll = []
    stdout = stderr = (output) ->
      if atom.config.get 'linter.lintDebug'
        console.log(output)
      dataStdAll += output

    exit = =>
      @processMessage dataStdAll, callback

    proc = new BufferedProcess({command, args, options,
                                  stdout, stderr, exit})

    # Don't block UI more than 5seconds, it's really annoying on big files
    timeout_s = 5
    setTimeout ->
      proc.kill()
    , timeout_s * 1000

module.exports = LinterElixirc
