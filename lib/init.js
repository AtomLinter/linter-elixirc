'use babel';

// eslint-disable-next-line import/no-extraneous-dependencies, import/extensions
import { CompositeDisposable, Range } from 'atom';
import { findAsync, rangeFromLineNumber, exec } from 'atom-linter';
import { dirname, join, relative, sep } from 'path';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { tmpDir } from 'os';

// Internal values
const elixirProjectPathCache = new Map();
let elixircPath;
let mixPath;
let forceElixirc;

function regexp(string, flags) {
  return new RegExp(
    string
      .replace(/\\ /gm, 'randomstring123')
      .replace(/\s/gm, '')
      .replace(/randomstring123/gm, '\\ '),
    flags,
  );
}

// Find elixir project in the file path by locating mix.exs, otherwise
//  fallback to project path or file path
const findElixirProjectPath = async (editorPath) => {
  const editorDir = dirname(editorPath);
  const mixexsPath = await findAsync(editorDir, 'mix.exs');
  if (mixexsPath !== null) {
    return mixexsPath;
  }
  const projPath = atom.project.relativizePath(editorPath)[0];
  if (projPath !== null) {
    return projPath;
  }
  return editorDir;
};

// Memoize the project path per file (traversing is quite expensive)
const elixirProjectPath = async (textEditor) => {
  const editorPath = textEditor.getPath();
  if (elixirProjectPathCache.has(editorPath)) {
    return elixirProjectPathCache.get(editorPath);
  }
  const projectPath = await findElixirProjectPath(editorPath);
  elixirProjectPathCache.set(editorPath, projectPath);
  return projectPath;
};

const isMixProject = async (textEditor) => {
  const project = await elixirProjectPath(textEditor);
  return existsSync(join(project, 'mix.exs'));
};

const isTestFile = async (textEditor) => {
  const project = await elixirProjectPath(textEditor);
  const relativePath = relative(project, textEditor.getPath());
  return relativePath.split(sep)[0] === 'test';
};

const isForcedElixirc = () => forceElixirc;

const isExsFile = textEditor => textEditor.getPath().endsWith('.exs');

const isPhoenixProject = async (textEditor) => {
  const project = await elixirProjectPath(textEditor);
  const mixLockPath = join(project, 'mix.lock');
  try {
    const mixLockContent = readFileSync(mixLockPath, 'utf-8');
    return mixLockContent.indexOf('"phoenix"') > 0;
  } catch (error) {
    return false;
  }
};

const parseError = async (toParse, textEditor) => {
  const messages = [];
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
  const projectPath = await elixirProjectPath(textEditor);
  let reResult = re.exec(toParse);
  while (reResult !== null) {
    if (reResult[2] !== null) {
      messages.push({
        type: 'Error',
        text: `(${reResult[1]}) ${reResult[2]}`,
        filePath: join(projectPath, reResult[3]),
        range: rangeFromLineNumber(textEditor, reResult[4] - 1),
      });
    } else {
      messages.push({
        type: 'Error',
        text: `(${reResult[1]}) ${reResult[7]}`,
        filePath: join(projectPath, reResult[5]),
        range: rangeFromLineNumber(textEditor, reResult[6] - 1),
      });
    }
    reResult = re.exec(toParse);
  }
  return messages;
};

// Only Elixir 1.3+
const parseWarning = async (toParse, textEditor) => {
  const messages = [];
  const re = regexp(
    `
    warning:\\ (.*)\\n ${''}
    \\ \\ (.*):([0-9]+) ${''}
    `,
    'g',
  );
  const projectPath = await elixirProjectPath(textEditor);
  let reResult = re.exec(toParse);

  while (reResult != null) {
    const filePath = join(projectPath, reResult[2]);
    try {
      let range;
      if (filePath === textEditor.getPath()) {
        // If the Warning is in the current file, we can get a better range
        // using rangeFromLineNumber, otherwise generate a 1 character range
        // that can be updated to a proper range if/when the file is opened.
        range = rangeFromLineNumber(textEditor, reResult[3] - 1);
      } else {
        range = new Range([reResult[3] - 1, 0], [reResult[3] - 1, 1]);
      }
      messages.push({
        type: 'Warning',
        text: reResult[1],
        filePath,
        range,
      });
    } catch (Error) {
      // eslint-disable-next-line no-console
      console.error('linter-elixirc:', Error);
    }
    reResult = re.exec(toParse);
  }
  return messages;
};

// Parses warning for elixir 1.2 and below
const parseLegacyWarning = async (toParse, textEditor) => {
  const messages = [];
  const re = regexp(
    `
    ([^:\\n]*)   ${''}
    :(\\d+)      ${''}
    :\\ warning
    :\\ (.*)     ${''}
    `,
    'g',
  );
  const projectPath = await elixirProjectPath(textEditor);
  let reResult = re.exec(toParse);
  while (reResult !== null) {
    const filePath = join(projectPath, reResult[1]);
    try {
      let range;
      if (filePath === textEditor.getPath()) {
        // If the Warning is in the current file, we can get a better range
        // using rangeFromLineNumber, otherwise generate a 1 character range
        // that can be updated to a proper range if/when the file is opened.
        range = rangeFromLineNumber(textEditor, reResult[3] - 1);
      } else {
        range = new Range([reResult[3] - 1, 0], [reResult[3] - 1, 1]);
      }
      messages.push({
        type: 'Warning',
        text: reResult[3],
        filePath,
        range,
      });
    } catch (Error) {
      // eslint-disable-next-line no-console
      console.error('linter-elixirc:', Error);
    }
    reResult = re.exec(toParse);
  }
  return messages;
};

const handleResult = async (compileResult, textEditor) => {
  const resultString = `${compileResult.stdout}\n${compileResult.stderr}`;
  try {
    const errorStack = await parseError(resultString, textEditor);
    const warningStack = await parseWarning(resultString, textEditor);
    const legacyWarningStack = await parseLegacyWarning(resultString, textEditor);
    return errorStack.concat(warningStack).concat(legacyWarningStack)
      .filter(error => error !== null)
      .map(error => error);
  } catch (Error) {
    // eslint-disable-next-line no-console
    console.error('linter-elixirc:', Error);
    return []; // Error is in a different file, just suppress
  }
};

const getOpts = async textEditor => ({
  cwd: await elixirProjectPath(textEditor),
  throwOnStdErr: false,
  stream: 'both',
  allowEmptyStderr: true,
});

const getDepsPa = async (textEditor) => {
  const env = await isTestFile(textEditor) ? 'test' : 'dev';
  const buildDir = join('_build', env, 'lib');
  const projectPath = await elixirProjectPath(textEditor);
  try {
    return readdirSync(join(projectPath, buildDir))
      .map(
        item =>
          join(projectPath, buildDir, item, 'ebin'),
      );
  } catch (e) {
    return [];
  }
};

const lintElixirc = async (textEditor) => {
  const elixircArgs = [
    '--ignore-module-conflict',
    '--app',
    'mix',
    '--app',
    'ex_unit',
    '-o',
    tmpDir(),
  ];
  await getDepsPa(textEditor).forEach((item) => {
    elixircArgs.push('-pa', item);
  });
  elixircArgs.push(textEditor.getPath());

  const execOpts = await getOpts(textEditor);
  const result = await exec(elixircPath, elixircArgs, execOpts);
  return handleResult(textEditor, result);
};

const lintMix = async (textEditor) => {
  const execOpts = await getOpts(textEditor);
  const result = await exec(mixPath, ['compile'], execOpts);
  return handleResult(textEditor, result);
};

export default {
  activate() {
    require('atom-package-deps').install('linter-elixirc');
    this.subscriptions = new CompositeDisposable();
    this.subscriptions.add(
      atom.config.observe('linter-elixirc.elixircPath', (value) => {
        elixircPath = value;
      }),
    );
    this.subscriptions.add(
      atom.config.observe('linter-elixirc.mixPath', (value) => {
        mixPath = value;
      }),
    );
    return this.subscriptions.add(
      atom.config.observe('linter-elixirc.forceElixirc', (value) => {
        forceElixirc = value;
      }),
    );
  },

  deactivate() {
    this.subscriptions.dispose();
  },

  provideLinter() {
    return {
      grammarScopes: ['source.elixir'],
      scope: 'project',
      lintOnFly: false,
      name: 'Elixir',
      async lint(textEditor) {
        if (
          isForcedElixirc() ||
            !(await isMixProject(textEditor)) ||
            isExsFile(textEditor) ||
            await isPhoenixProject(textEditor)
        ) {
          return lintElixirc(textEditor);
        }
        return lintMix(textEditor);
      },
    };
  },
};
