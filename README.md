# linter-elixirc

This linter plugin for [Linter][linter] provides an interface to elixirc/mix.
It will be used with files that have the "source.elixir" syntax (ie. `*.ex; *.exs`).

There are limitations with ElixirC that:

- in case of compilation error, it will only show first error
- it does not work with buffers, so linting on fly is disabled

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
5. Always use elixirc - leave it disabled, unless `mix compile` is too slow.

## Usage

If you open folder with mix project (`mix.exs` exists in project's root folder), linter
will use `mix compile` to include all dependencies, unless you enable
"Always use elixirc" setting.

If you open single file, linter will use `elixirc`. This will try to find dependencies
in a place where mix projects do (\_build/dev/lib/\*/ebin). If dependency path is different, then
every external dependency will trigger CompileError.

Since `*.ex` files are not compiled by `mix compile`, they are always linted
using `elixirc`.

[linter]: https://github.com/AtomLinter/Linter
