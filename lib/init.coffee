{BufferedProcess, CompositeDisposable} = require 'atom'

module.exports =
  config:
    executablePath:
      type: 'string'
      title: 'Elixirc path'
      default: '/usr/local/bin/elixirc'

  activate: ->
    @subscriptions = new CompositeDisposable
    @subscriptions.add atom.config.observe 'linter-elixirc.executablePath',
      (executablePath) =>
        @executablePath = executablePath
  deactivate: ->
    @subscriptions.dispose()
  provideLinter: ->
    provider =
      grammarScopes: ['source.elixir']
      scope: 'file'
      lintOnFly: false
      name: 'Atom-Elixir'
      lint: (textEditor) =>
        return new Promise (resolve, reject) =>
          error_stack = []
          compile_result = ''
          helpers = require('atom-linter')
          os = require 'os'
          filePath = textEditor.getPath()
          project_path = atom.project.getPaths()
          build_env = "dev"
          elixirc_args = [
            "--ignore-module-conflict", "--app", "mix", "--app", "ex_unit", "-o", os.tmpDir(),
            filePath
          ]
          parse_row = (row) ->
            #console.log row
            return unless row.startsWith('** ')
            re = /.*\((.*)\) ([^:]+):(\d+): (.*)[\n\r]?/
            re_result = re.exec(row)
            ret =
              type: re_result[1]
              text: re_result[4]
              fp: filePath
              filePath: project_path[0] + '/' + re_result[2]
              range: helpers.rangeFromLineNumber(textEditor, re_result[3] - 1)
            #console.log ret
            error_stack.push ret
          process = new BufferedProcess
            command: @executablePath
            args: elixirc_args
            options:
              cwd: project_path[0]
            stdout: (data) ->
              compile_result += data
            stderr: (data) ->
              compile_result += data
            exit: (code) ->
              errors = compile_result.split("\n")
              parse_row error for error in errors unless !errors?
              resolve error_stack
          process.onWillThrowError ({error, handle}) ->
            atom.notifications.addError "Failed to run #{@executablePath}",
              detail: "#{error.message}"
              dismissable: true
            handle()
            resolve []
