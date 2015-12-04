{BufferedProcess, CompositeDisposable} = require 'atom'

module.exports =
  config:
    elixircPath:
      type: 'string'
      title: 'Elixirc path'
      default: 'elixirc'
    mixPath:
      type: 'string'
      title: 'Mix path'
      default: 'mix'
    forceElixirc:
      type: 'boolean'
      title: 'Always use elixirc'
      description: 'Activating this will force plugin to never use `mix compile` and always use `elixirc`.'
      default: false

  activate: ->
    require('atom-package-deps').install('linter-elixirc')
    @subscriptions = new CompositeDisposable
    @subscriptions.add atom.config.observe 'linter-elixirc.elixircPath',
      (elixircPath) =>
        @elixircPath = elixircPath
    @subscriptions.add atom.config.observe 'linter-elixirc.mixPath',
      (mixPath) =>
        @mixPath = mixPath
    @subscriptions.add atom.config.observe 'linter-elixirc.forceElixirc',
      (forceElixirc) =>
        @forceElixirc = forceElixirc
  deactivate: ->
    @subscriptions.dispose()
  provideLinter: ->
    helpers = require('atom-linter')
    os = require 'os'
    fs = require 'fs'
    path = require 'path'
    projectPath = ->
      atom.project.getPaths()[0]
    isMixProject = ->
      fs.existsSync(projectPath() + '/mix.exs')
    isTestFile = (textEditor) ->
      relativePath = path.relative(projectPath(), textEditor.getPath())
      relativePath.split(path.sep)[0] == 'test'
    isForcedElixirc = =>
      @forceElixirc
    isExsFile = (textEditor) ->
      textEditor.getPath().endsWith('.exs')
    parseError = (row, textEditor) ->
      return unless row.startsWith('** ')
      re = ///
        .*
        \((.*)\)  # 1 - (TypeOfError)
        \ ([^:]+) # 2 - file name
        :(\d+):   # 3 - line
        \ (.*)    # 4 - message
        ///
      reResult = re.exec(row)
      return unless reResult?
      ret =
        #type: reResult[1]
        type: "Error"
        text: reResult[4]
        filePath: projectPath() + '/' + reResult[2]
        range: helpers.rangeFromLineNumber(textEditor, reResult[3] - 1)
    parseWarning = (row, textEditor) ->
      re = ///
        ([^:]*) # 1 - file name
        :(\d+)  # 2 - line
        :\ warning
        :\ (.*) # 3 - message
        ///
      reResult = re.exec(row)
      return unless reResult?
      ret =
        type: "Warning"
        text: reResult[3]
        filePath: projectPath() + '/' + reResult[1]
        range: helpers.rangeFromLineNumber(textEditor, reResult[2] - 1)
    handleResult = (textEditor) ->
      (compileResult) ->
        resultString = compileResult['stdout'] + "\n" + compileResult['stderr']
        resultLines = resultString.split("\n")
        errorStack = (parseError(line, textEditor) for line in resultLines unless !resultLines?)
        warningStack = (parseWarning(line, textEditor) for line in resultLines unless !resultLines?)
        (error for error in errorStack.concat(warningStack) when error?)
    getFilePathDir = (textEditor) ->
      filePath = textEditor.getPath()
      path.dirname(filePath)
    getOpts = ->
      opts =
        cwd: projectPath()
        throwOnStdErr: false
        stream: 'both'
    getDepsPa = (textEditor) ->
      env = if isTestFile(textEditor) then "test" else "dev"
      buildDir = path.join("_build", env, "lib")
      fs.readdirSync(path.join(projectPath(), buildDir)).map (item) ->
        path.join(projectPath(), buildDir, item, "ebin")
    lintElixirc = (textEditor) =>
      elixircArgs = [
        "--ignore-module-conflict", "--app", "mix", "--app", "ex_unit", "-o", os.tmpDir(),
      ]
      elixircArgs.push "-pa", item for item in getDepsPa(textEditor)
      elixircArgs.push textEditor.getPath()
      helpers.exec(@elixircPath, elixircArgs, getOpts())
        .then(handleResult(textEditor))
    lintMix = (textEditor) =>
      helpers.exec(@mixPath, ['compile'], getOpts())
        .then (handleResult(textEditor))

    provider =
      grammarScopes: ['source.elixir']
      scope: 'file'
      lintOnFly: false
      name: 'Elixir'
      lint: (textEditor) =>
        if isForcedElixirc() or not isMixProject() or isExsFile(textEditor)
          lintElixirc(textEditor)
        else
          lintMix(textEditor)
