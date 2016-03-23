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
      description: 'Activating this will force the plugin to never use ' +
        '`mix compile` and always use `elixirc`.'
      default: false

  activate: ->
    require('atom-package-deps').install()
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
    helpers = require 'atom-linter'
    os = require 'os'
    fs = require 'fs'
    path = require 'path'

    projectPath = (textEditor) ->
      editorPath = textEditor.getPath()
      projPath = atom.project.relativizePath(editorPath)[0]
      if projPath?
        return projPath
      null

    isMixProject = (textEditor) ->
      project = projectPath(textEditor)
      return false if not project
      return fs.existsSync(path.join(project, 'mix.exs'))

    isTestFile = (textEditor) ->
      project = projectPath(textEditor)
      return false if not project
      relativePath = path.relative(project, textEditor.getPath())
      relativePath.split(path.sep)[0] == 'test'

    isForcedElixirc = =>
      @forceElixirc

    isExsFile = (textEditor) ->
      textEditor.getPath().endsWith('.exs')

    isPhoenixProject = (textEditor) ->
      project = projectPath(textEditor)
      return false if not project
      mixLockPath = path.join(project, 'mix.lock')
      try
        mixLockContent = fs.readFileSync mixLockPath, 'utf-8'
        mixLockContent.indexOf('"phoenix"') > 0
      catch
        false

    parseError = (toParse, textEditor) ->
      ret = []
      re = ///
        \*\*.*
        (\((.*)\)         # 1 - Full message + 2 - (TypeOfError)
        \s(.+))           # 3 - Message
        [\r\n]{1,2}(?:.+) # Internal elixir code
        \s+(.+)           # 4 - File
        :(\d+):           # 5 - Line
        ///g
      reResult = re.exec(toParse)
      while reResult?
        ret.push
          type: "Error"
          text: reResult[1]
          filePath: path.join(projectPath(textEditor), reResult[4])
          range: helpers.rangeFromLineNumber(textEditor, reResult[5] - 1)
        reResult = re.exec(toParse)
      ret

    parseWarning = (toParse, textEditor) ->
      ret = []
      re = ///
        ([^:]*) # 1 - File name
        :(\d+)  # 2 - Line
        :\ warning
        :\ (.*) # 3 - Message
        ///g
      reResult = re.exec(toParse)
      while reResult?
        ret.push
          type: "Warning"
          text: reResult[3]
          filePath: projectPath(textEditor) + '/' + reResult[1]
          range: helpers.rangeFromLineNumber(textEditor, reResult[2] - 1)
        reResult = re.exec(toParse)
      ret

    handleResult = (textEditor) ->
      (compileResult) ->
        resultString = compileResult['stdout'] + "\n" + compileResult['stderr']
        errorStack = parseError(resultString, textEditor)
        warningStack = parseWarning(resultString, textEditor)
        (error for error in errorStack.concat(warningStack) when error?)

    getFilePathDir = (textEditor) ->
      filePath = textEditor.getPath()
      path.dirname(filePath)

    getOpts = (textEditor) ->
      opts =
        cwd: projectPath(textEditor)
        throwOnStdErr: false
        stream: 'both'

    getDepsPa = (textEditor) ->
      env = if isTestFile(textEditor) then "test" else "dev"
      buildDir = path.join("_build", env, "lib")
      try
        fs.readdirSync(path.join(projectPath(textEditor), buildDir)).map (item) ->
          path.join(projectPath(textEditor), buildDir, item, "ebin")
      catch e
        []

    lintElixirc = (textEditor) =>
      elixircArgs = [
        "--ignore-module-conflict",
        "--app", "mix",
        "--app", "ex_unit",
        "-o", os.tmpDir(),
      ]
      elixircArgs.push "-pa", item for item in getDepsPa(textEditor)
      elixircArgs.push textEditor.getPath()
      helpers.exec(@elixircPath, elixircArgs, getOpts(textEditor))
        .then(handleResult(textEditor))

    lintMix = (textEditor) =>
      helpers.exec(@mixPath, ['compile'], getOpts(textEditor))
        .then (handleResult(textEditor))

    provider =
      grammarScopes: ['source.elixir']
      scope: 'project'
      lintOnFly: false
      name: 'Elixir'
      lint: (textEditor) ->
        if isForcedElixirc() or not isMixProject(textEditor) or
          isExsFile(textEditor) or isPhoenixProject(textEditor)
            lintElixirc(textEditor)
        else
          lintMix(textEditor)
