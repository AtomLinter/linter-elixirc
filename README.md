# linter-elixirc

This linter plugin for [Linter][linter] provides an interface to elixirc/mix.
It will be used with files that have the "source.elixir" syntax (ie. `*.ex; *.exs`).

There is a limitation with ElixirC that causes warnings not to be shown when there is a SyntaxError.

## Installation
Plugin requires Linter package and it should install it by itself.
If it did not, please follow Linter instructions [here][linter].

### Method 1: In console
```
$ apm install linter-elixirc
```

### Method 2: In Atom

1. Edit > Preferences (Ctrl+,)
2. Install > Search "linter-elixirc" > Install

## Settings

Plugin should work with default settings. If not:

1. Edit > Preferences (Ctrl+,)
2. Packages > Search "linter-elixirc" > Settings
3. Elixirc path - use `which elixirc` to find path. ie. `/usr/local/bin/elixirc`
4. Mix path - use `which mix` to find path. ie. `/usr/local/bin/mix`

## Usage

If you open folder with mix project (`mix.exs` exists in project's root folder), linter
will use `mix compile` to include all dependencies.

If you open single file, linter will use `elixirc`. This means that every
external dependency will trigger CompileError.

[linter]: https://github.com/AtomLinter/Linter
