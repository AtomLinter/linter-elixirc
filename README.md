# linter-elixirc

This linter plugin for [Linter](https://github.com/AtomLinter/Linter) provides an interface to elixirc. It will be used with files that have the "source.elixir" syntax.

There is a limitation with ElixirC that causes warnings not to be shown when there is a SyntaxError.

## Installation
Linter package must be installed in order to use this plugin. If Linter is not installed, please follow the instructions [here](https://github.com/AtomLinter/Linter).

### Plugin installation
```
$ apm install linter-elixirc
```

## Settings
You can configure linter-elixirc by editing ~/.atom/config.cson (choose Open Your Config in Atom menu):

```
'linter-elixirc':
  'elixircExecutablePath': null #elixirc path. run 'which elixirc' to find the path
  'includeDirs': 'includes,other/paths' #comma seperated list of paths added with the -I flag
	'pa': '~/.ebin' #comma seperated list of paths added with the -pa flag.
```
