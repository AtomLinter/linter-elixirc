'use babel';
import { BufferedProcess, CompositeDisposable, Range } from 'atom';

export default {
  config: {
    elixircPath: { type: 'string', title: 'Elixirc path', default: 'elixirc' },
    mixPath: { type: 'string', title: 'Mix path', default: 'mix' },
    forceElixirc: {
      type: 'boolean',
      title: 'Always use elixirc',
      description: 'Activating this will force the plugin to never use ' +
        '`mix compile` and always use `elixirc`.',
      default: false
    }
  },
  activate() {
    require('atom-package-deps').install('linter-elixirc');
    this.subscriptions = new CompositeDisposable();
    this.subscriptions.add(
      atom.config.observe('linter-elixirc.elixircPath', elixircPath => {
        return this.elixircPath = elixircPath;
      })
    );
    this.subscriptions.add(
      atom.config.observe('linter-elixirc.mixPath', mixPath => {
        return this.mixPath = mixPath;
      })
    );
    return this.subscriptions.add(
      atom.config.observe('linter-elixirc.forceElixirc', forceElixirc => {
        return this.forceElixirc = forceElixirc;
      })
    );
  },
  deactivate() {
    return this.subscriptions.dispose();
  },
  provideLinter() {
    let provider;
    let helpers = require('atom-linter');
    let os = require('os');
    let fs = require('fs');
    let path = require('path');

    function regexp(string, flags) {
      return new RegExp(
        string
          .replace(/\\ /gm, 'randomstring123')
          .replace(/\s/gm, '')
          .replace(/randomstring123/gm, '\\ '),
        flags
      );
    }

    // find elixir project in the file path by locating mix.exs, otherwise
    // fallback to project path or file path
    const findElixirProjectPath = function(editorPath) {
      let prevPath;
      let currPath = editorPath;
      while (prevPath != currPath) {
        if (fs.existsSync(path.join(currPath, 'mix.exs'))) return currPath;
        prevPath = currPath;
        currPath = path.normalize(path.resolve(currPath, '..'));
      }
      const projPath = atom.project.relativizePath(editorPath)[0];
      if (projPath != null) {
        return projPath;
      }
      return path.dirname(editorPath);
    };

    const elixirProjectPathCache = {};
    // memoize the project path per file (traversing is quite expensive)
    const elixirProjectPath = function(textEditor) {
      const editorPath = textEditor.getPath();
      if (elixirProjectPathCache[editorPath])
        return elixirProjectPathCache[editorPath];
      const projectPath = findElixirProjectPath(editorPath);
      elixirProjectPathCache[editorPath] = projectPath;
      return projectPath;
    };

    let isMixProject = function(textEditor) {
      let project = elixirProjectPath(textEditor);
      return fs.existsSync(path.join(project, 'mix.exs'));
    };

    let isTestFile = function(textEditor) {
      let project = elixirProjectPath(textEditor);
      let relativePath = path.relative(project, textEditor.getPath());
      return relativePath.split(path.sep)[0] === 'test';
    };

    let isForcedElixirc = () => {
      return this.forceElixirc;
    };

    let isExsFile = textEditor => textEditor.getPath().endsWith('.exs');

    let isPhoenixProject = function(textEditor) {
      let project = elixirProjectPath(textEditor);
      let mixLockPath = path.join(project, 'mix.lock');
      try {
        let mixLockContent = fs.readFileSync(mixLockPath, 'utf-8');
        return mixLockContent.indexOf('"phoenix"') > 0;
      } catch (error) {
        return false;
      }
    };

    let parseError = function(toParse, textEditor) {
      let ret = [];
      const re = regexp(
        `
        \\*\\*[\\ ]+
        \\((\\w+)\\)                   ${'' /* 1 - (TypeOfError)*/}
        [\\ ](?:                       ${'' /* Two message formats.... mode one*/}
          ([\\w\\ ]+)                  ${'' /* 2 - Message*/}
          [\\r\\n]{1,2}.+[\\r\\n]{1,2} ${'' /* Internal elixir code*/}
          [\\ ]+(.+)                   ${'' /* 3 - File*/}
          :(\\d+):                     ${'' /* 4 - Line*/}
        |                              ${'' /* # Or... mode two*/}
          (.+)                         ${'' /* 5 - File*/}
          :(\\d+):                     ${'' /* 6 - Line*/}
          [\\ ](.+)                    ${'' /* 7 - Message*/}
        )
      `,
        'gm'
      );
      let reResult = re.exec(toParse);
      while (reResult != null) {
        if (reResult[2] != null) {
          ret.push({
            type: 'Error',
            text: `(${reResult[1]}) ${reResult[2]}`,
            filePath: path.join(elixirProjectPath(textEditor), reResult[3]),
            range: helpers.rangeFromLineNumber(textEditor, reResult[4] - 1)
          });
        } else {
          ret.push({
            type: 'Error',
            text: `(${reResult[1]}) ${reResult[7]}`,
            filePath: path.join(elixirProjectPath(textEditor), reResult[5]),
            range: helpers.rangeFromLineNumber(textEditor, reResult[6] - 1)
          });
        }
        reResult = re.exec(toParse);
      }
      return ret;
    };

    // only elixir 1.3+
    let parseWarning = function(toParse, textEditor) {
      let ret = [];
      let re = regexp(
        `
        warning:\\ (.*)\\n ${'' /* # warning */}
        \\ \\ (.*):([0-9]+) ${'' /*# file and file number */}
        `,
        'g'
      );
      let reResult = re.exec(toParse);

      while (reResult != null) {
        try {
          ret.push({
            type: 'Warning',
            text: reResult[1],
            filePath: path.join(elixirProjectPath(textEditor), reResult[2]),
            // use range, this because the previous method of getting a range
            // used the current buffer that is open in the texteditor, and it
            // blows up if the line number is larger than the current file
            // if the compiler returned warnings or errors of other files,
            // it would thus frequently blow up and return no errors/warnings
            // at all
            range: new Range([ reResult[3] - 1, 0 ], [ reResult[3] - 1, 1 ])
          });
        } catch (Error) {
          console.error('linter-elixirc:', Error);
        }
        reResult = re.exec(toParse);
      }
      return ret;
    };

    // parses warning for elixir 1.2 and below
    let parseLegacyWarning = function(toParse, textEditor) {
      let ret = [];
      let re = regexp(
        `
        ([^:\\n]*)   ${'' /* 1 - File name */}
        :(\\d+)      ${'' /* 2 - Line */}
        :\\ warning
        :\\ (.*)     ${'' /* 3 - Message */}
        `,
        'g'
      );
      let reResult = re.exec(toParse);
      while (reResult != null) {
        try {
          ret.push({
            type: 'Warning',
            text: reResult[3],
            filePath: path.join(elixirProjectPath(textEditor), reResult[1]),
            range: new Range([ reResult[3] - 1, 0 ], [ reResult[3] - 1, 1 ])
          });
        } catch (Error) {
          console.error('linter-elixirc:', Error);
        }
        reResult = re.exec(toParse);
      }
      return ret;
    };

    let handleResult = textEditor => function(compileResult) {
      let resultString = compileResult['stdout'] +
        '\n' +
        compileResult['stderr'];
      try {
        let errorStack = parseError(resultString, textEditor);
        let warningStack = parseWarning(resultString, textEditor);
        let legacyWarningStack = parseLegacyWarning(resultString, textEditor);
        return Array
          .from(errorStack.concat(warningStack))
          .filter(error => error != null)
          .map(error => error);
      } catch (Error) {
        console.error('linter-elixirc:', Error);
        return []; // error in different file, just suppress
      }
    };

    let getOpts = function(textEditor) {
      let opts;
      return opts = {
        cwd: elixirProjectPath(textEditor),
        throwOnStdErr: false,
        stream: 'both',
        allowEmptyStderr: true,
        env: process.env
      };
    };

    let getDepsPa = function(textEditor) {
      let env = isTestFile(textEditor) ? 'test' : 'dev';
      let buildDir = path.join('_build', env, 'lib');
      try {
        return fs
          .readdirSync(path.join(elixirProjectPath(textEditor), buildDir))
          .map(
            item =>
              path.join(elixirProjectPath(textEditor), buildDir, item, 'ebin')
          );
      } catch (e) {
        return [];
      }
    };

    let lintElixirc = textEditor => {
      let elixircArgs = [
        '--ignore-module-conflict',
        '--app',
        'mix',
        '--app',
        'ex_unit',
        '-o',
        os.tmpDir()
      ];
      for (let item of Array.from(getDepsPa(textEditor))) {
        elixircArgs.push('-pa', item);
      }
      elixircArgs.push(textEditor.getPath());

      return helpers
        .exec(this.elixircPath, elixircArgs, getOpts(textEditor))
        .then(handleResult(textEditor));
    };

    let lintMix = textEditor => {
      return helpers
        .exec(this.mixPath, [ 'compile' ], getOpts(textEditor))
        .then(handleResult(textEditor));
    };

    return provider = {
      grammarScopes: [ 'source.elixir' ],
      scope: 'project',
      lintOnFly: false,
      name: 'Elixir',
      lint(textEditor) {
        if (
          isForcedElixirc() ||
            !isMixProject(textEditor) ||
            isExsFile(textEditor) ||
            isPhoenixProject(textEditor)
        ) {
          return lintElixirc(textEditor);
        } else {
          return lintMix(textEditor);
        }
      }
    };
  }
}
