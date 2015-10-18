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
    path = require 'path'
    provider =
      grammarScopes: ['source.elixir']
      scope: 'file'
      lintOnFly: false
      name: 'Elixir'
      lint: (textEditor) =>
        filePath = textEditor.getPath()
        filePathDir = path.dirname(filePath)
        elixirc_args = [
          "--ignore-module-conflict", "--app", "mix", "--app", "ex_unit", "-o", os.tmpDir(),
          filePath
        ]
        opts =
          cwd: filePathDir
        parse_row = (row) ->
          return unless row.startsWith('** ')
          re = /.*\((.*)\) ([^:]+):(\d+): (.*)[\n\r]?/
          re_result = re.exec(row)
          ret =
            #type: re_result[1]
            type: "Error"
            text: re_result[4]
            filePath: filePathDir + '/' + re_result[2]
            range: helpers.rangeFromLineNumber(textEditor, re_result[3] - 1)
        helpers.exec(@executablePath, elixirc_args, opts)
          .then (compile_result) ->
            result_lines = compile_result.split("\n")
            error_stack = (parse_row(line) for line in result_lines unless !result_lines?)
            (error for error in error_stack when error?)
