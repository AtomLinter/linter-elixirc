{BufferedProcess, CompositeDisposable} = require 'atom'

module.exports =
  config:
    executablePath:
      type: 'string'
      title: 'Elixirc path'
      default: 'elixirc'

  activate: ->
    require('atom-package-deps').install('linter-elixirc')
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
          throwOnStdErr: false
          stream: 'both'
        parse_error = (row) ->
          return unless row.startsWith('** ')
          re = ///
            .*
            \((.*)\)  # 1 - (TypeOfError)
            \ ([^:]+) # 2 - file name
            :(\d+):   # 3 - line
            \ (.*)    # 4 - message
            ///
          re_result = re.exec(row)
          ret =
            #type: re_result[1]
            type: "Error"
            text: re_result[4]
            filePath: filePathDir + '/' + re_result[2]
            range: helpers.rangeFromLineNumber(textEditor, re_result[3] - 1)
        parse_warning = (row) ->
          re = ///
            ([^:]*) # 1 - file name
            :(\d+)  # 2 - line
            :\ warning
            :\ (.*) # 3 - message
            ///
          re_result = re.exec(row)
          return unless re_result?
          ret =
            type: "Warning"
            text: re_result[3]
            filePath: filePathDir + '/' + re_result[1]
            range: helpers.rangeFromLineNumber(textEditor, re_result[2] - 1)
        helpers.exec(@executablePath, elixirc_args, opts)
          .then (compile_result) ->
            result_string = compile_result['stdout'] + "\n" + compile_result['stderr']
            result_lines = result_string.split("\n")
            error_stack = (parse_error(line) for line in result_lines unless !result_lines?)
            warning_stack = (parse_warning(line) for line in result_lines unless !result_lines?)
            (error for error in error_stack.concat(warning_stack) when error?)
