module.exports =
  config:
    elixircExecutablePath:
      type: 'string'
      default: ''
    includeDirs:
      type: 'string'
      default: ''
    pa:
      type: 'string'
      default: ''

  activate: ->
    console.log 'activate linter-elixirc'
