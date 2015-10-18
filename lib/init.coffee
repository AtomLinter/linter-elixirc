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
    helpers = require('atom-linter')
    os = require 'os'
    provider =
      grammarScopes: ['source.elixir']
      scope: 'file'
      lintOnFly: false
      name: 'Elixir'
      lint: (textEditor) =>
        filePath = textEditor.getPath()
        elixirc_args = [
          "--ignore-module-conflict", "--app", "mix", "--app", "ex_unit", "-o", os.tmpDir(),
          filePath
        ]
        project_path = atom.project.getPaths()
        opts =
          cwd: project_path[0]
        helpers.exec(@executablePath, elixirc_args, opts)
          .then (compile_result) ->
            error_stack = []
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
            errors = compile_result.split("\n")
            parse_row error for error in errors unless !errors?
            error_stack
