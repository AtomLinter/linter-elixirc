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

  activate: ->
    require('atom-package-deps').install('linter-elixirc')
    @subscriptions = new CompositeDisposable
    @subscriptions.add atom.config.observe 'linter-elixirc.elixircPath',
      (elixircPath) =>
        @elixircPath = elixircPath
    @subscriptions.add atom.config.observe 'linter-elixirc.mixPath',
      (mixPath) =>
        @mixPath = mixPath
  deactivate: ->
    @subscriptions.dispose()
  provideLinter: ->
    helpers = require('atom-linter')
    os = require 'os'
    fs = require 'fs'
    path = require 'path'
    project_path = ->
      atom.project.getPaths()[0]
    is_mix_project = ->
      fs.existsSync(project_path() + '/mix.exs')
    parse_error = (row, textEditor) ->
      return unless row.startsWith('** ')
      re = ///
        .*
        \((.*)\)  # 1 - (TypeOfError)
        \ ([^:]+) # 2 - file name
        :(\d+):   # 3 - line
        \ (.*)    # 4 - message
        ///
      re_result = re.exec(row)
      return unless re_result?
      ret =
        #type: re_result[1]
        type: "Error"
        text: re_result[4]
        filePath: project_path() + '/' + re_result[2]
        range: helpers.rangeFromLineNumber(textEditor, re_result[3] - 1)
    parse_warning = (row, textEditor) ->
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
        filePath: project_path() + '/' + re_result[1]
        range: helpers.rangeFromLineNumber(textEditor, re_result[2] - 1)
    handle_result = (textEditor) ->
      (compile_result) ->
        result_string = compile_result['stdout'] + "\n" + compile_result['stderr']
        result_lines = result_string.split("\n")
        error_stack = (parse_error(line, textEditor) for line in result_lines unless !result_lines?)
        warning_stack = (parse_warning(line, textEditor) for line in result_lines unless !result_lines?)
        (error for error in error_stack.concat(warning_stack) when error?)
    getFilePathDir = (textEditor) ->
      filePath = textEditor.getPath()
      path.dirname(filePath)
    getOpts = ->
      opts =
        cwd: project_path()
        throwOnStdErr: false
        stream: 'both'

    provider_for_elixirc =
      grammarScopes: ['source.elixir']
      scope: 'file'
      lintOnFly: false
      name: 'Elixir-elixirc'
      lint: (textEditor) =>
        elixirc_args = [
          "--ignore-module-conflict", "--app", "mix", "--app", "ex_unit", "-o", os.tmpDir(),
          getFilePathDir(textEditor)
        ]
        helpers.exec(@elixircPath, elixirc_args, getOpts())
          .then(handle_result(textEditor))
    provider_for_mix =
      grammarScopes: ['source.elixir']
      scope: 'file'
      lintOnFly: false
      name: 'Elixir-Mix'
      lint: (textEditor) =>
        helpers.exec(@mixPath, ['compile'], getOpts())
          .then (handle_result(textEditor))
    if is_mix_project()
      provider_for_mix
    else
      provider_for_elixirc
