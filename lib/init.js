'use babel';

// eslint-disable-next-line import/no-extraneous-dependencies, import/extensions
import { CompositeDisposable, Range } from 'atom';

export default {
  config: {
    elixircPath: { type: 'string', title: 'Elixirc path', default: 'elixirc' },
    mixPath: { type: 'string', title: 'Mix path', default: 'mix' },
    forceElixirc: {
      type: 'boolean',
      title: 'Always use elixirc',
      description: 'Activating this will force the plugin to never use ' +
        '`mix compile` and always use `elixirc`.',
      default: false,
    },
  },
  activate() {
    require('atom-package-deps').install('linter-elixirc');
    this.subscriptions = new CompositeDisposable();
    this.subscriptions.add(
      atom.config.observe('linter-elixirc.elixircPath', (value) => {
        this.elixircPath = value;
      }),
    );
    this.subscriptions.add(
      atom.config.observe('linter-elixirc.mixPath', (value) => {
        this.mixPath = value;
      }),
    );
    return this.subscriptions.add(
      atom.config.observe('linter-elixirc.forceElixirc', (value) => {
        this.forceElixirc = value;
      }),
    );
  },
  deactivate() {
    return this.subscriptions.dispose();
  },
  provideLinter() {
    const helpers = require('atom-linter');
    const os = require('os');
    const fs = require('fs');
    const path = require('path');

    function regexp(string, flags) {
      return new RegExp(
        string
          .replace(/\\ /gm, 'randomstring123')
          .replace(/\s/gm, '')
          .replace(/randomstring123/gm, '\\ '),
        flags,
      );
    }

    // find elixir project in the file path by locating mix.exs, otherwise
    // fallback to project path or file path
    const findElixirProjectPath = (editorPath) => {
      let prevPath;
      let currPath = editorPath;
      while (prevPath !== currPath) {
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
    const elixirProjectPath = (textEditor) => {
      const editorPath = textEditor.getPath();
      if (elixirProjectPathCache[editorPath]) { return elixirProjectPathCache[editorPath]; }
      const projectPath = findElixirProjectPath(editorPath);
      elixirProjectPathCache[editorPath] = projectPath;
      return projectPath;
    };

    const isMixProject = (textEditor) => {
      const project = elixirProjectPath(textEditor);
      return fs.existsSync(path.join(project, 'mix.exs'));
    };

    const isTestFile = (textEditor) => {
      const project = elixirProjectPath(textEditor);
      const relativePath = path.relative(project, textEditor.getPath());
      return relativePath.split(path.sep)[0] === 'test';
    };

    const isForcedElixirc = () => this.forceElixirc;

    const isExsFile = textEditor => textEditor.getPath().endsWith('.exs');

    const isPhoenixProject = (textEditor) => {
      const project = elixirProjectPath(textEditor);
      const mixLockPath = path.join(project, 'mix.lock');
      try {
        const mixLockContent = fs.readFileSync(mixLockPath, 'utf-8');
        return mixLockContent.indexOf('"phoenix"') > 0;
      } catch (error) {
        return false;
      }
    };

    const parseError = (toParse, textEditor) => {
      const ret = [];
      const re = regexp(
        `
        \\*\\*[\\ ]+
        \\((\\w+)\\)                   ${''}
        [\\ ](?:                       ${''}
          ([\\w\\ ]+)                  ${''}
          [\\r\\n]{1,2}.+[\\r\\n]{1,2} ${''}
          [\\ ]+(.+)                   ${''}
          :(\\d+):                     ${''}
        |                              ${''}
          (.+)                         ${''}
          :(\\d+):                     ${''}
          [\\ ](.+)                    ${''}
        )
      `,
        'gm',
      );
      let reResult = re.exec(toParse);
      while (reResult != null) {
        if (reResult[2] != null) {
          ret.push({
            type: 'Error',
            text: `(${reResult[1]}) ${reResult[2]}`,
            filePath: path.join(elixirProjectPath(textEditor), reResult[3]),
            range: helpers.rangeFromLineNumber(textEditor, reResult[4] - 1),
          });
        } else {
          ret.push({
            type: 'Error',
            text: `(${reResult[1]}) ${reResult[7]}`,
            filePath: path.join(elixirProjectPath(textEditor), reResult[5]),
            range: helpers.rangeFromLineNumber(textEditor, reResult[6] - 1),
          });
        }
        reResult = re.exec(toParse);
      }
      return ret;
    };

    // only elixir 1.3+
    const parseWarning = (toParse, textEditor) => {
      const ret = [];
      const re = regexp(
        `
        warning:\\ (.*)\\n ${''}
        \\ \\ (.*):([0-9]+) ${''}
        `,
        'g',
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
            range: new Range([reResult[3] - 1, 0], [reResult[3] - 1, 1]),
          });
        } catch (Error) {
          // eslint-disable-next-line no-console
          console.error('linter-elixirc:', Error);
        }
        reResult = re.exec(toParse);
      }
      return ret;
    };

    // parses warning for elixir 1.2 and below
    const parseLegacyWarning = (toParse, textEditor) => {
      const ret = [];
      const re = regexp(
        `
        ([^:\\n]*)   ${''}
        :(\\d+)      ${''}
        :\\ warning
        :\\ (.*)     ${''}
        `,
        'g',
      );
      let reResult = re.exec(toParse);
      while (reResult != null) {
        try {
          ret.push({
            type: 'Warning',
            text: reResult[3],
            filePath: path.join(elixirProjectPath(textEditor), reResult[1]),
            range: new Range([reResult[3] - 1, 0], [reResult[3] - 1, 1]),
          });
        } catch (Error) {
          // eslint-disable-next-line no-console
          console.error('linter-elixirc:', Error);
        }
        reResult = re.exec(toParse);
      }
      return ret;
    };

    const handleResult = textEditor => (compileResult) => {
      const resultString = `${compileResult.stdout}\n${compileResult.stderr}`;
      try {
        const errorStack = parseError(resultString, textEditor);
        const warningStack = parseWarning(resultString, textEditor);
        const legacyWarningStack = parseLegacyWarning(resultString, textEditor);
        return Array
          .from(errorStack.concat(warningStack).concat(legacyWarningStack))
          .filter(error => error != null)
          .map(error => error);
      } catch (Error) {
        // eslint-disable-next-line no-console
        console.error('linter-elixirc:', Error);
        return []; // error in different file, just suppress
      }
    };

    const getOpts = textEditor => ({
      cwd: elixirProjectPath(textEditor),
      throwOnStdErr: false,
      stream: 'both',
      allowEmptyStderr: true,
      env: process.env,
    });

    const getDepsPa = (textEditor) => {
      const env = isTestFile(textEditor) ? 'test' : 'dev';
      const buildDir = path.join('_build', env, 'lib');
      try {
        return fs
          .readdirSync(path.join(elixirProjectPath(textEditor), buildDir))
          .map(
            item =>
              path.join(elixirProjectPath(textEditor), buildDir, item, 'ebin'),
          );
      } catch (e) {
        return [];
      }
    };

    const lintElixirc = (textEditor) => {
      const elixircArgs = [
        '--ignore-module-conflict',
        '--app',
        'mix',
        '--app',
        'ex_unit',
        '-o',
        os.tmpDir(),
      ];
      Array.from(getDepsPa(textEditor)).forEach((item) => {
        elixircArgs.push('-pa', item);
      });
      elixircArgs.push(textEditor.getPath());

      return helpers
        .exec(this.elixircPath, elixircArgs, getOpts(textEditor))
        .then(handleResult(textEditor));
    };

    const lintMix = textEditor => helpers
        .exec(this.mixPath, ['compile'], getOpts(textEditor))
        .then(handleResult(textEditor));

    return {
      grammarScopes: ['source.elixir'],
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
        }
        return lintMix(textEditor);
      },
    };
  },
};
